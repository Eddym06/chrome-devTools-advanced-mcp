/**
 * Playwright Launcher Tool
 * Launch browsers with user profile using Playwright
 */

import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { ChromeConnector } from '../chrome-connector.js';

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'launch_chrome_with_profile',
      description: 'Launch Google Chrome with your real profile (cookies, extensions, sessions). IMPORTANT: Only call this tool when the user EXPLICITLY asks to open or launch Chrome. Do NOT call it automatically or proactively.',
      inputSchema: z.object({
        profileDirectory: z.string().default('Default').describe('Profile directory name: "Default", "Profile 1", etc.')
      }),
      handler: async ({ profileDirectory }: any) => {
        try {
          console.error(`[launch_chrome] profile: ${profileDirectory}`);
          await connector.launchWithProfile({
            headless: false,
            profileDirectory,
            force: true,   // disconnect any existing connection first
          });

          return {
            success: true,
            message: `Chrome launched with profile: ${profileDirectory}`,
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
      description: 'Close the Playwright-managed browser and release all connections. Only works for browsers launched by this MCP.',
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
