/**
 * Playwright Launcher Tool
 * Launch browsers with user profile using Playwright
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'launch_chrome_with_profile',
      description: 'Launch Google Chrome on a managed clone of your real profile (cookies, sessions, logins), so it opens already signed in. IMPORTANT: Only call this tool when the user EXPLICITLY asks to open or launch Chrome. Do NOT call it automatically or proactively.',
      inputSchema: z.object({
        profileDirectory: z
          .string()
          .default('auto')
          .describe('Profile to use: "auto" (main/logged-in profile), "Default", "Profile 1", a number, or a profile display name'),
        cloneName: z.string().optional().describe('Managed clone folder name (default: the profile directory name)'),
        resync: z
          .enum(['auto', 'always', 'never'])
          .default('auto')
          .describe('auto: refresh the clone if stale. always: re-merge every launch. never: reuse the clone as-is'),
        includeExtensions: z.boolean().default(false).describe('Also copy installed extensions into the clone'),
        headless: z.boolean().default(false).describe('Run Chrome headless (no visible window)')
      }),
      handler: async ({ profileDirectory = 'auto', cloneName, resync = 'auto', includeExtensions = false, headless = false }: any) => {
        try {
          console.error(`[launch_chrome] profile: ${profileDirectory}`);
          const info = await connector.launchWithProfile({
            headless,
            profileDirectory,
            cloneName,
            resync,
            includeExtensions,
            force: true,   // disconnect any existing connection first
          });

          const warnings: string[] = [];
          if (info.clone?.actionRequired) {
            warnings.push(info.clone.actionRequired);
          } else if (info.clone && info.clone.lockedFiles.length > 0) {
            warnings.push(
              `${info.clone.lockedFiles.length} profile file(s) were locked by a running Chrome; close Chrome and ` +
                `re-run for the freshest cookies.`
            );
          }
          if (info.clone && info.clone.sessionState.length === 0) {
            warnings.push('No session state found for this profile — call list_chrome_profiles and pick the logged-in one.');
          }

          return {
            success: true,
            message: info.clone
              ? info.clone.cookiesFresh
                ? `Chrome launched with profile: ${info.profileDirectory} (managed clone, session carried over)`
                : `Chrome launched with profile: ${info.profileDirectory} (managed clone — the session was NOT carried over; see warnings)`
              : `Chrome launched with profile: ${info.profileDirectory}`,
            cdpPort: connector.getPort(),
            profileDirectory: info.profileDirectory,
            userDataDir: info.userDataDir,
            reusedExistingBrowser: info.reusedExisting,
            // "Carried over" means the cookie DB was actually read this pass —
            // an empty DB Chrome created inside the clone does not count.
            sessionCarriedOver: info.clone ? info.clone.cookiesFresh : null,
            clone: info.clone
              ? {
                  name: info.clone.cloneName,
                  copiedFiles: info.clone.copiedFiles,
                  copiedBytes: info.clone.copiedBytes,
                  sessionState: info.clone.sessionState,
                  cookiesMissing: info.clone.cookiesMissing,
                  reusedExistingClone: info.clone.reused,
                  durationMs: info.clone.durationMs,
                }
              : null,
            warnings
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
          const managed = connector.spawnedByUs();
          if (!managed && !connector.isConnected()) {
            return {
              success: false,
              message: 'No Playwright-managed browser to close'
            };
          }

          // Graceful close for a browser we spawned: Chrome then flushes its
          // profile stores (cookies/localStorage) before exiting, which is what
          // keeps the session for the next launch. A browser the user started
          // is only detached, never killed.
          await connector.disconnect({ killBrowser: managed });

          return {
            success: true,
            closed: managed,
            message: managed
              ? 'Browser closed gracefully (session state flushed to the profile clone)'
              : 'Detached from an externally launched Chrome (left running on purpose)'
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

        // When we are not connected, say *why* the CDP port is unusable: a
        // hidden Chromium widget (WebView2/Electron) on the same port is the
        // most common cause and it used to look like "the browser is broken".
        const portProbe = isConnected ? null : await connector.probeCdpPort();

        return {
          success: true,
          connected: isConnected,
          playwrightManaged: isPlaywright,
          port: connector.getPort(),
          status: isConnected
            ? (isPlaywright ? 'Running via Playwright' : 'Connected to external Chrome')
            : 'Not connected',
          cdpPort: portProbe
            ? {
                occupied: portProbe.occupied,
                drivableBrowser: portProbe.ok,
                processName: portProbe.processName ?? null,
                browser: portProbe.browser ?? null,
                warning: portProbe.occupied && !portProbe.ok
                  ? `Port ${connector.getPort()} is held by ${portProbe.processName ?? 'another process'}: ${
                      portProbe.reason ?? 'not a drivable browser'
                    }. Restart this server with --port=<free port>.`
                  : null,
              }
            : null,
        };
      }
    }
  ];
}
