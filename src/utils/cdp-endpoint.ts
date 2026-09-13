/**
 * CDP port identification.
 *
 * `/json/version` answers on ANY Chromium-based process that was started with
 * `--remote-debugging-port`, not just a user-visible browser. Real examples:
 * Lenovo Vantage's battery widget (msedgewebview2.exe with
 * `--remote-debugging-port=9222`), Electron apps, VS Code, Teams…
 *
 * The old check only rejected payloads whose `Browser`/`User-Agent` literally
 * contained "webview". An embedded browser that overrides its user agent (e.g.
 * `User-Agent: LenovoVantage/3.0.0.197`, `Browser: Edg/152.0.4191.66`) slipped
 * through: the MCP then "connected" to a hidden widget instead of launching
 * Chrome, and every tool silently operated on the wrong browser.
 *
 * This module is pure (no I/O) so the classification can be unit-tested.
 */

export interface CdpVersionPayload {
  Browser?: string;
  'User-Agent'?: string;
  [key: string]: unknown;
}

export interface CdpEndpointClassification {
  /** Safe to drive as a user-visible browser. */
  ok: boolean;
  /** Why it was rejected (undefined when ok). */
  reason?: string;
  browser: string;
  userAgent: string;
  processName: string | null;
}

/** Browser tokens Chromium exposes in the `Browser` field. */
const BROWSER_TOKEN = /^(HeadlessChrome|Chrome|Chromium|Edg|Brave|Vivaldi|OPR|Opera|SamsungBrowser|YaBrowser|Whale)\//i;

/** Process image names that really are a browser we may drive. */
const BROWSER_PROCESS = /^(chrome|msedge|chromium|brave|vivaldi|opera|chrome_proxy|headless_shell)(\.exe)?$/i;

/** A normal browser UA always claims to be Mozilla and names an engine. */
const REAL_BROWSER_UA = /Mozilla\/5\.0/;

