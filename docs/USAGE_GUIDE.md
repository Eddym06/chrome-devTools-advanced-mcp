# Chrome Devtools Advanced MCP — Usage Guide

A practical guide for the AI (and its human) on how to drive Chrome through
this MCP server. Tool names below are the **current (v1.5) consolidated
names** — early guides used a different vocabulary where navigation, clicks
and tab listing were separate plain-named tools; those tools no longer exist
(the table in [Common Mistakes](#-common-mistakes) maps the old names to the
current ones).

---

## 🎯 Golden Rules

1. **Analyze before you act.** Never guess selectors: call `get_html` (or
   `screenshot`) first, then interact with verified selectors.
2. **Wait before interacting.** After navigation, call `wait_for_load_state`
   (or rely on the auto-wait in `perform_interaction`).
3. **Launch only on request.** `launch_chrome_with_profile` opens a visible
   Chrome with the user's real profile. Do **not** call it proactively.
4. **Respect the security defaults** (see [Security defaults](#-security-defaults)):
   cookie values are redacted unless you ask for them, and only `http(s)` URLs
   can be navigated to.

---

## 🚀 Quick Start

1. User asks to open the browser → call:

   ```json
   { "tool": "launch_chrome_with_profile", "args": { "profileDirectory": "auto" } }
   ```

   `"auto"` = the profile Chrome used last that actually has a session (your
   main, logged-in profile). Chrome opens on a **clone** of it, so the browser
   starts already signed in and keeps its own session between runs.

2. Check state with `get_browser_status` (`browser_action`/`manage_tabs` are
   the daily drivers; the **~52 advanced tools** are hidden until you call
   `show_advanced_tools` — do that when a task needs them).

---

## 👤 Profile & session (start already logged in)

The automated browser runs on a **persistent clone** of a real Chrome profile,
because Chrome refuses to open its debug port on the live user-data directory.
The clone lives in `~/.chrome-mcp/profiles/<profile>` and keeps its own session
between MCP runs.

| Task | Tool & arguments |
|---|---|
| See your profiles (name + Google account) | `list_chrome_profiles` (no browser needed) |
| Clone the main profile | `clone_chrome_profile` with `{ "profile": "auto" }` |
| Clone a specific one | `clone_chrome_profile` with `{ "profile": "Trabajo" }` or `"Profile 1"` |
| Clone **and** open right away | `clone_chrome_profile` with `{ "launch": true }` |
| Push logins back to your real Chrome | `sync_chrome_profile_to_real` (close Chrome first) |
| Delete a clone | `remove_chrome_profile_clone` with `{ "cloneName": "Default" }` |

**What actually carries over** (verified): localStorage, IndexedDB, preferences,
bookmarks, extensions (opt-in) and the list of profiles.

**What is deliberately NOT copied on Windows** — and this is not a bug in the
copy: since Chrome 127, cookie *values* and saved passwords are encrypted with
**App-Bound Encryption**, whose key is bound to the browser and unwrapped by the
elevation service. A profile copied into another user-data dir cannot decrypt
them, so Chrome **discards** them on start-up (measured: a byte-identical copy of
a 1460-cookie database became 0 cookies, with `Failed to decrypt token …` in
Chrome's log). Copying them would be worse than useless, because it would also
overwrite the session you create *inside* the clone with data Chrome then
deletes — so the merge skips the cookie DB, `Local State`, `Login Data`,
`Web Data` and the DBSC store on those platforms. Consequences:

- a **fresh** clone opens logged out of Google, and saved passwords are not there;
- `clone_chrome_profile` says so explicitly (`appBoundEncryption: true`,
  `cookiesUsable: false`, plus a `warnings` entry) instead of pretending;
- cloning does **not** need Chrome to be closed on those platforms (nothing
  encrypted is read), and the clone keeps its own session across launches;
- `sync_chrome_profile_to_real` has the same limitation in reverse (on Windows).

**So how do I get a logged-in browser?** Two ways that genuinely work, both
one-time:

1. **Sign in once inside the clone.** Run
   `clone_chrome_profile { "launch": true }`, log into Google in the window that
   opens, and use that window from then on: the session belongs to the clone and
   survives every restart (the MCP never overwrites it). The MCP attaches to that
   window instead of launching duplicates.
2. **Run a Chrome that is debuggable from the start** and use it daily:

   ```
   chrome.exe --remote-debugging-port=9223 --user-data-dir="%USERPROFILE%\.chrome-mcp\daily" --profile-directory=Default
   ```

   Sign in once there; from then on `attach_to_running_chrome` reuses *that*
   browser, with your real session, and nothing is ever copied.

**On platforms without App-Bound Encryption** (macOS/Linux with the keychain
available) the cookie DB *is* portable: closing Chrome once lets the clone start
logged in. `waitForChromeCloseSeconds` waits for the user instead of failing:

```json
{ "tool": "clone_chrome_profile", "args": { "profile": "auto", "waitForChromeCloseSeconds": 60 } }
```

Related environment variables: `CHROME_MCP_PROFILE_DIR` (where clones live),
`CHROME_MCP_PROFILE_RESYNC` (`auto`/`always`/`never`),
`CHROME_MCP_PROFILE_WAIT_MS`, `CHROME_MCP_CLONE_EXTENSIONS=1`,
`CHROME_MCP_NO_CLONE=1` (opt out of cloning entirely).

### Reusing a Chrome that is already open (`attach_to_running_chrome`)

`launch_chrome_with_profile` is **attach-first**: before spawning anything it
scans the usual CDP ports (9222-9225, 9333 and its own `--port`), verifies the
endpoint is a real browser (not a WebView2/Electron widget), reads the owning
process command line to learn which `--user-data-dir`/`--profile-directory`
that browser uses, and **reuses it** — your real profile first, then a managed
clone. Two Chromes cannot share a user-data dir, so reusing is always better
than launching a second one.

When nothing is attachable, `attach_to_running_chrome` returns the reason plus
the recipe:

```json
{ "tool": "attach_to_running_chrome", "args": { "profile": "auto" } }
```

**The hard limit:** a Chrome can only be driven if it was started with
`--remote-debugging-port`, and Chrome 136+ **ignores that switch when the
browser uses its default user-data directory** (anti-cookie-theft change). So an
already-open *normal* Chrome cannot be attached to, period. Two ways out:

1. **Drive a clone** (keeps your session): close Chrome once, then
   `clone_chrome_profile { "launch": true }` and keep using that window — the
   MCP attaches to it from then on.
2. **Make Chrome expose the port:** start it with a non-default user-data dir
   plus the port, then log in once in that window:

   ```
   chrome.exe --remote-debugging-port=9223 --user-data-dir="%USERPROFILE%\.chrome-mcp\daily" --profile-directory=Default
   ```

   `attach_to_running_chrome` then finds and reuses that browser automatically.

Pass `ifProfileInUse: "fail"` to `launch_chrome_with_profile` if you would
rather get an explicit failure than a clone when your live Chrome is in the way.

---

## 🧭 Navigation & Tabs (consolidated tools)

| Task | Tool & arguments |
|---|---|
| Go to a page | `browser_action` with `action:"navigate", url:"https://…", waitUntil:"load"` |
| Back / forward / reload | `browser_action` with `action:"back"` / `"forward"` / `"reload"` |
| List tabs | `manage_tabs` with `action:"list"` |
| New tab / close / switch | `manage_tabs` with `action:"create"|"close"|"switch"` (+ `url`/`tabId`) |
| Get current URL | `manage_tabs` with `action:"get_url"` |
| Wait for page ready | `wait_for_load_state` with `state:"networkidle"` |

> Only `http(s)` URLs are accepted for navigation (`file://` is blocked for
> security; `about:blank` and `chrome://newtab/` are allowed).

### Example: correct navigation flow

```
1. browser_action   → { action: "navigate", url: "https://example.com", waitUntil: "load" }
2. wait_for_load_state → { state: "networkidle", timeout: 15000 }
3. get_html          → analyze the structure (no selector = full page)
4. perform_interaction → click/type using verified selectors
```

---

## 🖱️ Interaction

`perform_interaction` is the single interaction tool — it covers everything
the old `click`/`type`/`scroll` tools did:

| Action | Example arguments |
|---|---|
| Click | `perform_interaction` `{ action:"click", selector:"button#submit" }` |
| Type | `perform_interaction` `{ action:"type", selector:"input[name=q]", text:"cats" }` |
| Select | `perform_interaction` `{ action:"select", selector:"select#country", value:"ES" }` |
| Scroll | `perform_interaction` `{ action:"scroll", coordinateX:0, coordinateY:600 }` |
| Wait for element | `perform_interaction` `{ action:"wait", selector:".spinner", timeoutMs:10000 }` |

Fill several fields at once with `fill_form`:

```
fill_form → {
  fields: [ { selector: "#email", value: "me@example.com" },
            { selector: "#password", value: "…" } ],
  submitSelector: "button[type=submit]"
}
```

Read page data with:

- `get_html` — HTML of the whole page or of a CSS `selector` (truncated to
  50 KB; prefer a selector or `execute_script` for big pages).
- `extract_element_data` — `action:"text"` or `action:"attribute"` for a
  single element.
- `execute_script` — arbitrary JS **with a `return`**; `awaitPromise:true` for
  async code. Prefer the dedicated tools; `execute_script` is the escape hatch
  for complex extractions (e.g. `querySelectorAll` + `map`).
- `screenshot` / `print_to_pdf` — screenshots and PDFs are **saved to disk**
  and returned as `filePath` (not inline base64) to keep responses small.
- `get_page_metrics` — layout/viewport info.

> Interacting with a page that React/Vue controls (inputs, virtual lists) is
> most reliable through the form/click actions above; when a modern SPA does
> not react, use `execute_script` with the native value setter pattern.

---

## 🛡️ Anti-Detection & Browser Environment

Applied automatically on launch and adjustable per tab:

- `enable_stealth_mode` — re-apply stealth patches to a tab (webdriver=false,
  fingerprint noise). Already active by default.
- `set_user_agent`, `set_viewport`, `set_geolocation`, `set_timezone` —
  impersonate a device/location for a tab.

Realism notes: this server drives your **real Chrome + real profile**, so it
does not spoof platform/GPU values that would contradict the environment —
the real values are the most believable ones.

---

## 📡 Network: two interception families

There are two complementary stacks (all advanced — unlock with
`show_advanced_tools`).

### 1. Request interception & replay — `start_capturing_network_requests` family

Use for **request-level** capture, modification and replay:

```
1. start_capturing_network_requests → { patterns: ["*api*"], autoContinue: true }
2. (perform the action that triggers the request)
3. show_captured_network_traffic   → find requestId
4. resend_network_request          → { requestId } (CORS may block; for
                                     authenticated replay, modify BEFORE sending)
   or modify_network_request       → change headers/body while paused
   or block_network_request        → fail the request deliberately
5. stop_capturing_network_requests → detach (disable works on the same session)
```

### 2. Response interception & mocking — `enable_response_interception` family

Use for **response-level** capture, modification, mocking and HAR:

```
1. enable_response_interception → { patterns: ["*"], autoContinue: true }
   (or autoContinue:false + pauseMode for step-by-step modification)
2. trigger traffic; list_intercepted_responses → requestId
3. modify_intercepted_response → change body/headers/status
4. disable_response_interception → stops cleanly on the same CDP session
```

**Mocking:** `create_mock_endpoint` returns canned responses for a pattern —
multiple mocks can be active at once; `list_mock_endpoints`,
`delete_mock_endpoint`, `clear_all_mocks`. Mocks and response interception are
mutually exclusive by design.

**WebSockets:** `enable_websocket_interception` →
`list_websocket_connections` / `list_websocket_messages` →
`disable_websocket_interception`. `send_websocket_message` cannot push frames
into an already-open socket (CDP limitation); it hooks new connections and
reports honestly whether the message went out.

**HAR:** `start_har_recording` → do things → `stop_har_recording` (returns the
HAR and parks it) → `export_har_file { filename }` writes it to disk
(sandboxed to your working dir / temp folder).

**Helpers:** `add_custom_header_to_request`,
`intercept_and_modify_traffic`, `capture_network_on_action`,
`extract_api_data`, `navigate_and_extract_content`,
`test_api_endpoint`, `simulate_user_journey`, `add_advanced_interception_pattern`,
plus persistent CSS/JS injection (`inject_css_global`, `inject_js_global`,
`list_injected_scripts`, `remove_injection`, `clear_all_injections`).

---

## 🍪 Cookies, Storage & Sessions

| Tool | Purpose |
|---|---|
| `get_cookies` | List cookies for the page/URL. **Values are redacted by default** — pass `includeValues:true` only when you truly need them |
| `set_cookie` / `delete_cookie` / `clear_cookies` | Manage cookies |
| `get_local_storage` / `set_local_storage` / `clear_local_storage` | Page storage |
| `get_indexed_db` | Inspect IndexedDB (read-only, never creates DBs) |
| `export_session` | Dump cookies+storage as JSON. **Values redacted by default**; `includeValues:true` is required for a restorable backup |
| `import_session` | Restore a previously exported session (valueless cookies are skipped with a warning) |
| `manage_browser_session` | One-call save/load/clear/export (same `includeValues` behavior) |
| `test_with_different_cookies` | Test a URL with custom cookies in a **throwaway isolated context** — never touches the real session |

> Use `get_console_logs` to read the tab's console (buffered, last 500
> entries); it starts capturing on first call. `clear_console_logs` empties the
> buffer. For service-worker / extension console output, use the
> service-worker tools (`inspect_service_worker_logs`, …).

---

## 🧩 Extensions & Service Workers (advanced)

1. `list_all_targets` (or `list_service_workers`) → find the target id.
2. `connect_to_target` / `execute_in_target` → talk to a specific context
   (extension SW, iframe, worker) — `execute_script` only runs in page tabs.
3. `get_extension_service_workers`, `get_service_worker`,
   `start_service_worker`, `stop_service_worker`, `update_service_worker`,
   `skip_waiting`, `get_sw_caches`, `inspect_service_worker_logs`,
   `unregister_service_worker` (permanent removal — careful).

---

## ♿ Accessibility & Performance (advanced)

- `get_accessibility_tree` — full tree (roles, names, values) for audits.
- `get_accessibility_snapshot` — compact YAML-like view of interactive roles.
- `run_performance_audit` — Core Web Vitals + basic timing (call right after
  navigation, before other interactions).
- `emulate_network_conditions` — throttle to `slow-3g`/`fast-3g`/`4g`/`offline`
  or reset with `none`.

Use the built-in prompts for guided passes: `audit-accessibility`,
`debug-console-errors`, `scrape-table`.

---

## 📚 MCP Resources

Each open tab is exposed as a listable, cacheable resource:

- `chrome://tab/{tabId}/html` — current page HTML
- `chrome://tab/{tabId}/screenshot` — current viewport PNG
- `chrome://tab/{tabId}/har` — live HAR buffer (needs an active recording)

Find `tabId` via `manage_tabs` (`action:"list"`).

---

## 🔒 Security defaults (read before delegating sensitive tasks)

- **Navigation** only accepts `http(s)` (plus `about:blank`/`chrome://newtab/`).
  `file://` is blocked — set `CHROME_MCP_ALLOW_FILE_URLS=1` in the server env
  only for local testing.
- **Cookie values are redacted** unless `includeValues:true` is passed.
- **HAR exports and downloads are sandboxed** to the working directory or the
  system temp folder.
- The **CDP debug port uses an origin allow-list** (localhost/DevTools), so
  web pages cannot hijack it.
- `close_browser` / server shutdown only close a Chrome that this MCP launched;
  your own browsing sessions are never force-killed.

### Modern MCP behaviors (v1.5+)

- High-traffic tools declare an **output schema** → clients receive typed
  `structuredContent` (not only JSON text).
- Long operations emit **progress** when the call includes
  `_meta.progressToken` (Chrome launch reports live stages).
- Server diagnostics use standardized **logging** (`logging/message`),
  filtered by the `MCP_LOG_LEVEL` env var.
- **Optional confirmation gate:** run the server with
  `CHROME_MCP_CONFIRM=on` and destructive tools
  (`clear_cookies`, `import_session`, `unregister_service_worker`,
  `clear_all_mocks`, …) refuse to run unless the call passes `_confirm: true`
  (the agent must have asked the user first).

---

## 🚫 Common Mistakes

| ❌ Old habit | ✅ Current tool |
|---|---|
| `navigate("url")` | `browser_action` `{ action:"navigate", url }` |
| `click("#x")` / `type("#x","t")` | `perform_interaction` `{ action:"click"\|"type", … }` |
| `list_tabs` / `create_tab` | `manage_tabs` `{ action:"list"\|"create", … }` |
| `enable_network_interception` | `start_capturing_network_requests` |
| `list_intercepted_requests` | `show_captured_network_traffic` |
| `get_har_entries` | `stop_har_recording` → `export_har_file` |
| `monitor_websocket_messages` | `list_websocket_messages` |

---

## 🧰 Troubleshooting

- **"Element not found"** → `get_html` first; selector may need
  `iframe`/shadow-DOM handling via `execute_script`.
- **"Tool disabled by user" (VS Code)** → reload VS Code and press
  **Always Allow** when the tool is invoked again.
- **Advanced tools not visible** → call `show_advanced_tools`.
- **Page seems frozen after interception** → call the matching
  disable/continue tool (`disable_response_interception` /
  `stop_capturing_network_requests` / `continue_network_request`) — these now
  act on the same CDP session that enabled the interception.
- **Timeout errors** → increase `timeout`/`timeoutMs`; prefer
  `wait_for_load_state` after navigation.
- **Chrome opens but tools can't connect** → confirm only one Chrome is
  attached; `get_browser_status` shows the connection state and CDP port.

**Remember:** analyze with `get_html`/`screenshot` before any interaction.
Never guess — always verify.
