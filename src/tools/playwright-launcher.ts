/**
 * Playwright Launcher Tool
 * Launch browsers with user profile using Playwright
 */

import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';
import type { ChromeConnector } from '../chrome-connector.js';

/**
 * Resolve Edge executable path across platforms
 */
function getEdgePaths(): { userDataDir: string; executablePath: string } {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return {
      userDataDir: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    };
  } else if (platform === 'darwin') {
    return {
      userDataDir: path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
      executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    };
  } else {
    // Linux
    return {
      userDataDir: path.join(os.homedir(), '.config', 'microsoft-edge'),
      executablePath: '/usr/bin/microsoft-edge'
    };
  }
}

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'launch_edge_with_profile',
      description: 'Launch Microsoft Edge with your profile (cookies, extensions, sessions). Close all Edge windows first. Most features work identically to Chrome.',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name: "Default", "Profile 1", etc.')
      }),
      handler: async ({ profileDirectory }: any) => {
        try {
          const edgePaths = getEdgePaths();
          
          await connector.launchWithProfile({
            headless: false,
            profileDirectory,
            userDataDir: edgePaths.userDataDir,
            executablePath: edgePaths.executablePath
          });
          
          return {
            success: true,
            message: `Edge launched with profile: ${profileDirectory}`,
            cdpPort: connector.getPort()
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    },
    
    {
      name: 'close_browser',
      description: 'Close Google Chrome and release all connections. This is the ONLY tool that can close Chrome. Use this to fully stop Chrome before relaunching with a fresh session.',
      inputSchema: z.object({}),
      handler: async () => {
        try {
          const result = await connector.killChrome();
          return { success: result.killed, message: result.message };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message
          };
        }
      }
    },
    
    {
      name: 'get_browser_status',
      description: 'Check browser connection status, CDP port, and whether managed by Playwright or external.',
      inputSchema: z.object({}),
      handler: async () => {
        const isConnected = connector.isConnected();
        const isPlaywright = connector.isPlaywrightManaged();
        
        return {
          success: true,
          connected: isConnected,
          playwrightManaged: isPlaywright,
          port: connector.getPort(),
          status: isConnected 
            ? (isPlaywright ? 'Running via Playwright' : 'Connected to external Chrome') 
            : 'Not connected'
        };
      }
    }
  ];
}