export function classifyCdpEndpoint(
  version: CdpVersionPayload | null,
  processName?: string | null
): CdpEndpointClassification {
  const browser = String(version?.Browser ?? '');
  const userAgent = String(version?.['User-Agent'] ?? '');
  const proc = processName ? processName.trim() : null;
  const base: CdpEndpointClassification = { ok: false, browser, userAgent, processName: proc };

  if (!version || !browser) {
    return { ...base, reason: 'no /json/version payload (not a CDP endpoint)' };
  }

  if (proc && !BROWSER_PROCESS.test(proc)) {
    return { ...base, reason: `the process holding the port is "${proc}", not a browser` };
  }

  if (browser.toLowerCase().includes('webview') || userAgent.includes('WebView')) {
    return { ...base, reason: 'endpoint reports itself as WebView2 (embedded browser)' };
  }

  if (!BROWSER_TOKEN.test(browser)) {
    return { ...base, reason: `unrecognised browser token "${browser}"` };
  }

  if (!REAL_BROWSER_UA.test(userAgent)) {
    return {
      ...base,
      reason: `the endpoint overrides its user agent ("${userAgent}") — embedded/automation host, not a browser`,
    };
  }

  return { ...base, ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Attaching to an already-open Chrome
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromeCommandLineFlags {
  /** `--user-data-dir=…` (the profile root the browser is using). */
  userDataDir?: string;
  /** `--profile-directory=…` (defaults to "Default" when absent). */
  profileDirectory?: string;
  /** `--remote-debugging-port=…` when present. */
  remoteDebuggingPort?: number;
  headless: boolean;
  /** `--type=renderer|gpu-process|…`: a child process, not the browser itself. */
  type?: string;
}

/**
 * Reads the switches that matter out of a Chrome process command line.
 * Quoted values (`--user-data-dir="C:\a b\Chrome"`) and unquoted ones are both
 * supported.
 */
export function parseChromeCommandLine(commandLine: string): ChromeCommandLineFlags {
  const raw = String(commandLine ?? '');
  const value = (flag: string): string | undefined => {
    const re = new RegExp(`--${flag}=(?:"([^"]*)"|'([^']*)'|(\\S+))`);
    const m = re.exec(raw);
    return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
  };

  const port = value('remote-debugging-port');
  const flags: ChromeCommandLineFlags = {
    userDataDir: value('user-data-dir'),
    profileDirectory: value('profile-directory'),
    remoteDebuggingPort: port && /^\d+$/.test(port) ? Number(port) : undefined,
    headless: /--headless(=|\s|$)/.test(raw),
  };
  const type = value('type');
  if (type) flags.type = type;
  return flags;
}

export type OwnerKind = 'real-profile' | 'managed-clone' | 'unknown';

export interface CdpOwnerInfo {
  port: number;
  /** Safe to drive (see classifyCdpEndpoint). */
  ok: boolean;
  browser?: string;
  userAgent?: string;
  processName?: string;
  commandLine?: string;
  flags?: ChromeCommandLineFlags;
  kind: OwnerKind;
  /** Which Chrome profile the owner is actually using. */
  profileDirectory?: string;
  reason?: string;
}

/** Is this user-data dir the real Chrome one, one of our clones, or neither? */
export function classifyOwnerKind(
  userDataDir: string | undefined,
  options: { realUserDataDir?: string; cloneRoot?: string }
): OwnerKind {
  if (!userDataDir) return 'unknown';
  // Compare paths case-insensitively and separator-agnostically: Chrome's own
  // command line may contain either flavour (C:\x\y vs c:/x/y/).
  const normalize = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  const dir = normalize(userDataDir);
  if (options.cloneRoot && dir.startsWith(normalize(options.cloneRoot))) return 'managed-clone';
  if (options.realUserDataDir && dir === normalize(options.realUserDataDir)) return 'real-profile';
  return 'unknown';
}

/**
 * Picks which already-running browser to attach to, if any.
 *
 * Priority: the real profile the caller asked for → a clone of it → any clone
 * → the caller's preferred port. Attaching to a browser we did not spawn is
 * always preferable to spawning a second Chrome: two Chromes cannot share one
 * user-data dir, so a duplicate would be either a no-op or an empty profile.
 */
export function rankAttachTarget(
  candidates: CdpOwnerInfo[],
  want: {
    realUserDataDir?: string;
    cloneRoot?: string;
    profileDirectory?: string;
    preferredPort?: number;
  }
): { target: CdpOwnerInfo | null; reason: string } {
  const usable = candidates.filter((c) => c.ok);
  if (usable.length === 0) {
    const rejected = candidates.filter((c) => c.reason).map((c) => `port ${c.port}: ${c.reason}`);
    return {
      target: null,
      reason:
        candidates.length === 0
          ? 'no CDP endpoint found on the scanned ports'
          : `no drivable browser found (${rejected.join('; ')})`,
    };
  }

  const wantedProfile = (want.profileDirectory ?? 'Default').toLowerCase();
  const score = (c: CdpOwnerInfo): number => {
    const ownerProfile = (c.profileDirectory ?? c.flags?.profileDirectory ?? 'Default').toLowerCase();
    const sameProfile = ownerProfile === wantedProfile;
    let s = 0;
    if (c.kind === 'real-profile') s += sameProfile ? 100 : 40;
    else if (c.kind === 'managed-clone') s += sameProfile ? 80 : 30;
    else s += sameProfile ? 50 : 10;
    if (c.port === want.preferredPort) s += 5;
    return s;
  };

  const target = [...usable].sort((a, b) => score(b) - score(a))[0];
  return {
    target,
    reason:
      `attaching to the browser on port ${target.port}` +
      (target.kind === 'real-profile'
        ? ' (your real Chrome profile)'
        : target.kind === 'managed-clone'
          ? ' (a managed clone)'
          : ' (unrecognised user-data dir)'),
  };
}

