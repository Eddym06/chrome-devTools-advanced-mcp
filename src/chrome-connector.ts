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
}

export class ChromeConnector {
  private connection: ChromeConnection | null = null;
  private port: number;
  private currentTabId: string | null = null;
  private browserContext: BrowserContext | null = null;
  private chromeProcess: ChildProcess | null = null;
  private persistentClients: Map<string, any> = new Map(); // Persistent clients for interceptors

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
    
    // Ensure parent dir exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    console.error(`👥 Creating Shadow Profile structure at: ${tempDir}`);
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
    const profileDest = path.join(tempDir, profileName);
    
    // Exclude heavy cache folders to make launch fast
    const excludeDirs = [
        "Cache", 
        "Code Cache", 
        "GPUCache", 
        "DawnCache", 
        "ShaderCache",
        "Safe Browsing",
        "File System",
        "Service Worker/CacheStorage",
        "Service Worker/ScriptCache"
    ];
    
    let cmd: string;
    
    if (platform === 'win32') {
      // Windows: use robocopy
      const xdParams = excludeDirs.map(d => `"${d}"`).join(' ');
      // /MIR = Mirror, /XD = Exclude Dirs, /R:0 /W:0 = No retries, /XJ = No junctions, /MT = Multi-thread
      cmd = `robocopy "${profileSrc}" "${profileDest}" /MIR /XD ${xdParams} /R:0 /W:0 /XJ /MT:16`;
      
      try {
          await execAsync(cmd);
      } catch (e: any) {
          // Robocopy exit codes: 0-7 are success/partial, 8+ is failure
          if (e.code > 7) {
              console.error('⚠️ Shadow Profile copy had errors:', e.message);
          }
      }
    } else {
      // Unix (Mac/Linux): use rsync
      const excludeParams = excludeDirs.map(d => `--exclude="${d}"`).join(' ');
      cmd = `rsync -av --delete ${excludeParams} "${profileSrc}/" "${profileDest}/"`;
      
      try {
          await execAsync(cmd);
          console.error('✅ Profile copied via rsync');
      } catch (e: any) {
          console.error('⚠️ Shadow Profile copy had errors:', e.message);
      }
    }
    
