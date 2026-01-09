/**
 * Playwright Launcher Tool
 * Launch Chrome with user profile using Playwright
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'launch_chrome_with_profile',
      description: 'Launch Chrome using Playwright with your user profile (keeps cookies, sessions, extensions). This is the recommended way to start Chrome.',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name: "Default", "Profile 1", "Profile 2", etc.'),
        userDataDir: z.string().optional().describe('Full path to Chrome User Data directory. Leave empty for default location.')
      }),
      handler: async ({ profileDirectory, userDataDir }: any) => {
        try {
          const options: any = {
            headless: false,
            profileDirectory
          };
          
          if (userDataDir) {
            options.userDataDir = userDataDir;
          }
          
          await connector.launchWithProfile(options);
          
          return {
            success: true,
            message: `Chrome launched with profile: ${profileDirectory}`,
            cdpPort: connector.getPort(),
            note: 'Chrome is now running with all your cookies, sessions, and extensions. Use other MCP tools to interact with it.'
          };
        } catch (error) {
          return {
            success: false,
            error: (error as Error).message,
            suggestion: 'Make sure Chrome is not already running. Close all Chrome windows and try again.'
          };
        }
      }
    },
    
    {
      name: 'launch_edge_with_profile',
      description: 'Launch Microsoft Edge using Playwright with your user profile',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name')
      }),
      handler: async ({ profileDirectory }: any) => {
        try {
          const edgeUserData = `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\User Data`;
          const edgeExe = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
          
          await connector.launchWithProfile({
            headless: false,
            profileDirectory,
            userDataDir: edgeUserData,
            executablePath: edgeExe
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
      description: 'Close the Playwright-managed browser instance',
      inputSchema: z.object({}),
      handler: async () => {
        try {
          if (!connector.isPlaywrightManaged()) {
            return {
              success: false,
              message: 'No Playwright-managed browser to close'
            };
          }
          
          await connector.disconnect();
          
          return {
            success: true,
            message: 'Browser closed successfully'
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
      name: 'get_browser_status',
      description: 'Check if browser is running and how it was launched',
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
