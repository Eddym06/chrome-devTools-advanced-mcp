import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Real-Chrome end-to-end smoke test.
 *
 * CI does not have a headed/installed Chrome available, so this suite is
 * OPT-IN: run it with `CHROME_MCP_E2E=1 npm test` on a machine that has
 * Google Chrome (or set CHROME_MCP_E2E_CHROME to a custom path). It proves
 * what the unit/integration suites cannot: that the server can actually
 * attach to Chrome over CDP (incl. the origin allow-list), list tabs, read
 * HTML and enforce the URL allow-list.
 */

const e2eEnabled = process.env.CHROME_MCP_E2E === '1';
const chromePath =
  process.env.CHROME_MCP_E2E_CHROME ||
  (process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ].find((p) => fs.existsSync(p))
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

async function waitForCdp(port: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CDP endpoint never became reachable');
}

function firstText(content: unknown): string {
  const parts = content as Array<{ type: string; text?: string }>;
  return parts?.[0]?.text ?? '';
}

async function killTree(proc: ChildProcess | null): Promise<void> {
  if (!proc?.pid) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (!settled) { settled = true; resolve(); }
    };
    proc.once('exit', done);
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).once('exit', done);
      } catch {
        proc.kill('SIGKILL');
      }
    } else {
      proc.kill('SIGKILL');
    }
    setTimeout(done, 3000);
  });
}

const run = e2eEnabled && !!chromePath;

// 30s per test: this suite boots a real Chrome and drives the real MCP server
// over stdio, so the default 5s is too tight when the rest of the suite runs in
// parallel (the same tests take <1s when run alone).
describe.skipIf(!run)('real-Chrome E2E smoke', () => {
  let chrome: ChildProcess | null = null;
  let profileDir: string | null = null;
  let port = 0;
  let client: Client | null = null;
  let httpServer: http.Server | null = null;
  let httpPort = 0;

  beforeAll(async () => {
    port = await freePort();
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-e2e-profile-'));
    chrome = spawn(
      chromePath!,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--remote-allow-origins=http://localhost,http://127.0.0.1,devtools://devtools',
        '--headless=new',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true }
    );
    await waitForCdp(port);

    // Local HTTP server the browser actually talks to (interception/HAR tests).
    httpServer = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, path: url }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<!doctype html><html><body><h1>e2e</h1>' +
          "<script>fetch('/api/data').then(r=>r.text()).then(t=>{document.title='api:'+t})</script>" +
          '</body></html>'
      );
    });
    httpPort = await new Promise<number>((resolve) => {
      httpServer!.listen(0, '127.0.0.1', () => resolve((httpServer!.address() as net.AddressInfo).port));
    });

    const serverEntry = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
    client = new Client({ name: 'e2e-smoke', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry, `--port=${port}`],
    });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    if (client) {
      await client.close().catch(() => {});
    }
    await killTree(chrome);
    chrome = null;
    if (httpServer) {
      // Chrome may hold keep-alive sockets open — drop them before closing.
      (httpServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2000);
        httpServer!.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      httpServer = null;
    }
    if (profileDir) {
      // Chrome may still be releasing profile files — retry, never fail the suite.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }
  }, 20_000);

  it('lists the core tools over the real MCP protocol', async () => {
    const { tools } = await client!.listTools();
    expect(tools.map((t) => t.name)).toContain('get_html');
    expect(tools.map((t) => t.name)).not.toContain('start_har_recording'); // hidden tier
  });

  it('lazy-connects to Chrome, lists tabs and reads HTML', async () => {
    const tabs = await client!.callTool({ name: 'manage_tabs', arguments: { action: 'list' } });
    const tabPayload = JSON.parse(firstText(tabs.content));
    expect(tabPayload.success).toBe(true);
    expect(tabPayload.count).toBeGreaterThan(0);

    const html = await client!.callTool({ name: 'get_html', arguments: {} });
    const htmlPayload = JSON.parse(firstText(html.content));
    expect(htmlPayload.success).toBe(true);
  });

  it('blocks file:// navigation (URL allow-list)', async () => {
    const blocked = await client!.callTool({
      name: 'browser_action',
      arguments: { action: 'navigate', url: 'file:///C:/Windows/win.ini' },
    });
    expect(blocked.isError).toBe(true);
  });

  it('captures live requests through interception against a local HTTP server', async () => {
    const show = async () => client!.callTool({ name: 'show_advanced_tools', arguments: {} });
    await show();

    await client!.callTool({
      name: 'start_capturing_network_requests',
      arguments: { patterns: ['*api*'], autoContinue: true },
    });
    await client!.callTool({
      name: 'browser_action',
      arguments: { action: 'navigate', url: `http://127.0.0.1:${httpPort}/`, waitUntil: 'load' },
    });
    // Give the page's fetch() time to fire and be captured.
    await new Promise((r) => setTimeout(r, 1200));

    const shown = await client!.callTool({ name: 'show_captured_network_traffic', arguments: {} });
    const shownPayload = JSON.parse(firstText(shown.content));
    expect(shownPayload.count).toBeGreaterThan(0);

    const stopped = await client!.callTool({ name: 'stop_capturing_network_requests', arguments: {} });
    expect(JSON.parse(firstText(stopped.content)).success).toBe(true);
  }, 30_000);

  it('records and exports a valid HAR against a local HTTP server', async () => {
    const show = async () => client!.callTool({ name: 'show_advanced_tools', arguments: {} });
    await show();

    // Ensure the tab is on the local page BEFORE recording (reloading
    // about:blank produces no network entries).
    await client!.callTool({
      name: 'browser_action',
      arguments: { action: 'navigate', url: `http://127.0.0.1:${httpPort}/`, waitUntil: 'load' },
    });
    await new Promise((r) => setTimeout(r, 600));

    await client!.callTool({ name: 'start_har_recording', arguments: {} });
    await client!.callTool({
      name: 'browser_action',
      arguments: { action: 'reload', timeout: 15000 },
    });
    await new Promise((r) => setTimeout(r, 1500));

    const stopped = await client!.callTool({ name: 'stop_har_recording', arguments: {} });
    const stoppedPayload = JSON.parse(firstText(stopped.content));
    expect(stoppedPayload.success).toBe(true);
    expect(stoppedPayload.entriesCount).toBeGreaterThan(0);
    expect(stoppedPayload.har.log.version).toBe('1.2');
    expect(stoppedPayload.har.log.creator.version).toMatch(/^\d+\.\d+\.\d+/);

    const exported = await client!.callTool({ name: 'export_har_file', arguments: { filename: 'e2e-smoke.har' } });
    const exportPayload = JSON.parse(firstText(exported.content));
    expect(exportPayload.success).toBe(true);
    expect(fs.existsSync(exportPayload.filepath)).toBe(true);
    fs.rmSync(exportPayload.filepath, { force: true });
  }, 30_000);
}, 30_000);
