import { describe, it, expect } from 'vitest';
import { classifyCdpEndpoint } from '../utils/cdp-endpoint.js';

/**
 * Real payloads observed on this machine: port 9222 is held by Lenovo Vantage's
 * battery widget (a WebView2 that overrides its user agent), which the old
 * check happily accepted as "a real browser".
 */
const lenovoWebView2 = {
  Browser: 'Edg/152.0.4191.66',
  'Protocol-Version': '1.3',
  'User-Agent': 'LenovoVantage/3.0.0.197',
  'V8-Version': '15.2.23.10',
  'WebKit-Version': '537.36 (@cc2931e6363af1d70882ad63ee33b0e8cd524de0)',
};

const realChrome = {
  Browser: 'Chrome/151.0.7922.71',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
};

const headlessChrome = {
  Browser: 'HeadlessChrome/151.0.7922.71',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36',
};

const explicitWebView2 = {
  Browser: 'Edg/152.0.4191.66',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0 WebView/1.0',
};

describe('classifyCdpEndpoint', () => {
  it('accepts a real Chrome window', () => {
    const verdict = classifyCdpEndpoint(realChrome, 'chrome.exe');
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toBeUndefined();
    expect(verdict.browser).toBe('Chrome/151.0.7922.71');
  });

  it('accepts headless Chrome (tests / CI)', () => {
    expect(classifyCdpEndpoint(headlessChrome, 'chrome.exe').ok).toBe(true);
  });

  it('rejects the Lenovo Vantage WebView2 widget that hijacked port 9222', () => {
    const verdict = classifyCdpEndpoint(lenovoWebView2, 'msedgewebview2.exe');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/msedgewebview2/);
  });

  it('rejects an embedded browser even when it claims to be Chrome, by user agent', () => {
    const verdict = classifyCdpEndpoint(
      { ...realChrome, 'User-Agent': 'SomeElectronApp/1.4.2' },
      'SomeElectronApp.exe'
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/process holding the port/);
  });

  it('rejects a UA-overriding host even if the process name looks like a browser', () => {
    const verdict = classifyCdpEndpoint({ ...realChrome, 'User-Agent': 'LenovoVantage/3.0.0.197' }, 'chrome.exe');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/overrides its user agent/);
  });

  it('rejects an announced WebView2 payload', () => {
    expect(classifyCdpEndpoint(explicitWebView2, 'msedgewebview2.exe').ok).toBe(false);
  });

  it('rejects unknown browser tokens and empty payloads', () => {
    expect(classifyCdpEndpoint({ Browser: 'Node.js/22.0.0' }, 'node.exe').ok).toBe(false);
    expect(classifyCdpEndpoint(null, null).ok).toBe(false);
    expect(classifyCdpEndpoint({}, null).ok).toBe(false);
  });

  it('still accepts a browser when the process could not be resolved (non-Windows)', () => {
    expect(classifyCdpEndpoint(realChrome, null).ok).toBe(true);
  });
});
