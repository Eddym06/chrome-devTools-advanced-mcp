/**
 * Playwright Launcher Tool
 * Launch browsers with user profile using Playwright
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { attachRecipe, isProfileInUse, resolveProfileDirectory } from '../utils/chrome-profiles.js';

export function createPlaywrightLauncherTools(connector: ChromeConnector) {
  return [
    {
      name: 'attach_to_running_chrome',
      description:
        'Attach to a Chrome/Edge that is ALREADY open with a debug port, instead of launching another one. ' +
        'Scans common CDP ports, verifies the endpoint is a real browser, reads its process command line to find ' +
        'which profile it uses, and reuses it (your real profile first, then a managed clone). If the browser you ' +
        'have open has no debug port, it explains exactly why it cannot be attached to and what to do.',
      inputSchema: z.object({
        profile: z.string().default('auto').describe('Which profile you expect ("auto", "Default", "Profile 1", a name)'),
        ports: z.array(z.number()).optional().describe('Extra ports to scan (default 9222-9225 + 9333 + this server port)'),
        first: z
          .boolean()
          .default(false)
          .describe('Deprecated no-op kept for compatibility; the best match is always chosen'),
      }),
      handler: async ({ profile = 'auto', ports }: any) => {
        try {
          const wanted = resolveProfileDirectory(profile);
          const found = await connector.findAttachableBrowser({ profileDirectory: wanted, ports, deep: true });

          if (found.target) {
            const attached = await connector.attachTo(found.target);
            return {
              success: true,
              attached: true,
              port: found.target.port,
              browser: found.target.browser,
              processName: found.target.processName,
              kind: found.target.kind,
              profileDirectory: found.target.profileDirectory,
              userDataDir: found.target.flags?.userDataDir ?? null,
              headless: found.target.flags?.headless ?? null,
              targets: attached.tabs,
              currentUrl: attached.url,
              reason: found.reason,
              otherEndpoints: found.candidates
                .filter((c) => c.port !== found.target?.port)
                .map((c) => ({ port: c.port, ok: c.ok, reason: c.reason, kind: c.kind })),
            };
          }

          // Nothing to attach to: explain precisely why, and how to fix it.
          const busy = isProfileInUse({ profileDirectory: wanted });
          const recipe = attachRecipe(wanted);
          return {
            success: false,
            attached: false,
            profileDirectory: wanted,
            scannedPorts: [connector.getPort(), ...(ports ?? [9222, 9223, 9224, 9225, 9333])],
            endpoints: found.candidates.map((c) => ({
              port: c.port,
              drivableBrowser: c.ok,
              processName: c.processName ?? null,
              browser: c.browser ?? null,
              reason: c.reason ?? null,
            })),
            chromeRunningWithThisProfile: busy.inUse,
            why: busy.inUse
              ? `Chrome is running with profile "${wanted}" but exposes NO debug port (${busy.signal}), and Chrome ` +
                `136+ ignores --remote-debugging-port for the default user-data dir: an already-open normal Chrome ` +
                `cannot be attached to.`
              : `${found.reason}.`,
            options: recipe.options,
            nextStep:
              'Either drive a managed clone of that profile (clone_chrome_profile with launch:true) or restart ' +
              'Chrome as described in options[1].steps so it exposes a debug port.',
          };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    },

    {
      name: 'launch_chrome_with_profile',
      description:
        'Launch Google Chrome on a managed clone of the real profile (identity, bookmarks, history, settings, ' +
        'extensions) or reuse an already-open debuggable browser. FIRST TIME with a new user, prefer ' +
        'setup_chrome_profile: it does the clone, the extensions and the one-time sign-in instructions in a single ' +
        'call. IMPORTANT: Only call this tool when the user EXPLICITLY asks to open or launch Chrome. Do NOT call ' +
        'it automatically or proactively.',
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
        headless: z.boolean().default(false).describe('Run Chrome headless (no visible window)'),
        ifProfileInUse: z
          .enum(['warn-and-clone', 'fail'])
          .default('warn-and-clone')
          .describe(
            'When a Chrome with that profile is already open (and therefore not attachable): "warn-and-clone" ' +
              'launches the managed clone anyway, "fail" refuses and returns the recipe to make it attachable'
          ),
      }),
      handler: async ({
        profileDirectory = 'auto',
        cloneName,
        resync = 'auto',
        includeExtensions = false,
        headless = false,
        ifProfileInUse = 'warn-and-clone',
      }: any) => {
        try {
          console.error(`[launch_chrome] profile: ${profileDirectory}`);
          const info = await connector.launchWithProfile({
            headless,
            profileDirectory,
            cloneName,
            resync,
            includeExtensions,
            ifProfileInUse,
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

          // A Chrome the user already has open cannot be attached to when it
          // was not started with a debug port; say it plainly with the fix.
          const busy = info.reusedExisting ? { inUse: false, signal: null } : isProfileInUse({ profileDirectory: info.profileDirectory });
          if (busy.inUse) {
            const recipe = attachRecipe(info.profileDirectory);
            warnings.push(
              `Chrome is already open with profile "${info.profileDirectory}" and exposes no debug port ` +
                `(${busy.signal}), so this window is a CLONE, not your live browser. ${recipe.why}`
            );
          }

          return {
            success: true,
            message: info.reusedExisting
              ? `Reused the browser already open on port ${info.attachedPort ?? connector.getPort()} (${info.attachedKind ?? 'unknown'}) — nothing was launched`
              : info.clone
                ? info.clone.cookiesFresh
                  ? `Chrome launched with profile: ${info.profileDirectory} (managed clone, session carried over)`
                  : `Chrome launched with profile: ${info.profileDirectory} (managed clone — the session was NOT carried over; see warnings)`
                : `Chrome launched with profile: ${info.profileDirectory}`,
            cdpPort: connector.getPort(),
            profileDirectory: info.profileDirectory,
            userDataDir: info.userDataDir,
            reusedExistingBrowser: info.reusedExisting,
            attachedPort: info.attachedPort ?? null,
            attachedKind: info.attachedKind ?? null,
            // "Carried over" means the clone will really be logged in: the
            // cookie DB was read AND the platform can decrypt it (Chrome's
            // App-Bound Encryption makes copied cookies undecryptable).
            sessionCarriedOver: info.clone ? info.clone.cookiesUsable : null,
            appBoundEncryption: info.clone?.appBoundEncryption ?? null,
            liveChromeWithSameProfileNotAttachable: busy.inUse,
            howToAttach: busy.inUse ? attachRecipe(info.profileDirectory).options : null,
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
