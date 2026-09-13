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
