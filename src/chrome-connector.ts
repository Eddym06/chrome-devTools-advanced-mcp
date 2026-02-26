/**
 * Chrome Connection Manager
 * Handles connection to existing Chrome instance via CDP
 * Now with Playwright support for launching browser
 */

import CDP from 'chrome-remote-interface';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { spawn, type ChildProcess, exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
}

export class ChromeConnector {
  private connection: ChromeConnection | null = null;
  private port: number;
  private currentTabId: string | null = null;
  private browserContext: BrowserContext | null = null;
  private chromeProcess: ChildProcess | null = null;
  private persistentClients: Map<string, any> = new Map(); // Persistent clients for interceptors
  private stealthApplied = false; // Applied once per connection session

  constructor(port: number = 9222) {
    this.port = port;
  }

  /**
   * Get platform-specific Chrome paths
   */
  private getPlatformPaths(): { executable: string; userDataDir: string } {
    const platform = os.platform();

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

        return {
          executable,
          userDataDir: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`
        };
      case 'darwin':
        return {
          executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          userDataDir: `${process.env.HOME}/Library/Application Support/Google/Chrome`
        };
      case 'linux':
        return {
          executable: '/usr/bin/google-chrome',
          userDataDir: `${process.env.HOME}/.config/google-chrome`
        };
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * createShadowProfile: Clones essential parts of the profile to a temp dir
   * to bypass Chrome's restriction on debugging the Default profile.
   * Cross-platform: uses robocopy on Windows, rsync on Unix systems.
   */
  private async createShadowProfile(sourceUserData: string, profileName: string): Promise<string> {
    const tempDir = path.join(os.tmpdir(), 'chrome-mcp-shadow');
    const platform = os.platform();
    const profileDest = path.join(tempDir, profileName);

    // Ensure parent dir exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.error(`👥 Creating/Updating Shadow Profile at: ${tempDir}`);
    console.error(`   Platform: ${platform}`);
    console.error(`   Source: ${sourceUserData}`);

    // 1. Copy Local State (critical for encryption keys + profiles list)
    const localStateSrc = path.join(sourceUserData, 'Local State');
    const localStateDest = path.join(tempDir, 'Local State');
    try {
      if (fs.existsSync(localStateSrc)) {
        fs.copyFileSync(localStateSrc, localStateDest);
      }
    } catch (e) { console.error('Warning: could not copy Local State', e); }

    // 2. Copy the profile folder (platform-specific)
    const profileSrc = path.join(sourceUserData, profileName);

    // Exclude heavy cache folders to make launch fast and avoid locked files
    const excludeDirs = [
      "Cache",
      "Code Cache",
      "GPUCache",
      "DawnCache",
      "ShaderCache",
      "Safe Browsing",
      "File System",
      "Service Worker\\CacheStorage",
      "Service Worker\\ScriptCache",
      "VideoDecodeStats",
      "History Provider Cache",
      "optimization_guide_hint_cache_store",
      "AutofillStrikeDatabase"
    ];

    if (platform === 'win32') {
      // Windows: use robocopy
      const xdParams = excludeDirs.map(d => `"${d}"`).join(' ');
      // /MIR = Mirror, /XD = Exclude Dirs, /R:0 /W:0 = No retries, /XJ = No junctions, /MT = Multi-thread
      const cmd = `robocopy "${profileSrc}" "${profileDest}" /MIR /XD ${xdParams} /R:0 /W:0 /XJ /MT:16`;

      try {
        await execAsync(cmd);
      } catch (e: any) {
        // Robocopy exit codes: 0-7 are success/partial, 8+ is failure
        if (e.code > 7) {
          console.error('⚠️ Shadow Profile copy had errors (Chrome may be running):', e.stderr?.slice(0, 200));
        }
      }
    } else {
      // Unix (Mac/Linux): use rsync
      const excludeParams = excludeDirs.map(d => `--exclude="${d}"`).join(' ');
      const cmd = `rsync -av --delete ${excludeParams} "${profileSrc}/" "${profileDest}/"`;

      try {
        await execAsync(cmd);
        console.error('✅ Profile copied via rsync');
      } catch (e: any) {
        console.error('⚠️ Shadow Profile copy had errors:', e.message);
      }
    }

    // ─── CRITICAL FIX ────────────────────────────────────────────────────────
    // Chrome writes SingletonLock / SingletonSocket / SingletonCookie when it
    // starts.  If a previous session was killed (not cleanly closed) these
    // files remain.  A new Chrome instance sees them, thinks another Chrome is
    // already running in this profile, and exits immediately with code 0.
    // Delete them before every launch so Chrome always starts fresh.
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const lf of lockFiles) {
      // Delete from root of user-data dir AND from inside the profile subdir
      for (const dir of [tempDir, profileDest]) {
        const p = path.join(dir, lf);
        try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.error(`🔓 Removed stale lock: ${p}`); } }
        catch { /* non-fatal */ }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    return tempDir;
  }

  /**
   * Launch Chrome manually using child_process to avoid blocking and argument issues
   * This is more robust for persistent profiles than Playwright's launcher
   */
  async launchWithProfile(options: LaunchOptions = {}): Promise<void> {
    // 1. Check connections
    if (this.connection?.connected) {
      if (!options.force) {
        // Not a forced re-launch: just ensure the window is visible and return.
        console.error('✅ Already connected to a Chrome instance. Bringing window to foreground...');
        await this.bringWindowToForeground();
        return;
      }
      // Forced re-launch (e.g. user explicitly called launch_edge or launch_chrome):
      // disconnect from the current browser before spawning a new one.
      console.error('🔄 Force re-launch requested. Disconnecting current browser...');
      await this.disconnect();
    }

    try {
      // Check if a real browser is already running on the port and connect to it.
      const isReal = await this.isRealBrowserOnPort();
      if (isReal) {
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
        return;
      }
    } catch (e) {
      // Port free or not a real browser – proceed to launch.
    }

    const platformPaths = this.getPlatformPaths();

    let {
      userDataDir,
      profileDirectory = 'Default',
      executablePath = platformPaths.executable
    } = options;

    const originalUserDataDir = userDataDir || platformPaths.userDataDir;
    let finalUserDataDir = originalUserDataDir;

    // 2. Handle Shadow Profile Logic
    // If identifying as Default profile, we MUST clone it to avoid debug lock
    // ONLY IF we are not already pointing to a custom dir (userDataDir was null/undefined originally)
    if (profileDirectory === 'Default' && !userDataDir) {
      try {
        console.error("🔒 Default profile requested. Creating/Updating Shadow Copy to enable debugging...");
        finalUserDataDir = await this.createShadowProfile(originalUserDataDir, profileDirectory);
      } catch (err) {
        console.error("❌ Failed to create shadow profile, attempting raw launch (may fail):", err);
        finalUserDataDir = originalUserDataDir;
      }
    }

    console.error(`🚀 Launching Chrome Native...`);
    console.error(`   User Data: ${finalUserDataDir}`);
    console.error(`   Profile: ${profileDirectory}`);

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${finalUserDataDir}`,
      `--profile-directory=${profileDirectory}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--exclude-switches=enable-automation',
      '--use-mock-keychain',
      '--password-store=basic',
      '--new-window',         // ← always open a visible window
      '--start-maximized',    // ← open maximized so it's easy to see
    ];

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

    // Close file descriptors after Chrome has started
    setTimeout(() => {
      try {
        fs.closeSync(out);
        fs.closeSync(err);
      } catch (e) { }
    }, 5000);

    // ENHANCED VERIFICATION SYSTEM
    // Wait 3 seconds before starting verification
    console.error('⏳ Waiting 3 seconds for Chrome to fully initialize...');
    await new Promise(r => setTimeout(r, 3000));

    // Step 1: Verify process is still running via system command
    console.error('🔍 Step 1: Verifying Chrome process is running...');

    // Wait for Chrome to initialize
    const waitTime = 3000;
    console.error(`⏳ Waiting ${waitTime}ms for process to settle...`);
    await new Promise(r => setTimeout(r, waitTime));

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
        portCheckCmd = `powershell -Command "netstat -ano | Select-String ':${this.port}' | Select-String 'LISTENING'"`;
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
  }

  /**
   * Handle Chrome process death - cleanup internal state
   */
  private handleProcessDeath(): void {
    console.error('🧹 Cleaning up internal state due to Chrome process death...');

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

    // Clear process reference
    this.chromeProcess = null;
    this.currentTabId = null;
    this.stealthApplied = false;

    console.error('✅ Internal state cleared. Ready for new launch.');
  }

  /**
   * Disconnect from Chrome and close Playwright browser
   */
  async disconnect(): Promise<void> {
    if (this.connection?.client) {
      await this.connection.client.close();
      this.connection = null;
      console.error('Disconnected from Chrome CDP');
    }

    if (this.browserContext) {
      await this.browserContext.close();
      this.browserContext = null;
      console.error('Closed Playwright context');
    }

    if (this.chromeProcess) {
      // optional: kill process? usually we just disconnect
      // this.chromeProcess.kill(); 
      this.chromeProcess = null;
    }
  }

  /**
   * Connect to existing Chrome instance
   */
  async connect(): Promise<void> {
    try {
      const client = await CDP({ port: this.port });

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
   * Verify that the process on the CDP port is actually a controllable
   * Chrome/Edge browser, NOT a background process like msedgewebview2.exe
   * that may also listen on 9222 but is NOT scriptable via CDP.
   * We do this by fetching /json/version and checking the "Browser" field.
   */
  private async isRealBrowserOnPort(): Promise<boolean> {
    try {
      const http = await import('http');
      return await new Promise<boolean>((resolve) => {
        const req = http.default.get(
          `http://localhost:${this.port}/json/version`,
          { timeout: 2000 },
          (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                // A real Chrome/Edge exposes a "Browser" field like
                // "Chrome/145.0..." or "Edg/...".
                // EdgeWebView2 either returns nothing useful or its
                // Browser field contains "HeadlessChrome" without a
                // real window – we block WebView2 by checking the
                // User-Agent / webSocketDebuggerUrl quirks.
                const browser: string = json.Browser || '';
                const isWebView = (json['User-Agent'] || '').includes('WebView') ||
                  browser.toLowerCase().includes('webview');
                const hasValidBrowser = browser.length > 0 && !isWebView;
                console.error(`[Port-check] /json/version Browser: "${browser}" → ${hasValidBrowser ? 'REAL' : 'NOT real (WebView2 or empty)'}`);
                resolve(hasValidBrowser);
              } catch {
                resolve(false);
              }
            });
          }
        );
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
    } catch {
      return false;
    }
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
        await CDP.List({ port: this.port });
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
   * Build a comprehensive browser stealth script.
   * Covers: webdriver flag, plugins, permissions API, navigator hints,
   * canvas fingerprint noise, WebGL vendor/renderer spoof, audio noise.
   * The seed is random per-session so fingerprints differ between sessions
   * but remain stable within a single session.
   */
  private buildStealthScript(): string {
    return `(function() {
  // Session-unique seed – same site gets consistent pixels within a session,
  // different fingerprint in every new session.
  const _seed = Math.random() * 1e10;

  // ── 1. Hide webdriver flag ──────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  } catch(e) {}

  // ── 2. Realistic plugin list ────────────────────────────────────────────
  try {
    Object.defineProperty(navigator, 'plugins', {
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
  } catch(e) {}

  // ── 3. Permissions API ──────────────────────────────────────────────────
  try {
    const _origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : _origQuery(params);
  } catch(e) {}

  // ── 4. chrome.runtime stub ──────────────────────────────────────────────
  try {
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) window.chrome.runtime = {};
  } catch(e) {}

  // ── 5. Navigator / hardware hints ───────────────────────────────────────
  [
    ['languages',          () => ['en-US', 'en']],
    ['platform',           () => 'Win32'],
    ['hardwareConcurrency',() => 8],
    ['deviceMemory',       () => 8],
  ].forEach(([k, v]) => {
    try { Object.defineProperty(navigator, k, { get: v, configurable: true }); } catch(e) {}
  });

  // ── 6. Screen ───────────────────────────────────────────────────────────
  try { Object.defineProperty(screen, 'availWidth',  { get: () => screen.width,        configurable: true }); } catch(e) {}
  try { Object.defineProperty(screen, 'availHeight', { get: () => screen.height - 40,  configurable: true }); } catch(e) {}

  // ── 7. toString leak fix ────────────────────────────────────────────────
  try {
    const _origTS = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === window.navigator.permissions.query) {
        return 'function query() { [native code] }';
      }
      return _origTS.call(this);
    };
  } catch(e) {}

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

    const _orig_getImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
      const id = _orig_getImageData.call(this, sx, sy, sw, sh);
      const d  = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = _px(i);
        d[i]   = Math.max(0, Math.min(255, d[i]   + n));
        d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
        d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
      }
      return id;
    };
  } catch(e) {}

  // ── 9. WebGL vendor / renderer spoof ────────────────────────────────────
  // Replaces GPU strings with generic Intel values so WebGL fingerprint
  // cannot identify your real GPU model.
  function _patchWebGL(proto) {
    if (!proto) return;
    const _orig = proto.getParameter;
    proto.getParameter = function(p) {
      if (p === 37445) return 'Intel Open Source Technology Center';          // UNMASKED_VENDOR_WEBGL
      if (p === 37446) return 'Mesa DRI Intel(R) Iris(R) Plus Graphics (ICL GT2)'; // UNMASKED_RENDERER_WEBGL
      return _orig.call(this, p);
    };
  }
  try { if (typeof WebGLRenderingContext  !== 'undefined') _patchWebGL(WebGLRenderingContext.prototype);  } catch(e) {}
  try { if (typeof WebGL2RenderingContext !== 'undefined') _patchWebGL(WebGL2RenderingContext.prototype); } catch(e) {}

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
    if (!force && this.stealthApplied) return;
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
      console.error('[Stealth] Stealth mode applied automatically');
    } catch (err) {
      console.error('[Stealth] Could not apply stealth mode (non-fatal):', (err as Error).message);
    }
  }



  /**
   * List all open tabs and targets (including service workers)
   */
  async listTabs(): Promise<TabInfo[]> {
    try {
      const targets = await CDP.List({ port: this.port });

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
   * Get active tab
   */
  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await this.listTabs();
    return tabs.length > 0 ? tabs[0] : null;
  }

  /**
   * Create new tab
   */
  async createTab(url?: string): Promise<TabInfo> {
    try {
      const newTab = await CDP.New({ port: this.port, url });

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
        // Get the first available tab
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
        return await CDP({ port: this.port, target: tabs[0].id });
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
