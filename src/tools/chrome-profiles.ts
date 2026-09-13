/**
 * Chrome Profile Tools
 *
 * Discover the real Chrome profiles on this machine, clone one into a stable
 * managed folder (so the automated browser starts already logged in with the
 * user's session), sync logins back into the real profile, and drop clones.
 *
 * These tools work without a browser connection: they only read/write profile
 * files under the user-data dir, so `list_chrome_profiles` is safe to call
 * before anything is launched.
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import {
  cloneChromeProfile,
  getCloneRoot,
  getCloneStatus,
  isChromeRunning,
  listChromeProfiles,
  removeProfileClone,
  resolveProfileDirectory,
  sanitizeProfileName,
  syncCloneToReal,
} from '../utils/chrome-profiles.js';

/** Turns copy stats into the warnings an agent should actually act on. */
function copyWarnings(lockedFiles: string[]): string[] {
  if (lockedFiles.length === 0) return [];
  return [
    `${lockedFiles.length} file(s) were locked by a running Chrome and could not be copied ` +
      `(e.g. ${lockedFiles.slice(0, 3).join(', ')}). Close every Chrome window and run the clone again ` +
      `to capture the freshest session/cookies.`,
  ];
}

export function createChromeProfileTools(connector: ChromeConnector) {
  return [
    {
      name: 'list_chrome_profiles',
      description:
        'List the real Chrome profiles on this machine (name, Google account, whether a managed clone already ' +
        'exists). Use it to find which profile is the main/logged-in one before cloning or launching. ' +
        'Does not need a browser connection.',
      inputSchema: z.object({
        includeClones: z
          .boolean()
          .default(true)
          .describe('Include managed clone info (path, last sync) for each profile'),
      }),
      handler: async ({ includeClones = true }: any) => {
        const cloneRoot = getCloneRoot();
        const chromeRunning = await isChromeRunning();
        const profiles = listChromeProfiles().map((profile) => {
          const status = includeClones ? getCloneStatus(profile.directory) : null;
          return {
            directory: profile.directory,
            name: profile.name,
            email: profile.email ?? null,
            isDefault: profile.isDefault,
            lastUsedByChrome: profile.lastUsed,
            hasSessionState: profile.hasSessionState,
            clone: status?.exists
              ? {
                  name: profile.directory,
                  path: status.path,
                  profileDirectory: status.profileDirectory,
                  lastSyncAt: status.lastSyncAt,
                  sessionState: status.sessionState,
                }
              : null,
          };
        });

        const recommended =
          profiles.find((p) => p.lastUsedByChrome && p.hasSessionState)?.directory ??
          profiles.find((p) => p.hasSessionState)?.directory ??
          profiles[0]?.directory ??
          null;

        return {
          success: true,
          cloneRoot,
          chromeRunning,
          profileCount: profiles.length,
          recommendedProfile: recommended,
          profiles,
          note:
            'A clone keeps its own session: logging in inside the automated browser persists in the clone, ' +
            'and sync_chrome_profile_to_real pushes those logins into your real Chrome.' +
            (chromeRunning
              ? ' Chrome is running right now, so the cookie DB is locked: close it before cloning to carry the session over.'
              : ''),
        };
      },
    },

    {
      name: 'clone_chrome_profile',
      description:
        'Clone a real Chrome profile (cookies, localStorage, logins, preferences) into a persistent managed ' +
        'folder so the automated browser opens ALREADY LOGGED IN. Optional launch=true starts Chrome on the ' +
        'fresh clone right away. The clone is a mirror, so it never disturbs the real Chrome.',
      inputSchema: z.object({
        profile: z
          .string()
          .default('auto')
          .describe('"auto" (main/logged-in profile), "Default", "Profile 1", a number, or a profile display name'),
        cloneName: z.string().optional().describe('Folder name for the clone (default: the profile directory name)'),
        resync: z
          .enum(['auto', 'always', 'never'])
          .default('auto')
          .describe('auto: refresh if stale. always: merge every call. never: reuse the clone untouched'),
        includeExtensions: z.boolean().default(false).describe('Also copy installed extensions (heavier)'),
        waitForChromeCloseSeconds: z
          .number()
          .default(0)
          .describe(
            'If Chrome is running it locks the cookie DB: wait up to N seconds for it to be closed before giving up ' +
              '(e.g. 60 to tell the user "close Chrome now")'
          ),
        launch: z.boolean().default(false).describe('Launch Chrome on the clone immediately after cloning'),
        headless: z.boolean().default(false).describe('When launch=true, run Chrome headless'),
      }),
      handler: async ({
        profile = 'auto',
        cloneName,
        resync = 'auto',
        includeExtensions = false,
        waitForChromeCloseSeconds = 0,
        launch = false,
        headless = false,
      }: any) => {
        try {
          const result = await cloneChromeProfile({
            profileDirectory: profile,
            cloneName,
            resync,
            includeExtensions,
            waitForUnlockMs: Math.max(0, waitForChromeCloseSeconds) * 1000,
          });

          const warnings = copyWarnings(result.lockedFiles);
          if (result.actionRequired) warnings.unshift(result.actionRequired);
          if (result.sessionState.length === 0) {
            warnings.push(
              'No cookie/localStorage state was found for this profile. If your session lives in another ' +
                'profile, call list_chrome_profiles and clone that one instead.'
            );
          }

          let launched = false;
          if (launch) {
            await connector.launchWithProfile({
              headless,
              profileDirectory: result.profileDirectory,
              cloneName: result.cloneName,
              force: true,
              resync: 'never', // just cloned/merged above
            });
            launched = true;
          }

          return {
            success: true,
            profileDirectory: result.profileDirectory,
            cloneName: result.cloneName,
            userDataDir: result.userDataDir,
            sessionCarriedOver: result.cookiesFresh,
            cookiesMissing: result.cookiesMissing,
            cookiesFresh: result.cookiesFresh,
            lastCookiesSyncAt: result.lastCookiesSyncAt,
            chromeRunning: result.chromeRunning,
            cloneBrowserRunning: result.cloneBrowserRunning,
            reusedExistingClone: result.reused,
            copiedFiles: result.copiedFiles,
            copiedBytes: result.copiedBytes,
            skippedUnchanged: result.skippedUnchanged,
            keptNewerInClone: result.keptNewerInClone.length,
            lockedFiles: result.lockedFiles,
            sessionState: result.sessionState,
            durationMs: result.durationMs,
            launched,
            warnings,
            nextStep: launched
              ? 'Chrome is running on the clone with your session. Use manage_tabs / browser_action as usual.'
              : 'Call launch_chrome_with_profile (profile: "' +
                result.profileDirectory +
                '") to open Chrome on this clone.',
          };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    },

    {
      name: 'sync_chrome_profile_to_real',
      description:
        'Push the session from a managed clone BACK into your real Chrome profile (cookies, localStorage, logins) ' +
        'so the accounts you signed into with the automated browser appear in your own Chrome. Close Chrome first; ' +
        'files locked by a running Chrome are reported, not forced.',
      inputSchema: z.object({
        cloneName: z.string().optional().describe('Clone folder name (default: "Default" / the profile directory)'),
        profile: z.string().default('auto').describe('Which real profile to write into ("auto" = main profile)'),
        includeExtensions: z.boolean().default(false).describe('Reserved: extension state is not synced back'),
      }),
      handler: async ({ cloneName, profile = 'auto' }: any) => {
        try {
          const profileDirectory = resolveProfileDirectory(profile);
          const result = await syncCloneToReal({
            cloneName: cloneName || profileDirectory,
            profileDirectory,
          });
          const warnings = copyWarnings(result.lockedFiles);
          if (result.copiedFiles === 0 && result.lockedFiles.length === 0) {
            warnings.push('Nothing to sync: the real profile is already up to date with the clone.');
          }
          return {
            success: true,
            ...result,
            warnings,
            note: 'Restart Chrome to pick up the synced session.',
          };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    },

    {
      name: 'remove_chrome_profile_clone',
      description:
        'Delete a managed Chrome profile clone (frees disk, discards the session stored in it). Never touches the ' +
        'real Chrome profile.',
      inputSchema: z.object({
        cloneName: z.string().describe('Clone folder name to delete (see list_chrome_profiles)'),
      }),
      handler: async ({ cloneName }: any) => {
        try {
          const safe = sanitizeProfileName(cloneName);
          const removed = await removeProfileClone(safe);
          return { success: true, removed, cloneName: safe };
        } catch (error) {
          return { success: false, error: (error as Error).message };
        }
      },
    },
  ];
}
