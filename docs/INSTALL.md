# 🚀 Installation Guide

Install and configure the **Chrome Devtools Advanced MCP** server for your AI
assistant (VS Code, Cline, Claude Desktop, Windsurf, …).

## Requirements

- **Node.js ≥ 18**
- **Google Chrome** installed in a standard location (Edge works too on
  Windows) — the server launches it with your real profile and connects over
  the Chrome DevTools Protocol (CDP).
- Windows, macOS or Linux.

> No manual Chrome flags are needed anymore. The server launches Chrome itself
> (`launch_chrome_with_profile`) with a *shadow copy* of your profile so you
> can keep browsing normally while the AI works in a separate window.

---

## Option A — Run from npm (recommended for users)

Add this server to your MCP client configuration (`.vscode/mcp.json`,
Cline settings, `claude_desktop_config.json`, …):

```json
{
  "mcpServers": {
    "chrome-devtools-advanced-mcp": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-advanced-mcp", "--port=9222"]
    }
  }
}
```

1. Save and **restart your assistant** (Ctrl+R in VS Code).
2. When the AI first uses a tool, approve it (**Always Allow**).
3. Ask: *"Launch Chrome with my default profile"* — this runs
   `launch_chrome_with_profile`.

Ports: use any free port (`--port=9222` is the default). The debug port is
only reachable from localhost and uses an origin allow-list — web pages cannot
hijack it.

## Option B — Run from source (for developers / contributors)

```bash
git clone https://github.com/Eddym06/chrome-devTools-advanced-mcp.git
cd chrome-devTools-advanced-mcp
npm install
npm run build
node dist/index.js --port=9222
```

Add it to your client using the local entry point:

```json
{
  "mcpServers": {
    "chrome-devtools-advanced-mcp-local": {
      "command": "node",
      "args": ["/absolute/path/to/repo/dist/index.js", "--port=9222"]
    }
  }
}
```

### Useful commands

| Command | What it does |
|---|---|
| `npm run build` | Clean TypeScript build into `dist/` |
| `npm test` | Vitest unit + in-memory integration suite |
| `npm run lint` | ESLint (flat config) |
| `npm run docs:check` | Verifies guides never reference non-existent tools |
| `npm run pack:check` | Build + `npm pack --dry-run` to inspect the tarball |
| `npm run dev` | `tsc --watch` |

**Real-Chrome E2E (optional):** on a machine with Chrome installed, run
`CHROME_MCP_E2E=1 npm test` — it launches a headless Chrome and exercises the
real MCP protocol against it.

---

## First-run checklist

1. Server starts → logs `[MCP] chrome-devtools-advanced-mcp vX starting...`.
2. `get_browser_status` → not connected (expected before launch).
3. Look at your profiles: `list_chrome_profiles` (no launch needed).
4. User asks to open Chrome → AI calls `launch_chrome_with_profile`
   (`profileDirectory: "auto"` = your main/logged-in profile). Chrome opens on a
   **persistent clone** of that profile, so it is already signed in.
5. `manage_tabs` (`action:"list"`) returns the open tabs.
6. Call `show_advanced_tools` only when a task needs the advanced toolset.

> **Chrome must be closed for the very first clone.** Chrome keeps an exclusive
> lock on its cookie database while it runs, so the session can only be copied
> when no Chrome window (including the background/tray process) is open. After
> that one time the clone owns its own session and keeps it forever.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CHROME_MCP_PROFILE_DIR` | `~/.chrome-mcp/profiles` | Where managed profile clones live |
| `CHROME_MCP_REAL_USER_DATA_DIR` | auto-detected | Real Chrome user-data dir (portable/Chromium forks) |
| `CHROME_MCP_PROFILE_RESYNC` | `auto` | `auto` \| `always` \| `never` — how often the clone re-reads the real profile |
| `CHROME_MCP_PROFILE_WAIT_MS` | `0` | Wait this long for a running Chrome to be closed before giving up on the cookies |
| `CHROME_MCP_NO_CLONE` | unset | `1` = launch directly on the real user-data dir (no clone; CDP usually refuses) |
| `CHROME_MCP_CLONE_EXTENSIONS` | unset | `1` = copy extensions into the clone too |
| `CHROME_MCP_PASSWORD_STORE` | unset | `1` = force `--use-mock-keychain --password-store=basic` (headless CI on macOS/Linux) |
| `CHROME_MCP_ALLOW_FILE_URLS` | unset | `1` = allow `file://` navigation |
| `CHROME_MCP_CONFIRM` | `off` | `on` = destructive tools need `_confirm:true` |
| `MCP_LOG_LEVEL` | `info` | Protocol log verbosity |
| `CHROME_MCP_E2E` | unset | `1` = run the real-Chrome end-to-end tests |

## Troubleshooting

- **"No Chrome browser detected"** → call `launch_chrome_with_profile` first;
  the server never auto-launches a window.
- **The browser opens logged out** → Chrome was still running while the clone
  was created (its cookie DB is locked): close Chrome, then run
  `clone_chrome_profile` again (about one second), or pass
  `waitForChromeCloseSeconds` so it waits for you.
- **Wrong Google account** → `list_chrome_profiles` shows every profile with
  its account, then `clone_chrome_profile` with `profile: "<name or Profile N>"`.
- **Chrome doesn't start** → the log file is
  `%TEMP%/chrome-mcp-debug.log` (Windows) / `/tmp/chrome-mcp-debug.log`
  (macOS/Linux). Make sure Chrome is not blocked by policies on your machine.
- **VS Code "Tool disabled by user"** → reload VS Code (Ctrl+R), then choose
  **Always Allow** when the tool is invoked again.
- **Connection refused** → check the port is free and matches the `--port`
  argument; run `get_browser_status` to confirm the state.
- **"CDP port 9222 is already in use by …"** → another Chromium-based app owns that
  port. On Windows, Lenovo Vantage, some OEM tools and Electron apps open
  `--remote-debugging-port=9222` for their own widgets. Start this server with a
  free port (`--port=9333`) or close that app; the server refuses to attach to a
  non-browser endpoint on purpose.
- **Cookie values look redacted** → by design: pass `includeValues:true` to
  `get_cookies` / `export_session` / `manage_browser_session` when you truly
  need them.

## Security notes

- Navigation is limited to `http(s)`; `file://` is blocked unless the server
  runs with `CHROME_MCP_ALLOW_FILE_URLS=1` (local testing only).
- HAR exports and downloads are sandboxed to your working directory / temp
  folder.
- The CDP debug port binds to localhost with an origin allow-list.
- Optional: `CHROME_MCP_CONFIRM=on` requires an explicit `_confirm:true`
  argument for destructive tools; `MCP_LOG_LEVEL` controls protocol log noise.

See [USAGE_GUIDE.md](USAGE_GUIDE.md) for the full workflow documentation and
[TOOLS.md](TOOLS.md) for the complete tool reference.

---

*Developed with ❤️ by @eddym06 — MIT licensed.*
