/**
 * Chrome Connection Manager
 * Handles connection to existing Chrome instance via CDP
 * Now with Playwright support for launching browser
 */

import CDP from 'chrome-remote-interface';
import { chromium, type BrowserContext } from 'playwright';
import { spawn, type ChildProcess, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

import { withTimeout } from './utils/helpers.js';
import { reportProgress } from './utils/log.js';
import {
  cloneChromeProfile,
  getRealUserDataDir,
  resolveProfileDirectory,
  type CloneResult,
} from './utils/chrome-profiles.js';
import { classifyCdpEndpoint } from './utils/cdp-endpoint.js';

const execAsync = promisify(exec);

/**
 * CDP WebSocket Origin allowlist (replaces the old `--remote-allow-origins=*`).
 *
 * Why: `--remote-allow-origins=*` turns the debug port into an open remote-
 * control channel — ANY webpage open in ANY browser on this machine can open
 * ws://127.0.0.1:<port> and drive the browser (read HttpOnly cookies, run
 * JS in every tab, navigate to file://, screenshot…). The local MCP server
 * connects via chrome-remote-interface, which sends NO Origin header, so it
 * is unaffected by this list; only browser/web-content handshakes carry an
 * Origin and those are now restricted to DevTools/localhost.
 */
const CDP_ALLOWED_ORIGINS = 'http://localhost,http://127.0.0.1,devtools://devtools';

export interface ChromeConnection {
  client: any;
  connected: boolean;
  port: number;
}

export interface TabInfo {
  id: string;
  type: string;
  title: string;
  url: string;
  description?: string;
}

export interface LaunchOptions {
  headless?: boolean;
  userDataDir?: string;
  profileDirectory?: string;
  executablePath?: string;
  /** If true, disconnect any existing connection and re-launch. */
  force?: boolean;
  /**
   * Clone the real profile into the managed clone root before launching
   * (default true). Chrome cannot expose CDP on the live user-data dir, and a
   * clone is what makes the session survive between MCP runs.
   */
  cloneProfile?: boolean;
  /** Folder name of the managed clone (default: the profile directory name). */
  cloneName?: string;
  /** How aggressively to refresh the clone from the real profile. */
  resync?: 'auto' | 'always' | 'never';
  /** Also copy installed extensions into the clone. */
  includeExtensions?: boolean;
}

/** What actually happened during a launch (clone included) — reported to tools. */
export interface LaunchInfo {
  profileDirectory: string;
  /** `--user-data-dir` that was used (the clone, when cloning is enabled). */
  userDataDir: string | null;
  /** True when an already-running browser on the CDP port was reused. */
  reusedExisting: boolean;
  /** Clone statistics, when a clone was created or refreshed. */
  clone: CloneResult | null;
  processId: number | null;
}

export class ChromeConnector {
  private connection: ChromeConnection | null = null;
  private port: number;
  private currentTabId: string | null = null;
  private browserContext: BrowserContext | null = null;
  private chromeProcess: ChildProcess | null = null;
  private persistentClients: Map<string, any> = new Map(); // Persistent clients for interceptors
  private stealthApplied = false; // Applied once per connection session (legacy guard)
  /** Targets that already have the stealth script registered (per-tab guard). */
  private stealthTabs = new Set<string>();
  private cleaningUp = false; // Re-entrancy guard for process-death cleanup
  /** Callbacks invoked whenever the CDP connection is torn down (disconnect / process death). */
  private disconnectHandlers = new Set<() => void>();

  constructor(port?: number) {
    this.port = port ?? 9222;
  }

  /**
   * Register a callback that runs when the browser session is torn down
   * (explicit disconnect OR Chrome process death). Used to reset module-level
   * capture/interception state so a fresh Chrome session does not inherit
   * stale buffers or listeners.
   */
  onDisconnect(handler: () => void): void {
    this.disconnectHandlers.add(handler);
  }

  private notifyDisconnect(): void {
    for (const handler of this.disconnectHandlers) handler();
    this.disconnectHandlers.clear();
  }

  /**
   * Get platform-specific Chrome paths
   */
  private getPlatformPaths(): { executable: string; userDataDir: string } {
    const platform = os.platform();
    // Single source of truth for the user-data dir: `getRealUserDataDir()`
    // knows about CHROME_MCP_REAL_USER_DATA_DIR, so an override actually takes
    // effect here too (portable installs, Chromium forks, tests).
    const userDataDir = getRealUserDataDir();

    switch (platform) {
      case 'win32':
        const commonPaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
        ];

        let executable = commonPaths.find(p => fs.existsSync(p));

        if (!executable) {
          executable = commonPaths[0];
          console.error('⚠️ Could not find Chrome in common locations. Using default:', executable);
        }

        return { executable, userDataDir };
      case 'darwin':
        return {
          executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir
        };
      case 'linux':
        return {
          executable: '/usr/bin/google-chrome',
          userDataDir
        };
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  private lastLaunchInfo: LaunchInfo | null = null;

  /** Details of the most recent launch (clone stats, user-data dir, PID). */
  getLastLaunchInfo(): LaunchInfo | null {
    return this.lastLaunchInfo;
  }


  /**
   * Launch Chrome manually using child_process to avoid blocking and argument issues
   * This is more robust for persistent profiles than Playwright's launcher
   */
  async launchWithProfile(options: LaunchOptions = {}): Promise<LaunchInfo> {
    // Fresh launch attempt — allow a previous process-death cleanup to run again.
    this.cleaningUp = false;

    // 1. Check connections
    if (this.connection?.connected) {
      if (!options.force) {
        // Not a forced re-launch: just ensure the window is visible and return.
        console.error('✅ Already connected to a Chrome instance. Bringing window to foreground...');
        await this.bringWindowToForeground();
        const previous = this.lastLaunchInfo;
        return {
          profileDirectory: previous?.profileDirectory ?? options.profileDirectory ?? 'Default',
          userDataDir: previous?.userDataDir ?? null,
          // We did NOT spawn anything this time: we attached to the live browser.
          reusedExisting: true,
          clone: previous?.clone ?? null,
          processId: previous?.processId ?? this.chromeProcess?.pid ?? null,
        };
      }
      // Forced re-launch (e.g. user explicitly called launch_edge or launch_chrome):
      // disconnect from the current browser before spawning a new one.
      console.error('🔄 Force re-launch requested. Disconnecting current browser...');
      await this.disconnect();
    }

    try {
      // Check if a real browser is already running on the port and connect to it.
      const probe = await this.probeCdpPort();
      if (probe.ok) {
        await this.connect();
        console.error(`✅ Detected and connected to existing browser on port ${this.port}`);

        // Ensure a visible page exists.
        const tabs = await this.listTabs();
        const hasPages = tabs.some(t => t.type === 'page');
        if (!hasPages) {
          console.error('⚠️ No open pages – creating one...');
          try { await this.connection?.client.Target.createTarget({ url: 'chrome://newtab/' }); } catch { }
        }
        await this.bringWindowToForeground();
        return {
          profileDirectory: options.profileDirectory ?? 'Default',
          userDataDir: null,
          reusedExisting: true,
          clone: null,
          processId: this.chromeProcess?.pid ?? null,
        };
      }

      // The port is taken by something that is NOT a drivable browser (an
      // embedded Chromium widget, a leftover service…). Spawning Chrome on that
      // port cannot work (the debug port would never bind) and silently driving
      // the other process is worse, so fail fast with an actionable message.
      if (probe.occupied) {
        throw new Error(
          `CDP port ${this.port} is already in use by ${
            probe.processName ? `"${probe.processName}"` : 'another process'
          }${
            probe.browser ? ` (Browser: ${probe.browser}, UA: ${probe.userAgent})` : ''
          } — ${probe.reason ?? 'it is not a controllable browser'}. ` +
            `Start this server on a free port (--port=<other>) instead.`
        );
      }
    } catch (e) {
      // Re-throw our own actionable error; swallow "port free" failures.
      if (e instanceof Error && e.message.startsWith('CDP port')) throw e;
      // Port free or not a real browser – proceed to launch.
    }

    const platformPaths = this.getPlatformPaths();

    let {
      userDataDir,
      profileDirectory = 'Default',
      executablePath = platformPaths.executable
    } = options;

    // Resolve "auto" / display names / profile numbers to the REAL directory
    // name. Passing the raw value through would make Chrome look for (and
    // cheerfully create) a brand-new empty profile called "auto".
    if (!userDataDir) {
      profileDirectory = resolveProfileDirectory(profileDirectory);
      console.error(`👤 Using Chrome profile: ${profileDirectory}`);
    }

    const originalUserDataDir = userDataDir || platformPaths.userDataDir;
    let finalUserDataDir = originalUserDataDir;
    let cloneResult: CloneResult | null = null;

    // 2. Profile handling.
    // Chrome will not expose the CDP port on the *live* user-data dir, and it
    // cannot even start against it while the user's own Chrome is running. So
    // by default we launch on a persistent managed clone of the real profile,
    // which (a) is debuggable, and (b) carries the user's cookies/localStorage
    // over, so the browser starts already logged in. Set
    // CHROME_MCP_NO_CLONE=1 or pass cloneProfile:false to opt out.
    const cloneEnabled = options.cloneProfile ?? process.env.CHROME_MCP_NO_CLONE !== '1';
    if (!userDataDir && cloneEnabled) {
      try {
        console.error('👥 Preparing managed clone of the real Chrome profile...');
        cloneResult = await cloneChromeProfile({
          profileDirectory,
          cloneName: options.cloneName,
          realUserDataDir: originalUserDataDir,
          resync: options.resync,
          includeExtensions: options.includeExtensions,
        });
        finalUserDataDir = cloneResult.userDataDir;
        console.error(
          `✅ Clone ready (${cloneResult.copiedFiles} file(s) copied, ${cloneResult.sessionState.length} session item(s)): ${finalUserDataDir}`
        );
        if (cloneResult.lockedFiles.length > 0) {
          console.error(
            `⚠️ ${cloneResult.lockedFiles.length} profile file(s) were locked by a running Chrome (close Chrome for a fresher session).`
          );
        }
      } catch (err) {
        console.error('❌ Failed to prepare the profile clone, falling back to the raw user-data dir:', err);
        finalUserDataDir = originalUserDataDir;
      }
    }

    console.error(`🚀 Launching Chrome Native...`);
    console.error(`   User Data: ${finalUserDataDir}`);
    console.error(`   Profile: ${profileDirectory}`);
    await reportProgress(15, 100, cloneResult ? 'Profile clone ready — launching Chrome' : 'Launching Chrome');

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${finalUserDataDir}`,
      `--profile-directory=${profileDirectory}`,
      `--remote-allow-origins=${CDP_ALLOWED_ORIGINS}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--exclude-switches=enable-automation',
      '--new-window',         // ← always open a visible window
      '--start-maximized',    // ← open maximized so it's easy to see
    ];

    // Key-store flags: on Windows the cookie key lives in `Local State`
    // (DPAPI-encrypted), so a mock keychain is a harmless no-op. On macOS and
    // Linux the real key comes from the OS keychain, and forcing a mock/basic
    // store is exactly what makes cloned cookies undecryptable ("logged out
    // clone"). Only opt into that with CHROME_MCP_PASSWORD_STORE (headless CI).
    if (os.platform() === 'win32' || process.env.CHROME_MCP_PASSWORD_STORE) {
      args.push('--use-mock-keychain', '--password-store=basic');
    }
    if (options.headless) {
      args.push('--headless=new', '--disable-gpu');
    }

    console.error(`   Args: ${JSON.stringify(args)}`);

    // Use standard spawn with file logging for detachment + debug
    const logFile = path.join(os.tmpdir(), 'chrome-mcp-debug.log');

    // Ensure we can write to log file
    try { fs.writeFileSync(logFile, ''); } catch (e) { }

    console.error(`   Logging to: ${logFile}`);

    // Keep Chrome as a child process - it will survive as long as the MCP server is running
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    this.chromeProcess = spawn(executablePath, args, {
      detached: false,  // Keep as child
      stdio: ['ignore', out, err],
      windowsHide: false
    });

    // Capture PID immediately before it can be nullified by exit event
    const spawnedPid = this.chromeProcess.pid;

    // Setup process death detection
    this.chromeProcess.on('exit', (code, signal) => {
      console.error(`⚠️ Chrome process died (PID: ${spawnedPid}, code: ${code}, signal: ${signal})`);
      this.handleProcessDeath();
    });

    this.chromeProcess.on('error', (err) => {
      console.error(`⚠️ Chrome process error:`, err);
      this.handleProcessDeath();
    });

    // Don't call unref() - keep the process attached to the MCP server

    console.error(`✅ Chrome process spawned (PID: ${spawnedPid})`);
    await reportProgress(30, 100, 'Chrome process started');

    // Close file descriptors after Chrome has started
    setTimeout(() => {
      try {
        fs.closeSync(out);
        fs.closeSync(err);
      } catch (e) { }
    }, 5000);

    // ENHANCED VERIFICATION SYSTEM
    // Wait for Chrome to initialize before starting verification
    const waitTime = 3000;
    console.error(`⏳ Waiting ${waitTime}ms for Chrome to fully initialize...`);
    await new Promise(r => setTimeout(r, waitTime));

    // Step 1: Verify process is still running via system command
    console.error('🔍 Step 1: Verifying Chrome process is running...');

    // Verify process is still running
    if (!this.chromeProcess) {
      let logs = 'Check log file';
      try { logs = fs.readFileSync(logFile, 'utf8'); } catch (e) { }
      throw new Error(`Chrome process exited immediately (PID was ${spawnedPid}). This usually means Chrome is already running with this profile and the shadow copy failed, or the port is in use. Logs: ${logs}`);
    }

    if (this.chromeProcess && this.chromeProcess.pid) {
      try {
        const platform = os.platform();
        let processCheckCmd: string;

        if (platform === 'win32') {
          // Check if the PID exists at all (do NOT filter by MainWindowHandle:
          // Chrome spawns the window asynchronously and can take several seconds
          // to create it, so the handle may be 0 right after launch).
          processCheckCmd = `powershell -Command "(Get-Process -Id ${this.chromeProcess.pid} -ErrorAction SilentlyContinue).ProcessName"`;
        } else {
          processCheckCmd = `ps -p ${this.chromeProcess.pid} -o comm=`;
        }

        const { stdout } = await execAsync(processCheckCmd);
        const processName = stdout.trim();

        if (processName) {
          console.error(`✅ Process verified: ${processName} (PID: ${this.chromeProcess.pid})`);
        } else {
          throw new Error('Process not found in system');
        }
      } catch (procErr) {
        throw new Error(`Chrome process verification failed: ${(procErr as Error).message}`);
      }
    }

    // Step 2: Verify port is listening
    console.error(`🔍 Step 2: Verifying CDP port ${this.port} is listening...`);
    try {
      const platform = os.platform();
      let portCheckCmd: string;

      if (platform === 'win32') {
        // \s after the port avoids false positives from ports that merely
        // CONTAIN ours (e.g. 9222 must not match 92220).
        portCheckCmd = `powershell -Command "netstat -ano | Select-String ':${this.port}\\s' | Select-String 'LISTENING'"`;
      } else {
        portCheckCmd = `lsof -i :${this.port} | grep LISTEN || netstat -an | grep ${this.port}`;
      }

      const { stdout: portOutput } = await execAsync(portCheckCmd);

      if (portOutput.trim()) {
        console.error(`✅ Port ${this.port} is listening`);
      } else {
        throw new Error('Port not listening');
      }
    } catch (portErr) {
      console.error(`⚠️ Port check inconclusive, proceeding with CDP connection test...`);
    }

    // Step 3: Connect to CDP with retries
    console.error('🔍 Step 3: Connecting to CDP...');
    let connected = false;
    for (let i = 0; i < 8; i++) {
      try {
        await this.connect();
        connected = true;
        console.error(`✅ CDP connection established (attempt ${i + 1})`);
        break;
      } catch (e) {
        console.error(`   Attempt ${i + 1}/8 failed. Retrying in 1s...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!connected) {
      let logs = 'Check log file';
      try { logs = fs.readFileSync(logFile, 'utf8'); } catch (e) { }
      const pidStr = this.chromeProcess ? ` (PID ${this.chromeProcess.pid})` : ' (Process died)';
      throw new Error(`Chrome process failed to connect${pidStr}. CDP port ${this.port} is not accessible after 15s. This usually means Chrome is already running with this profile. Please close ALL Chrome windows and try again. Logs: ${logs}`);
    }

    // Apply stealth mode immediately after CDP connection
    await this.applyStealthMode();
    await reportProgress(60, 100, 'Connected to CDP — applying stealth');

    // Step 4: Verify browser is responsive (can list targets)
    console.error('🔍 Step 4: Verifying browser responsiveness...');
    try {
      let targets = await this.listTabs();
      console.error(`✅ Browser responsive: Found ${targets.length} targets`);

      if (targets.length === 0) {
        console.error('⚠️ Warning: Browser running but no targets found. Creating initial tab...');
        try {
          await this.connection?.client.Target.createTarget({ url: 'about:blank' });
          console.error('✅ Initial tab created');
          targets = await this.listTabs(); // Refresh targets
        } catch (createErr) {
          console.error('⚠️ Could not create initial tab:', createErr);
        }
      }

      // Force activation of the first page to ensure window is visible/foreground
      const page = targets.find(t => t.type === 'page');
      if (page) {
        try {
          await this.ensureWindowVisible(page.id); // NEW HELPER
          // Inject visual feedback (UX)
          await this.injectConnectionStatus(page.id);
        } catch (activateErr) {
          console.error('⚠️ Could not activate window:', activateErr);
        }
      }
    } catch (verErr) {
      console.error('⚠️ Warning: Could not verify targets listing:', verErr);
    }

    console.error('');
    console.error('🎉 Chrome launch verification complete!');
    console.error(`   Process: Running (PID ${this.chromeProcess?.pid || 'Unknown'})`);
    console.error(`   Port: ${this.port}`);
    console.error(`   CDP: Connected`);
    console.error(`   Status: Ready`);

    // Optional: Try to attach Playwright over CDP for advanced features if needed
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${this.port}`);
      // When connecting over CDP to a persistent profile, the default context is the first one
      this.browserContext = browser.contexts()[0];
      console.error('✅ Playwright wrapper connected over CDP');
    } catch (pwError) {
      console.error('⚠️ Could not attach Playwright wrapper (CDP still works):', (pwError as Error).message);
    }

    this.lastLaunchInfo = {
      profileDirectory,
      userDataDir: finalUserDataDir,
      reusedExisting: false,
      clone: cloneResult,
      processId: this.chromeProcess?.pid ?? null,
    };
    return this.lastLaunchInfo;
  }

  /**
   * Handle Chrome process death - cleanup internal state.
   * Both the 'exit' and 'error' child-process events route here; the
   * re-entrancy guard makes sure the cleanup (and the disconnect
   * notifications) only ever run once.
   */
  private handleProcessDeath(): void {
    if (this.cleaningUp) return;
    this.cleaningUp = true;
    console.error('🧹 Cleaning up internal state due to Chrome process death...');

    try {
      // Clear connection
      if (this.connection) {
        try {
          this.connection.client.close().catch(() => { });
        } catch (e) { }
        this.connection = null;
      }

      // Clear browser context
      if (this.browserContext) {
        try {
          const browser = this.browserContext.browser();
          if (browser) {
            browser.close().catch(() => { });
          }
        } catch (e) { }
        this.browserContext = null;
      }

      // Close interceptor/console persistent clients so no listener keeps
      // firing against a dead browser.
      this.closeAllPersistentClients();

      // Clear process reference
      this.chromeProcess = null;
      this.currentTabId = null;
      this.stealthApplied = false;
      this.stealthTabs.clear();

      console.error('✅ Internal state cleared. Ready for new launch.');
    } finally {
      this.notifyDisconnect();
    }
  }

  /**
   * Close every persistent (interceptor/console) CDP client and drop the map.
   */
  closeAllPersistentClients(): void {
    for (const [, client] of this.persistentClients) {
      try {
        client.close().catch(() => { });
      } catch (e) { /* already closed */ }
    }
    this.persistentClients.clear();
  }

  /**
   * Was this Chrome process spawned by this server (as opposed to one the user
   * already had running that we merely attached to)?
   */
  spawnedByUs(): boolean {
    return this.chromeProcess !== null;
  }

  /** Waits for the spawned Chrome to disappear (polling the OS every 100ms). */
  private async waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return proc.exitCode !== null || proc.signalCode !== null;
  }

  /**
   * Ask Chrome to exit through CDP before we resort to killing it.
   *
   * Why this matters for sessions: `taskkill /F` and SIGKILL give Chrome no
   * chance to flush its profile stores. Cookies committed moments earlier are
   * usually on disk already, but localStorage/LevelDB and service-worker state
   * are buffered, so a hard kill can silently lose the login that was just
   * created in this browser — and that login is the whole point of the profile
   * clone. Browser.close() shuts the browser down the same way the user
   * clicking the X would.
   */
  private async closeChromeGracefully(timeoutMs = 5000): Promise<boolean> {
    const proc = this.chromeProcess;
    if (!proc || !this.connection?.client) return false;
    try {
      await withTimeout(this.connection.client.Browser.close(), 3000, 'Browser.close timed out');
    } catch (e) {
      console.error('⚠️ Graceful Browser.close failed, will force-kill:', (e as Error).message);
      return false;
    }
    const exited = await this.waitForProcessExit(proc, timeoutMs);
    if (!exited) console.error('⚠️ Chrome did not exit after Browser.close; force-killing.');
    return exited;
  }

  /**
   * Best-effort kill of the Chrome process this server spawned (and its
   * children) — used by close_browser and on graceful shutdown.
   */
  private async killChromeProcessTree(): Promise<void> {
    const proc = this.chromeProcess;
    if (!proc) return;
    const pid = proc.pid;
    try {
      if (os.platform() === 'win32' && pid) {
        await execAsync(`taskkill /pid ${pid} /T /F`);
      } else if (pid) {
        try {
          process.kill(-pid, 'SIGKILL'); // negative pid = process group
        } catch {
          proc.kill('SIGKILL');
        }
      } else {
        proc.kill('SIGKILL');
      }
    } catch (e) {
      console.error('⚠️ Could not kill Chrome process tree:', (e as Error).message);
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
    }
    this.chromeProcess = null;
  }

  /**
   * Disconnect from Chrome and close the Playwright browser.
   *
   * @param opts.killBrowser - If true AND this server spawned the Chrome
   * process, the process tree is killed too (used by close_browser and on
   * server shutdown). Plain disconnect() leaves a user-launched browser alone.
   */
  async disconnect(opts: { killBrowser?: boolean } = {}): Promise<void> {
    const { killBrowser = false } = opts;
    if (this.cleaningUp) {
      // A process-death cleanup is already running; let it finish the teardown.
      return;
    }

    if (killBrowser) {
      // Graceful first (flushes cookies/localStorage), kill only if that fails.
      const closed = await this.closeChromeGracefully();
      if (!closed) {
        await this.killChromeProcessTree();
      } else {
        this.chromeProcess = null;
        console.error('✅ Chrome closed gracefully (profile state flushed to disk)');
      }
    }

    if (this.connection?.client) {
      try {
        await withTimeout(this.connection.client.close(), 5000, 'CDP client close timed out');
      } catch (e) {
        console.error('⚠️ Error closing CDP client:', (e as Error).message);
      }
      this.connection = null;
      console.error('Disconnected from Chrome CDP');
    }

    if (this.browserContext) {
      try {
        await this.browserContext.close();
      } catch (e) { /* ignore */ }
      this.browserContext = null;
      console.error('Closed Playwright context');
    }

    this.closeAllPersistentClients();
    this.chromeProcess = null;
    this.currentTabId = null;
    this.stealthApplied = false;

    this.notifyDisconnect();
  }

  /**
   * Full teardown used on server shutdown (SIGINT/SIGTERM): kills a Chrome
   * that this server launched (avoids orphan browsers with open debug ports
   * piling up between restarts) and releases every CDP/Playwright resource.
   */
  async shutdown(): Promise<void> {
    await this.disconnect({ killBrowser: true });
  }

  /**
   * Connect to existing Chrome instance.
   * Closes any previous live client first so repeated connects never leak.
   */
  async connect(): Promise<void> {
    try {
      const client = await CDP({ port: this.port });

      if (this.connection?.client && this.connection.client !== client) {
        try { this.connection.client.close().catch(() => { }); } catch (e) { /* ignore */ }
      }

      this.connection = {
        client,
        connected: true,
        port: this.port
      };

      console.error(`✅ Connected to Chrome on port ${this.port}`);
    } catch (error) {
      const err = error as Error;
      throw new Error(
        `Failed to connect to Chrome on port ${this.port}. ` +
        `Make sure Chrome is running with --remote-debugging-port=${this.port}\n` +
        `Error: ${err.message}`
      );
    }
  }



  /**
   * Get Playwright browser context
   */
  getBrowserContext(): BrowserContext | null {
    return this.browserContext;
  }

  /**
   * Check if browser was launched by Playwright
   */
  isPlaywrightManaged(): boolean {
    return this.browserContext !== null;
  }

  /**
   * Get current connection
   */
  getConnection(): ChromeConnection {
    if (!this.connection?.connected) {
      throw new Error('Not connected to Chrome. Call connect() first.');
    }
    return this.connection;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection?.connected ?? false;
  }

  /**
   * Lazy init entry point called by every tool that needs a browser.
   * Delegates to ensureConnected() which is the actual lazy launcher.
   * This is the Playwright MCP pattern: Chrome launches only on first tool use,
   * never at server startup.
   */
  async verifyConnection(): Promise<void> {
    await this.ensureConnected();
  }

  /**
   * Bring the browser window to the foreground.
   * Tries CDP Target.activateTarget on the first page target.
   * On Windows, also uses PowerShell AppActivate as a fallback.
   */
  async bringWindowToForeground(): Promise<void> {
    if (!this.connection?.connected) return;
    try {
      const targets = await CDP.List({ port: this.port });
      const pages = targets.filter((t: any) => t.type === 'page');

      if (pages.length === 0) {
        // Chrome is running but has no visible window/tab.
        // Create a new tab to materialise the window.
        console.error('[Window] No pages found – creating new tab to show Chrome window...');
        try {
          await this.connection.client.Target.createTarget({ url: 'chrome://newtab/' });
          // Give Chrome a moment to open the window
          await new Promise(r => setTimeout(r, 1000));
          console.error('[Window] New tab created');
        } catch (createErr) {
          console.error('[Window] Could not create new tab via CDP:', (createErr as Error).message);
          // Last resort on Windows: use the shell to open Chrome
          if (os.platform() === 'win32') {
            try {
              const chromePath = this.getPlatformPaths().executable;
              spawn(chromePath, [
                `--remote-debugging-port=${this.port}`,
                '--new-window',
                '--start-maximized',
                'chrome://newtab/'
              ], { detached: false, stdio: 'ignore', windowsHide: false });
              console.error('[Window] Spawned new Chrome window via shell fallback');
            } catch { /* best effort */ }
          }
        }
      }

      // Activate the (possibly newly created) first page
      const freshTargets = await CDP.List({ port: this.port });
      const page = freshTargets.find((t: any) => t.type === 'page');
      if (page) {
        await this.connection.client.Target.activateTarget({ targetId: page.id });
        console.error(`[Window] Activated tab: ${page.title || page.url}`);
      }

      // On Windows, also try PowerShell to bring the window to front
      if (os.platform() === 'win32') {
        try {
          await execAsync(
            `powershell -Command "(New-Object -ComObject Shell.Application).Windows() | ` +
            `Where-Object { $_.Name -match 'Chrome|Edge' } | ` +
            `ForEach-Object { $_.Visible = $true }" 2>nul`
          );
          console.error('[Window] PowerShell window focus attempted');
        } catch { /* non-fatal */ }
      }
    } catch (err) {
      console.error('[Window] Could not bring window to foreground (non-fatal):', (err as Error).message);
    }
  }

  /**
   * Ask the endpoint on the CDP port who it is, and whether it is a
   * user-visible browser we may drive. Embedded Chromium (WebView2 widgets,
   * Electron apps) also answers `/json/version`, so the payload alone is not
   * enough — we also look up which process owns the port.
   */
  async probeCdpPort(): Promise<{
    occupied: boolean;
    ok: boolean;
    browser?: string;
    userAgent?: string;
    processName?: string;
    reason?: string;
  }> {
    const version = await new Promise<Record<string, any> | null>((resolve) => {
      void import('http').then((http) => {
        const req = http.default.get(`http://localhost:${this.port}/json/version`, { timeout: 2000 }, (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      }).catch(() => resolve(null));
    });

    if (!version) {
      // Nothing answers on /json/version: either the port is free or it is held
      // by an unrelated service (both mean "we cannot attach").
      return { occupied: await this.isPortOccupied(), ok: false };
    }

    const processName = await this.processNameOnPort();
    const verdict = classifyCdpEndpoint(version, processName);
    console.error(
      `[Port-check] ${this.port}: Browser="${verdict.browser}" UA="${verdict.userAgent}" proc="${processName ?? '?'}" → ${
        verdict.ok ? 'REAL browser' : `NOT a browser (${verdict.reason})`
      }`
    );
    return {
      occupied: true,
      ok: verdict.ok,
      browser: verdict.browser,
      userAgent: verdict.userAgent,
      processName: processName ?? undefined,
      reason: verdict.reason,
    };
  }

  /** Image name of the process listening on the CDP port (best effort). */
  private async processNameOnPort(): Promise<string | null> {
    if (os.platform() !== 'win32') return null;
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "$p = (Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if ($p) { (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName }"`
      );
      const name = stdout.trim();
      return name ? `${name}.exe` : null;
    } catch {
      return null;
    }
  }

  /** Is anything listening on the CDP port? */
  private async isPortOccupied(): Promise<boolean> {
    const platform = os.platform();
    try {
      const cmd =
        platform === 'win32'
          ? `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count"`
          : platform === 'darwin'
            ? `lsof -nP -iTCP:${this.port} -sTCP:LISTEN`
            : `lsof -nP -iTCP:${this.port} -sTCP:LISTEN || ss -ltn`;
      const { stdout } = await execAsync(cmd);
      if (platform === 'win32') return Number(stdout.trim()) > 0;
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Verify that the process on the CDP port is actually a controllable
   * user-visible Chrome/Edge browser — not a background/embedded Chromium
   * (msedgewebview2, Electron…) that also answers `/json/version` but is not
   * something the user can see or that we should be driving.
   */
  private async isRealBrowserOnPort(): Promise<boolean> {
    return (await this.probeCdpPort()).ok;
  }

  /**
   * Ensure Chrome is connected (lazy launcher).
   * - Verifies existing connection is still alive via CDP.List
   * - If a real Chrome is on the CDP port → connects to it
   * - Otherwise → launches a new Chrome instance
   * Never called at server startup — only triggered by tool invocations via verifyConnection().
   */
  async ensureConnected(): Promise<void> {
    // Already connected → verify still alive
    if (this.connection?.connected) {
      try {
        await withTimeout(CDP.List({ port: this.port }), 5000, 'CDP liveness check timed out');
        return;
      } catch {
        console.error('[Lazy-init] Connection dead, cleaning up...');
        this.handleProcessDeath();
      }
    }

    console.error('[Lazy-init] Tool invoked without browser — checking port...');

    // Check if there is a real browser (not EdgeWebView2) on the CDP port
    const realBrowser = await this.isRealBrowserOnPort();
    if (realBrowser) {
      try {
        await this.connect();
        console.error(`[Lazy-init] Connected to existing Chrome on port ${this.port}`);
        await this.applyStealthMode();

        // Attach Playwright wrapper if possible
        try {
          const browser = await chromium.connectOverCDP(`http://localhost:${this.port}`);
          this.browserContext = browser.contexts()[0];
          console.error('[Lazy-init] Playwright wrapper attached');
        } catch { /* CDP still works without Playwright */ }

        // Ensure at least one visible page exists
        const tabs = await this.listTabs();
        if (!tabs.some(t => t.type === 'page')) {
          await this.connection?.client.Target.createTarget({ url: 'chrome://newtab/' });
        }
        // NOTE: we deliberately do NOT call bringWindowToForeground() here.
        // ensureConnected() is a silent lazy-init (Playwright pattern) —
        // Chrome should only appear when the user explicitly launches it.
        return;
      } catch (e) {
        console.error('[Lazy-init] Connection to existing browser failed:', (e as Error).message);
      }
    } else {
      console.error(`[Lazy-init] Port ${this.port} has non-browser process (EdgeWebView2?). Launching Chrome...`);
    }

    // ─── NO AUTO-LAUNCH ──────────────────────────────────────────────────────
    // We do NOT auto-launch Chrome here. The user must explicitly request it
    // via the launch_chrome_with_profile tool. This prevents Chrome from
    // popping up when VS Code initializes the MCP or when the AI probes tools.
    // ─────────────────────────────────────────────────────────────────────────
    throw new Error(
      'No Chrome browser detected. Please use the launch_chrome_with_profile tool first to open Chrome.'
    );
  }

  /**
   * Get the CDP port number
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Build the stealth script.
   * Covers: webdriver=false, realistic plugin list (only when empty),
   * chrome.runtime stub, and session-stable canvas/audio fingerprint noise.
   * Deliberately does NOT spoof platform/UA/GPU values — inconsistent
   * spoofs are more detectable than the real environment of a genuine
   * user profile. The seed is random per session (persisted per-origin) so
   * fingerprints differ between sessions but stay stable within one.
   */
  private buildStealthScript(): string {
    return `(function() {
  // Session-unique seed: persisted per-origin (sessionStorage survives
  // same-origin navigations within the tab), so a site sees a STABLE
  // fingerprint during the whole session and a fresh one in the next session.
  let _seed = Math.random() * 1e10;
  try {
    const _stored = window.sessionStorage.getItem('__mcp_fp_seed');
    if (_stored !== null && !Number.isNaN(Number(_stored))) {
      _seed = Number(_stored);
    } else {
      window.sessionStorage.setItem('__mcp_fp_seed', String(_seed));
    }
  } catch(e) {}

  // ── 1. Hide webdriver flag ──────────────────────────────────────────────
  try {
    // A real (non-automated) Chrome reports 'false', not 'undefined'.
    Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });
  } catch(e) {}

  // ── 2. Realistic plugin list ────────────────────────────────────────────
  try {
    // Only fake a plugin list when the real one is empty (automation signal);
    // a normal user profile already has Chrome PDF/Native Client plugins.
    if (navigator.plugins.length === 0) {
      Object.defineProperty(navigator, 'plugins', {
        configurable: true,
        get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1,
          0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' } },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: 'Portable Document Format', length: 1,
          0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' } },
        { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2,
          0: { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
          1: { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' } }
        ]
      });
    }
  } catch(e) {}

  // ── 3. chrome.runtime stub (only when absent) ───────────────────────────
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch(e) {}

  // NOTE: navigator.platform / languages / hardwareConcurrency / deviceMemory
  // / screen / WebGL vendor overrides were REMOVED on purpose — hard-coding
  // 'Win32', 8 cores or "Mesa DRI Intel" while the real machine is a Mac or
  // an NVIDIA GPU is itself a fingerprint mismatch that anti-bot systems flag
  // instantly. This server drives a real Chrome with the user's real profile,
  // so the environment's real values are the most believable ones.

  // ── 8. Canvas fingerprint noise ─────────────────────────────────────────
  // Applies imperceptible +/-1 pixel noise derived from the session seed.
  // Works on a cloned canvas to avoid mutating the original element.
  try {
    const _px = (i) => ((Math.sin(_seed * (i + 1)) * 127) | 0) % 2; // -1, 0, or +1

    function _noisyClone(src) {
      if (!src || src.width === 0 || src.height === 0) return src;
      try {
        const c  = document.createElement('canvas');
        c.width  = src.width;
        c.height = src.height;
        const cx = c.getContext('2d');
        if (!cx) return src;
        cx.drawImage(src, 0, 0);
        const id = cx.getImageData(0, 0, c.width, c.height);
        const d  = id.data;
        for (let i = 0; i < d.length; i += 4) {
          const n = _px(i);
          d[i]   = Math.max(0, Math.min(255, d[i]   + n));
          d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
          d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
        }
        cx.putImageData(id, 0, 0);
        return c;
      } catch(e) { return src; }
    }

    const _orig_toDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, q) {
      return _orig_toDataURL.call(_noisyClone(this), type, q);
    };

    const _orig_toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb, type, q) {
      return _orig_toBlob.call(_noisyClone(this), cb, type, q);
    };
    // NOTE: getImageData is intentionally NOT noised — mutating readback
    // breaks legitimate pixel-reading apps (color pickers, image editors,
    // signature capture) and is itself detectable.
  } catch(e) {}

  // ── 10. Audio fingerprint noise ──────────────────────────────────────────
  // Adds a sub-microscopic perturbation (~1e-7) to audio sample data.
  // Completely inaudible but changes the fingerprint hash each session.
  try {
    if (typeof AudioBuffer !== 'undefined') {
      const _origGCD = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(ch) {
        const arr = _origGCD.call(this, ch);
        for (let i = 0; i < arr.length; i += 100) {
          arr[i] += Math.sin(_seed + i) * 1e-7;
        }
        return arr;
      };
    }
  } catch(e) {}

})();`;
  }

  /**
   * Apply comprehensive stealth mode to a tab.
   * - Registers the script to run on every new document in that tab.
   * - Also evaluates it immediately on the current page.
   * Called automatically on each fresh connection; can also be invoked
   * via the enable_stealth_mode tool to target a specific tab.
   * @param tabId  Optional tab/target ID. Defaults to first available page.
   * @param force  Skip the "already applied" guard (used by the explicit tool call).
   */
  async applyStealthMode(tabId?: string, force = false): Promise<void> {
    // Resolve which target we would attach to so the per-tab guard is exact
    // (stealth must apply to EVERY tab, not just the first one — but never
    // twice, or addScriptToEvaluateOnNewDocument would stack duplicates).
    let resolvedId = tabId ?? this.currentTabId ?? undefined;
    if (!resolvedId) {
      try {
        const tabs = await this.listTabs();
        const page = tabs.find((t) => t.type === 'page');
        if (page) resolvedId = page.id;
      } catch { /* not connected yet */ }
    }

    if (!force && resolvedId && this.stealthTabs.has(resolvedId)) return;
    if (!force && !resolvedId && this.stealthApplied) return;

    try {
      const client = await this.getTabClient(tabId);
      const { Runtime, Page } = client;
      await Runtime.enable();
      await Page.enable();

      const script = this.buildStealthScript();

      // Register for all future document loads in this tab
      await Page.addScriptToEvaluateOnNewDocument({ source: script });

      // Apply immediately to the current page (best-effort)
      try {
        await Runtime.evaluate({ expression: script });
      } catch (_) { /* page may not exist yet – that's OK */ }

      this.stealthApplied = true;
      if (resolvedId) this.stealthTabs.add(resolvedId);
      console.error(`[Stealth] Stealth mode applied (target: ${resolvedId ?? 'default'})`);
    } catch (err) {
      console.error('[Stealth] Could not apply stealth mode (non-fatal):', (err as Error).message);
    }
  }



  /**
   * List all open tabs and targets (including service workers)
   */
  async listTabs(): Promise<TabInfo[]> {
    try {
      const targets = await withTimeout(
        CDP.List({ port: this.port }),
        5000,
        'Timed out listing Chrome targets (browser unresponsive?)'
      );

      // Return interesting targets (pages, service workers, extensions)
      // Removed strict 'page' filter to allow finding service workers as requested
      return targets
        .filter((t: any) => t.type === 'page' || t.type === 'service_worker' || t.type === 'background_page' || t.type === 'other')
        .map((t: any) => ({
          id: t.id,
          type: t.type,
          title: t.title || t.url || 'Untitled', // Service workers might not have title
          url: t.url,
          description: t.description
        }));
    } catch (error) {
      throw new Error(`Failed to list tabs: ${(error as Error).message}`);
    }
  }

  /**
   * Get the most recently used tab.
   */
  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await this.listTabs();
    // Prefer an actual page: listTabs also returns service workers, and the
    // first entry of /json/list is not guaranteed to be the front tab.
    const pages = tabs.filter((t) => t.type === 'page');
    return (pages.length > 0 ? pages[0] : tabs[0]) ?? null;
  }

  /**
   * Create new tab
   */
  async createTab(url?: string): Promise<TabInfo> {
    try {
      const newTab = await CDP.New({ port: this.port, url });

      // Keep the stealth promise honest: every NEW tab gets the script too.
      if (newTab.type === 'page') {
        this.applyStealthMode(newTab.id).catch(() => { /* best effort */ });
      }

      return {
        id: newTab.id,
        type: newTab.type,
        title: newTab.title || '',
        url: newTab.url || url || 'about:blank'
      };
    } catch (error) {
      throw new Error(`Failed to create tab: ${(error as Error).message}`);
    }
  }

  /**
   * Close tab
   */
  async closeTab(tabId: string): Promise<void> {
    try {
      await CDP.Close({ port: this.port, id: tabId });
    } catch (error) {
      throw new Error(`Failed to close tab: ${(error as Error).message}`);
    }
  }

  /**
   * Activate tab
   */
  async activateTab(tabId: string): Promise<void> {
    try {
      await CDP.Activate({ port: this.port, id: tabId });
      this.currentTabId = tabId;
      // Stealth should follow the user to whichever tab becomes active.
      this.applyStealthMode(tabId).catch(() => { /* best effort */ });
    } catch (error) {
      throw new Error(`Failed to activate tab: ${(error as Error).message}`);
    }
  }

  /**
   * Get CDP client for specific tab
   */
  async getTabClient(tabId?: string): Promise<any> {
    try {
      const target = tabId || this.currentTabId;

      if (!target) {
        // Pick a default tab.
        // If this fails, it means Chrome is definitely not connected
        let tabs;
        try {
          tabs = await this.listTabs();
        } catch (e) {
          console.error(`Debug: listTabs failed on port ${this.port}. Error: ${(e as Error).message}`);
          throw new Error(`Connection failed on port ${this.port}. Is Chrome running? Original Error: ${(e as Error).message}`);
        }

        if (tabs.length === 0) {
          throw new Error(`Chrome is accessible on port ${this.port} but has no open tabs/pages.`);
        }
        // Prefer a real page target: attaching UI tools (Page/DOM/Runtime) to
        // a service worker target fails confusingly.
        const pageTab = tabs.find((t) => t.type === 'page') ?? tabs[0];
        return await CDP({ port: this.port, target: pageTab.id });
      }

      return await CDP({ port: this.port, target });
    } catch (error) {
      const err = error as Error;
      if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('connect'))) {
        throw new Error(`Chrome connection refused on port ${this.port}. The browser might have closed or blocked the connection. Error: ${err.message}`);
      }
      throw new Error(`Failed to get tab client: ${err.message}`);
    }
  }

  /**
   * Execute CDP command
   */
  async executeCommand(domain: string, method: string, params?: any): Promise<any> {
    const client = this.getConnection().client;

    try {
      const result = await client.send(`${domain}.${method}`, params);
      return result;
    } catch (error) {
      throw new Error(`CDP command failed: ${domain}.${method} - ${(error as Error).message}`);
    }
  }

  /**
   * Get Chrome version info
   */
  async getVersion(): Promise<any> {
    try {
      const version = await CDP.Version({ port: this.port });
      return version;
    } catch (error) {
      throw new Error(`Failed to get Chrome version: ${(error as Error).message}`);
    }
  }

  /**
   * Set current tab
   */
  setCurrentTab(tabId: string): void {
    this.currentTabId = tabId;
  }

  /**
   * Get current tab ID
   */
  getCurrentTabId(): string | null {
    return this.currentTabId;
  }

  /**
   * Get or create a persistent client for interceptors
   * These clients stay alive for the entire session
   */
  async getPersistentClient(tabId?: string): Promise<any> {
    const effectiveTabId = tabId || 'default';

    // Return existing persistent client if available
    if (this.persistentClients.has(effectiveTabId)) {
      return this.persistentClients.get(effectiveTabId);
    }

    // Create new persistent client using same logic as getTabClient
    const target = tabId || this.currentTabId;

    let targetId = target;
    if (!targetId) {
      const tabs = await this.listTabs();
      if (tabs.length === 0) {
        throw new Error('No open tabs available');
      }
      targetId = tabs[0].id;
    }

    const client = await CDP({ port: this.port, target: targetId });

    // Store it persistently
    this.persistentClients.set(effectiveTabId, client);

    console.error(`[Persistent Client] Created for tab: ${effectiveTabId}`);

    return client;
  }

  /**
   * Close persistent client (used when disabling interceptors)
   */
  async closePersistentClient(tabId?: string): Promise<void> {
    const effectiveTabId = tabId || 'default';

    if (this.persistentClients.has(effectiveTabId)) {
      const client = this.persistentClients.get(effectiveTabId);
      try {
        await client.close();
      } catch (e) {
        console.error(`[Persistent Client] Error closing client:`, e);
      }
      this.persistentClients.delete(effectiveTabId);
      console.error(`[Persistent Client] Closed for tab: ${effectiveTabId}`);
    }
  }

  /**
   * Helper to inject a visual connection status toast into the page
   */
  async injectConnectionStatus(targetId: string): Promise<void> {
    try {
      const client = await this.getTabClient(targetId);
      await client.Runtime.evaluate({
        expression: `
            (function() {
                try {
                    const id = 'mcp-status-toast';
                    const existing = document.getElementById(id);
                    if(existing) existing.remove();
                    const div = document.createElement('div');
                    div.id = id;
                    div.innerHTML = "🤖 MCP Agent Conectado";
                    div.style = "position:fixed;bottom:20px;right:20px;background:#22c55e;color:white;padding:12px 24px;z-index:2147483647;border-radius:8px;font-family:system-ui,sans-serif;font-weight:bold;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.5s ease;pointer-events:none;";
                    document.body.appendChild(div);
                    setTimeout(() => { 
                        div.style.opacity = '0';
                        setTimeout(() => div.remove(), 500);
                    }, 5000);
                } catch(e){}
            })()
            `
      });
    } catch (e) { /* ignore injection errors */ }
  }

  /**
   * Helper to ensure a specific target's window is visible and restored
   */
  async ensureWindowVisible(targetId: string): Promise<void> {
    try {
      const client = this.getConnection().client;

      // 1. Activate using Target domain
      await client.Target.activateTarget({ targetId });
      console.error('✅ Target activated');

      // 2. Try to get window state using Browser domain (if supported)
      try {
        // Get window for target
        const { windowId, bounds } = await client.Browser.getWindowForTarget({ targetId });

        // Check for negative/impossible coordinates (common multi-monitor issue)
        const isOffScreen = (bounds.left !== undefined && bounds.left < 0) ||
          (bounds.top !== undefined && bounds.top < 0);

        if (isOffScreen) {
          console.error('⚠️ Window detected off-screen. Recentering...');
          await client.Browser.setWindowBounds({
            windowId,
            bounds: { left: 100, top: 100, width: 1280, height: 720, windowState: 'normal' }
          });
          console.error('✅ Window recentered');
        } else if (bounds.windowState === 'minimized' || bounds.windowState === 'hidden') {
          console.error(`⚠️ Window is ${bounds.windowState}, restoring...`);
          await client.Browser.setWindowBounds({
            windowId,
            bounds: { windowState: 'normal' }
          });
          console.error('✅ Window restored to normal state');
        } else {
          // If it's already normal/maximized/fullscreen, still good to ensure focus
          console.error(`Status: Window state is '${bounds.windowState}'`);
        }
      } catch (browserErr) {
        // Browser domain might not be fully supported in all versions or contexts
        console.error('⚠️ Could not check window state via Browser domain (optional):', (browserErr as Error).message);
      }

      // 3. Fallback: Windows specific PowerShell to force window to front
      if (os.platform() === 'win32') {
        let pid = this.chromeProcess?.pid;

        // If we don't have PID (we connected to existing instance), try to get it via CDP SystemInfo
        if (!pid) {
          try {
            const sysInfo = await client.SystemInfo.getProcessInfo();
            // find browser process
            const browserProc = sysInfo.processInfo.find((p: any) => p.type === 'browser');
            if (browserProc) {
              pid = browserProc.id;
              console.error(`Status: Identified Chrome PID ${pid} via CDP`);
            }
          } catch (e) {
            // SystemInfo might not be available
          }
        }

        if (pid) {
          const psCmd = `
                    Add-Type -AssemblyName Microsoft.VisualBasic
                    [Microsoft.VisualBasic.Interaction]::AppActivate(${pid})
                 `;

          try {
            // We use execAsync to run the powershell command
            await execAsync(`powershell -Command "${psCmd}"`);
            console.error('✅ Windows API Activate executed (Foreground Forced)');
          } catch (psErr) {
            console.error('⚠️ Windows API Activate failed:', (psErr as Error).message);
          }
        }
      }

    } catch (e) {
      console.error('⚠️ Ensure Window Visible failed:', (e as Error).message);
    }
  }
}