    return tempDir;
  }

  /**
   * Launch Chrome manually using child_process to avoid blocking and argument issues
   * This is more robust for persistent profiles than Playwright's launcher
   */
  async launchWithProfile(options: LaunchOptions = {}): Promise<void> {
    console.error(`[launchWithProfile] >>> CALLED AT: ${new Date().toISOString()}`);
    console.error(`[launchWithProfile] Profile: ${options.profileDirectory || 'Default'}`);
    console.error('[launchWithProfile] Stack trace:');
    try {
      throw new Error('STACK_TRACE');
    } catch (e: any) {
      console.error(e.stack.split('\n').slice(2, 8).join('\n'));
    }
    
    // 1. Check connections
    if (this.connection?.connected) {
      console.error('✅ Already connected to a Chrome instance.');
      return;
    }

    try {
      // Check if port is open
      await this.connect();
      console.error(`✅ Detected and connected to existing Chrome on port ${this.port}`);
      
      // CHECK: If connected but no pages are open, it might be a background process or invisible.
      // We should try to ensure a window is visible.
      const tabs = await this.listTabs();
      const hasPages = tabs.some(t => t.type === 'page');
      
      if (!hasPages) {
           console.error('⚠️ Connection active but no open pages found (possible background process). Opening new tab to ensure visibility...');
           try {
               await this.connection?.client.Target.createTarget({ url: 'about:blank' });
           } catch (createErr) {
               console.error('❌ Failed to create new target in existing instance:', createErr);
           }
      }

      // Force activation of the first page to ensure window is visible/foreground
      try {
          const currentTabs = await this.listTabs();
          const page = currentTabs.find(t => t.type === 'page');
          if (page) {
              await this.ensureWindowVisible(page.id); // NEW HELPER
          }
      } catch (activateErr) {
          console.error('⚠️ Could not activate window:', activateErr);
      }
      
      return;
    } catch (e) {
      // Port free, proceed
    }
    
    const platformPaths = this.getPlatformPaths();
    
    let {
      userDataDir,
      profileDirectory = 'Default',
      executablePath = platformPaths.executable
    } = options;

    const originalUserDataDir = userDataDir || platformPaths.userDataDir;
    
    // Default to the original unless shadowed
    let finalUserDataDir = originalUserDataDir;

    // 2. Handle Shadow Profile Logic
    // If identifying as Default profile, we MUST clone it to avoid debug lock
    // ONLY IF we are not already pointing to a custom dir (userDataDir was null/undefined originally)
    if (profileDirectory === 'Default' && !userDataDir) {
       try {
           console.error("🔒 Default profile requested. Creating Shadow Copy to enable debugging...");
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
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--exclude-switches=enable-automation',
      '--use-mock-keychain',
      '--password-store=basic'
    ];
    
    console.error(`   Args: ${JSON.stringify(args)}`);

    // Use standard spawn with file logging for detachment + debug
    const logFile = path.join(os.tmpdir(), 'chrome-mcp-debug.log');
    
    // Ensure we can write to log file
    try { fs.writeFileSync(logFile, ''); } catch(e){}
    
    console.error(`   Logging to: ${logFile}`);

    // Keep Chrome as a child process - it will survive as long as the MCP server is running
    const out = fs.openSync(logFile, 'a');
    const err = fs.openSync(logFile, 'a');

    this.chromeProcess = spawn(executablePath, args, {
      detached: false,  // Keep as child
      stdio: ['ignore', out, err],
      windowsHide: false
    });

    // Setup process death detection
    this.chromeProcess.on('exit', (code, signal) => {
      console.error(`⚠️ Chrome process died (PID: ${this.chromeProcess?.pid}, code: ${code}, signal: ${signal})`);
      this.handleProcessDeath();
    });

    this.chromeProcess.on('error', (err) => {
      console.error(`⚠️ Chrome process error:`, err);
      this.handleProcessDeath();
    });

    // Don't call unref() - keep the process attached to the MCP server
    
    console.error(`✅ Chrome process spawned (PID: ${this.chromeProcess.pid})`);
    
    // Close file descriptors after Chrome has started
    setTimeout(() => {
      try {
        fs.closeSync(out);
        fs.closeSync(err);
      } catch(e) {}
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
    if (this.chromeProcess && this.chromeProcess.pid) {
      try {
        const platform = os.platform();
        let processCheckCmd: string;
        
        if (platform === 'win32') {
          processCheckCmd = `powershell -Command "Get-Process -Id ${this.chromeProcess.pid} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty ProcessName"`;
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
            console.error(`✅ CDP connection established (attempt ${i+1})`);
            break;
        } catch (e) {
            console.error(`   Attempt ${i+1}/8 failed. Retrying in 1s...`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    if (!connected) {
         let logs = 'Check log file';
         try { logs = fs.readFileSync(logFile, 'utf8'); } catch(e){}
         throw new Error(`Chrome process is running (PID ${this.chromeProcess!.pid}) but CDP port ${this.port} is not accessible after 15s. Logs: ${logs}`);
    }

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
    console.error(`   Process: Running (PID ${this.chromeProcess!.pid})`);
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
        this.connection.client.close().catch(() => {});
      } catch (e) {}
      this.connection = null;
    }
    
    // Clear browser context
    if (this.browserContext) {
      try {
        const browser = this.browserContext.browser();
        if (browser) {
          browser.close().catch(() => {});
        }
      } catch (e) {}
      this.browserContext = null;
    }
    
    // Clear process reference
    this.chromeProcess = null;
    this.currentTabId = null;
    
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
   * Ensure Chrome is connected, auto-launching if needed.
   * Called automatically before every tool invocation.
   */
  async ensureConnected(): Promise<void> {
    console.error(`[ensureConnected] >>> CALLED AT: ${new Date().toISOString()}`);
    console.error('[ensureConnected] Stack trace:');
    try {
      throw new Error('STACK_TRACE');
    } catch (e: any) {
      console.error(e.stack.split('\n').slice(2, 8).join('\n'));
    }
    
    // Already connected - verify it's still alive
    if (this.connection?.connected) {
      try {
        const targets = await CDP.List({ port: this.port });
        if (targets && targets.length > 0) {
          return; // Connection is alive and has targets
        }
        throw new Error('Chrome process alive but no targets available');
      } catch (err) {
        console.error('[Auto-connect] Connection dead, cleaning up...', (err as Error).message);
        this.handleProcessDeath();
      }
    }

    // Try to connect to an existing Chrome instance on the port
    try {
      await this.connect();
      console.error(`[Auto-connect] Connected to existing Chrome on port ${this.port}`);
      
      // Attach Playwright wrapper if possible
      try {
        const browser = await chromium.connectOverCDP(`http://localhost:${this.port}`);
        this.browserContext = browser.contexts()[0];
        console.error('[Auto-connect] Playwright wrapper attached');
      } catch { /* CDP still works without Playwright */ }
      
      return;
    } catch (err) {
      console.error('[Auto-connect] No Chrome found on port', this.port, '-', (err as Error).message);
    }

    // Launch Chrome with Default profile
    console.error('[Auto-connect] Launching Chrome with Default profile...');
    try {
      await this.launchWithProfile({ profileDirectory: 'Default' });
      console.error('[Auto-connect] Chrome launched successfully');
    } catch (launchErr) {
      const err = launchErr as Error;
      console.error('[Auto-connect] Failed to launch Chrome:', err.message);
      throw new Error(`Failed to launch Chrome: ${err.message}. Try: 1) Close all Chrome windows, 2) Check port ${this.port} is available, 3) Restart VS Code`);
    }
  }

  /**
   * Get the CDP port number
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Verify Chrome is alive and connected to port 9222
   * Throws error if connection is dead
   */
  async verifyConnection(): Promise<void> {
    // Check if we think we're connected
    if (!this.connection?.connected) {
      throw new Error('Not connected to Chrome. Launch Chrome first using launch_chrome_with_profile.');
    }

    // Verify port is actually accessible
    try {
      const targets = await CDP.List({ port: this.port });
      if (!targets || targets.length === 0) {
        throw new Error('Chrome CDP is accessible but no targets found');
      }
      console.error(`✅ Connection verified: ${targets.length} targets on port ${this.port}`);
    } catch (error) {
      const err = error as Error;
      // Connection is dead - clean up
      this.handleProcessDeath();
      throw new Error(
        `Chrome connection is dead (port ${this.port} not responding). ` +
        `Chrome may have been killed externally. Please launch Chrome again. ` +
        `Error: ${err.message}`
      );
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
