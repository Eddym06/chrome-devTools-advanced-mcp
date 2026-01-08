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
        return {
          executable: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
    // 1. Check connections
    if (this.connection?.connected) {
      console.error('✅ Already connected to a Chrome instance.');
      return;
    }

    try {
      // Check if port is open
      await this.connect();
      console.error(`✅ Detected and connected to existing Chrome on port ${this.port}`);
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

    // Spawn completely detached process to prevent MCP hang
    // Using 'pipe' for stderr to capture launch errors if any
    this.chromeProcess = spawn(executablePath, args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'], 
      windowsHide: false
    });

    let startupLogs = '';
    if (this.chromeProcess.stderr) {
      this.chromeProcess.stderr.on('data', (data) => {
        startupLogs += data.toString();
        console.error(`Chrome Err: ${data.toString()}`);
      });
    }

    const processExited = new Promise<never>((_, reject) => {
      this.chromeProcess?.on('exit', (code) => {
        if (code !== 0) {
            reject(new Error(`Chrome process exited immediately with code ${code}. Logs: ${startupLogs}`));
        }
      });
      this.chromeProcess?.on('error', (err) => {
        reject(new Error(`Failed to spawn Chrome process: ${err.message}`));
      });
    });

    // Race condition: wait for 3s OR for the process to exit
    // Increased timeout to 5s for heavy profiles
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));

    // Wait for either timeout (success) or exit (failure)
    try {
        await Promise.race([timeout, processExited]);
    } catch (e) {
        this.chromeProcess = null;
        throw e;
    }

    // If we got here, process didn't crash in the first 5 seconds
    this.chromeProcess.unref(); 
    if (this.chromeProcess.stderr) {
        this.chromeProcess.stderr.destroy();
    }

    console.error(`✅ Chrome process spawned and stable (PID: ${this.chromeProcess.pid})`);
    
    // Connect to CDP with retries
    let connected = false;
    for (let i = 0; i < 5; i++) {
        try {
            await this.connect();
            connected = true;
            break;
        } catch (e) {
            console.error(`Starting CDP connection attempt ${i+1}/5 failed. Retrying...`);
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    
    if (!connected) {
         throw new Error(`Chrome launched (PID ${this.chromeProcess.pid}) but port ${this.port} is not accessible after 10s. Logs: ${startupLogs}`);
    }

    // VERIFICATION: Check if we can actually list targets (proves browser is responsive)
    try {
      const targets = await this.listTabs();
      console.error(`✅ Verification: Found ${targets.length} targets.`);
      
      if (targets.length === 0) {
        console.error('⚠️ Warning: Browser running but no targets found.');
      }
    } catch (verErr) {
       console.error('⚠️ Warning: Could not verify targets listing:', verErr);
    }

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
        const tabs = await this.listTabs();
        if (tabs.length === 0) {
          throw new Error('No tabs available');
        }
        return await CDP({ port: this.port, target: tabs[0].id });
      }
      
      return await CDP({ port: this.port, target });
    } catch (error) {
      throw new Error(`Failed to get tab client: ${(error as Error).message}`);
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
   * Get current port
   */
  getPort(): number {
    return this.port;
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
}
