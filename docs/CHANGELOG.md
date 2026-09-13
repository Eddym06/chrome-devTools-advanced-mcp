# Changelog

All notable changes to this project will be documented in this file.

## [1.8.1] - 2026-09-13

### 🐛 No more cross-talk between MCP servers
Found while running the new-user demo with two servers at once (the host's on
9224 and a demo one on 9413): the demo server's `launch_chrome_with_profile`
**attached to the other server's clone** instead of launching its own browser,
because automatic attach treated any drivable endpoint as fair game.

- Automatic attach (launch-first path and lazy connect) now only reuses a
  browser whose user-data dir we can identify (the real profile, or a clone under
  *our* `CHROME_MCP_PROFILE_DIR`) or one listening on *our own* port. An
  unrecognised endpoint is skipped with an explanatory reason.
- `attach_to_running_chrome` still attaches to anything, on purpose: that is the
  explicit "use the browser I have open" tool (`acceptUnknownKind`).
- Also fixed in this pass: a fresh clone no longer inherits the source's
  App-Bound key (it gets its own on first launch); `get_html`'s demo artefact
  aside, screenshots/navigation in the demo were fine.

Tests: 3 new cases (17 in that file). Docs updated.

## [1.8.0] - 2026-09-13

### 🚀 One-command onboarding (`setup_chrome_profile`)
- **New `setup_chrome_profile`** does the whole first-time setup in a single call:
  pick the profile, mirror it (identity, bookmarks, history, favicons, new-tab
  tiles, preferences, extensions), launch Chrome on it, and return `userSteps` —
  the exact plain-language sentences to show the human. It also reports
  `alreadySetUp` (detected by reading the clone's own cookie DB with
  `node:sqlite` when available) so agents can skip the ceremony afterwards.
- **Extensions are copied ONCE** (default on, `includeExtensions`/`recopyExtensions`
  to control, `CHROME_MCP_CLONE_EXTENSIONS=0` to skip). After the clone starts,
  its extension state belongs to the clone; re-merging would fight it.
- A fresh clone no longer inherits the real profile's App-Bound key — it gets its
  own on first launch (an existing clone keeps its own, so its session survives).
- Docs: a "what the user has to do" table per platform in README and the usage
  guide. Short version: **Windows → sign in to Google once inside the clone;
  macOS/Linux → close Chrome once before the setup.** Nothing else, ever.

Tests: 5 new cases (extensions copied once, disabled, and the onboarding tool
including the already-set-up path). 91 total green.

## [1.7.3] - 2026-09-13

### 🧑 Why a clone looked like a guest profile (and three fixes)
A clone used to open with no profile name, no bookmarks and no history — as if
it were a guest profile. Three separate causes:

- **`Local State` was skipped whole** (1.7.2 skipped it to protect the clone's own
  crypto key), and that file is also where `profile.info_cache` lives — the
  profile names, avatars and account emails. The clone fell back to the default
  "Your Chrome" with no identity. Now only the *portable half* is merged in
  (`mergeLocalStatePortable`), while the clone's own `os_crypt` keys are never
  overwritten, so profile identity comes back without breaking decryption.
- **Bookmarks never survived**: Chrome recreates its own (empty) `Bookmarks` and
  `History` the first time the clone starts, those files are *newer* than ours,
  and the "newest wins" rule therefore kept the empty ones forever. Content files
  (`Bookmarks`, `History`, `Favicons`, `Top Sites`, `Shortcuts`, `Visited Links`)
  are now **mirrored from the real profile** — new `includeBrowsingData` (default
  on, `CHROME_MCP_CLONE_HISTORY=0` disables) — so new-tab tiles, omnibox
  suggestions and bookmarks look like the user's browser.
- Session/state files (`Local Storage`, `IndexedDB`, `Preferences`, cookie DB)
  keep the newest-wins rule, refined with "untouched since the last sync wins the
  source", so anything the user changes **inside** the clone (logins, settings)
  is still preserved. Content files are a mirror: editing them inside the clone
  does not survive the next merge (documented).

Cookies and saved passwords remain uncopyable on App-Bound Encryption platforms —
that part is Chrome's design, not a copy setting (see 1.7.2).
Tests: 4 new cases (87 total green).

## [1.7.2] - 2026-09-13

### 🔎 Why a perfect profile copy still opens logged out (App-Bound Encryption)
Measured on a real machine: a **byte-identical** copy of a 1460-cookie profile
became **0 cookies** the moment Chrome started on the clone, with
`Failed to decrypt token for service AccountId-…` in Chrome's own log. Cause:
since Chrome 127 on Windows, cookie *values* (and saved passwords) are encrypted
with **App-Bound Encryption**, whose key is bound to the browser and unwrapped by
the elevation service — a profile copied to another user-data dir cannot decrypt
them, so Chrome discards the lot. It is an intentional anti-cookie-theft
property, not a bug in the copy.

- `cloneChromeProfile` now detects that (`os_crypt.app_bound_encrypted_key` in
  `Local State`) and reports `appBoundEncryption` + `cookiesUsable`, with an
  `actionRequired` that says what really works instead of promising a logged-in
  clone.
- **Encrypted state is skipped, not copied-and-discarded.** Copying the real
  cookie/password store into a clone is not only useless on ABE platforms, it is
  destructive: it would overwrite the session the user creates *inside* the clone
  with data Chrome then deletes. So on those platforms the merge no longer
  touches the cookie DB, `Local State`, `Login Data`, `Web Data` or the DBSC
  store — the clone keeps its own working session, and cloning no longer needs
  Chrome to be closed at all.
- `sessionCarriedOver` in the tools now means "the clone will really be logged
  in" (`cookiesUsable`), not "a cookie file was copied".
- `attachRecipe` now leads with the honest one-time fix: drive the clone and sign
  in **once** inside it (that session belongs to the clone and persists), or run
  a Chrome that is debuggable from the start and use it daily.
- Also copies `Network/Device Bound Sessions`, so DBSC-bound sessions (Google's
  `__Secure-1PSIDTS`) travel with the profile on platforms where the cookie copy
  *is* decryptable (macOS/Linux).
- Docs corrected: what a clone actually carries (localStorage, IndexedDB,
  preferences, bookmarks…) and what it cannot (cookie-based logins, saved
  passwords) on Windows.

## [1.7.0] - 2026-09-13

### 🔌 Attach to an already-open Chrome instead of launching a duplicate
- **New `attach_to_running_chrome` tool.** Scans the usual CDP ports (9222-9225, 9333 and the
  server's own `--port`), verifies each endpoint is a real browser, reads the owning process
  command line to learn its `--user-data-dir`/`--profile-directory`, and attaches to the best
  match (your real profile first, then a managed clone). Returns the tabs/URL it landed on.
- **`launch_chrome_with_profile` is now attach-first.** Before spawning anything it looks for a
  browser it can reuse; two Chromes cannot share a user-data dir, so reusing is always better than
  launching a second one. The result reports `reusedExistingBrowser`, `attachedPort` and
  `attachedKind`, and the message says plainly that nothing was launched.
- **Lazy connect reuses too.** `ensureConnected` (the silent path used by every tool) now scans for
  an attachable browser instead of only looking at its own port.
- **Honest answer when it is impossible.** If a Chrome with the requested profile is open *without*
  a debug port, the tools say exactly that (detected by the locked cookie DB / `SingletonLock`) and
  return a recipe: `use-the-clone` (close Chrome once, then drive the clone) or `restart-with-port`
  (start Chrome with a non-default user-data dir plus `--remote-debugging-port`). Pass
  `ifProfileInUse: "fail"` to refuse the clone and get the recipe as an error instead.
  This is a real limit: Chrome 136+ ignores `--remote-debugging-port` for the default user-data
  directory, so an already-open normal Chrome cannot be attached to at all.

### 🧪 Tests
- `src/tests/attach.test.ts` (14 tests): command-line flag parsing, owner classification
  (real profile vs managed clone vs unknown), attach-target ranking, profile-in-use detection and
  the recipe text.

## [1.6.0] - 2026-09-13

### 👤 Real profile cloning & session carry-over (4 new tools)
- **`list_chrome_profiles`** — lists the real Chrome profiles (display name, Google account,
  `last_used`, whether session state exists) plus the managed clone status of each one. Works
  without a browser connection.
- **`clone_chrome_profile`** — mirrors a real profile (cookies, localStorage, IndexedDB, saved
  passwords, preferences) into a **persistent** managed folder (`~/.chrome-mcp/profiles/<profile>`,
  overridable with `CHROME_MCP_PROFILE_DIR`), so the automated browser opens already signed in and
  keeps its session between MCP runs. Supports `"auto"` (last-used logged-in profile), profile
  names/directories, `launch:true` to open Chrome right away, and `waitForChromeCloseSeconds`.
- **`sync_chrome_profile_to_real`** — pushes logins created in the clone back into the real Chrome
  profile (session files only, never forced over locked files).
- **`remove_chrome_profile_clone`** — deletes a clone; the real profile is never touched.

### 🛠 Reliability
- **The profile clone replaced the old `os.tmpdir()` "shadow profile".** It used to be re-copied
  with `robocopy`/`rsync` into the temp dir on every launch, so every login was lost on cleanup and
  the shell-out gave no error detail. Copying is now pure Node, incremental by mtime, skips
  caches/GPU shader/Service Worker trees, tolerates locked files, and reports them individually.
- **`Local State` is copied with the cookies.** It holds the OS-crypt key; without it the cloned
  cookies are undecryptable and the clone opens logged out.
- **Key-store flags are now platform-correct.** `--use-mock-keychain --password-store=basic` is only
  passed on Windows (where the key lives in `Local State`) or when `CHROME_MCP_PASSWORD_STORE=1`
  (headless CI); forcing a mock keychain on macOS/Linux made cloned cookies undecryptable.
- **`close_browser` closes gracefully** (`Browser.close`, then kills only if needed) so Chrome
  flushes cookies/localStorage before exiting — a hard `taskkill /F` could silently drop the login
  just created in the automated browser. External browsers are still only detached.
- **Any profile can be cloned**, not just `Default` (previously a non-default profile launched
  directly against the live user-data dir and failed whenever Chrome was running).
- **First-time clone forces the cookie files** over the empty DB Chrome creates inside a fresh
  clone, and stale `SingletonLock*` files are removed before every launch.
- `launch_chrome_with_profile` now honours `headless`, defaults to `"auto"` profile selection, and
  returns the clone statistics (files copied, session items, warnings).

### 🐛 Fixes found by driving the real browser
- **`"auto"` no longer reaches Chrome as a profile name.** `launch_chrome_with_profile` passed the raw
  string through, so Chrome happily created an empty profile called `auto` (`--profile-directory=auto`)
  instead of using the real one. The profile is now resolved to its real directory name before launch
  (`src/chrome-connector.ts`).
- **A CDP port owned by an embedded Chromium is rejected instead of hijacked.** Port 9222 on Windows is
  routinely held by WebView2-based apps (Lenovo Vantage's battery widget:
  `Browser: Edg/152…`, `User-Agent: LenovoVantage/3.0.0.197`). The old check only rejected payloads
  containing "webview", so the server "connected" to a hidden widget and every tool drove the wrong
  browser. Endpoints are now classified by browser token, real-browser user agent and the process that
  owns the port (`src/utils/cdp-endpoint.ts`), and the launch fails fast with an actionable message
  instead of spawning Chrome onto a busy port. `get_browser_status` reports the port owner.
- **"Session carried over" is no longer reported when it was not.** The launch result used "does a
  cookie file exist", which is true for the empty cookie DB Chrome creates inside a fresh clone. It now
  reports cookie *freshness*, and a clone whose cookies never came over retries the copy on every launch
  (the "synced recently" shortcut no longer hides it) and says so in `warnings`.
- **`CHROME_MCP_REAL_USER_DATA_DIR` is honoured on launch** (the connector used to overwrite it with the
  platform default, so the override had no effect).

### 🧪 Tests & docs
- 12 new unit tests (`src/tests/chrome-profiles.test.ts`) covering discovery, resolution, cloning,
  incremental merge, cookie freshness, sync-back and removal.
- Docs: tool count 90 → 94, new *Profile & session* section in the usage guide, env-var table and
  troubleshooting entries in the install guide.

## [1.5.0] - 2026-08-19

### 🔒 Security
- **CDP debug port no longer open to the web.** Chrome is launched with a restrictive
  `--remote-allow-origins` allowlist (`localhost`/`devtools://`) instead of `*`. The MCP server
  connects without an Origin header, so it is unaffected, but no webpage can hijack the debug port
  to read cookies, run JS or navigate to `file://` anymore (`src/chrome-connector.ts`).
- **URL allow-list on navigation.** `browser_action`/`manage_tabs`/all smart-workflow navigation
  tools validate URLs (http/https, plus `about:blank`/`chrome://newtab/`). `file://` is blocked by
  default (`CHROME_MCP_ALLOW_FILE_URLS=1` re-enables for local testing) — closes the arbitrary
  local-file read primitive (`src/utils/helpers.ts`).
- **Sandboxed file output.** HAR exports and downloads resolve inside the working directory or temp
  folder only; filenames are sanitized (`src/utils/file-storage.ts`, used by `export_har_file`,
  `download_file`).
- **Cookie values hidden by default.** `get_cookies`, `export_session` and
  `manage_browser_session` redact cookie values unless `includeValues=true` is passed; import/load
  skip valueless cookies with an explicit message instead of silently writing empty cookies.
- Removed a `console.log` that ran inside the stdio process and would corrupt the JSON-RPC stream
  (`add_advanced_interception_pattern` now logs to stderr).
- JS-string interpolation of URLs/scopeURLs hardened (`JSON.stringify`) in `resend_network_request`,
  `test_api_endpoint`, `unregister_service_worker`, `update_service_worker`.

### 🛠 Reliability
- **Interception enable/disable now happen on the SAME CDP session** (Fetch domain state is
  session-scoped). Previously `disable_response_interception` / `stop_capturing_network_requests`
  disabled a different session — a silent no-op that could freeze the page on the next matching
  request. All enable paths now store their owning session + listener unsubscribe handles, and every
  disable/modify/continue/clear tears down through that owner.
- **Mock endpoints work together.** Creating mocks refreshes the Fetch pattern set with ALL mock
  patterns and keeps ONE listener per tab (previously each mock replaced the last one and stacked
  listeners); delete/clear re-sync or detach correctly. Slow mocks (latency > timeout) no longer
  time out and silently fall through.
- **WebSocket capture** has bounded buffers (200 connections / 1000 messages) and its disable tool
  detaches listeners + disables the domain. `send_websocket_message` no longer reports false success
  (CDP cannot push frames into an open WebSocket; it now hooks new connections and reports honestly).
- **HAR fixes:** `stop_har_recording → export_har_file` flow works (the finished recording is parked
  instead of deleted); creator version reads `package.json`; queryString and response content size
  are populated; entry `time` uses monotonic deltas instead of subtracting wall-time from a
  monotonic clock; entries are capped.
- **Per-tool timeout backstop** (120s) so a hung CDP call can never leave an MCP request pending
  forever (`src/server.ts`); `print_to_pdf`, `CDP.List` liveness probes and reload waits got explicit
  timeouts.
- **Navigate/load race fixed** in five smart-workflow tools and `browser_action` reload: the one-shot
  `loadEventFired` is now subscribed BEFORE navigation is triggered (awaited after → hang on fast
  pages).
- **Lifecycle:** `close_browser`/server shutdown kill a Chrome that THIS server launched (no more
  orphan browsers with open debug ports between restarts); module capture/interception state resets
  on browser disconnect; `connect()` closes a previous live client; process-death cleanup is
  re-entrancy-guarded and closes persistent clients; default tab selection prefers real pages over
  service-worker targets.
- **Stealth script** now reports `navigator.webdriver=false` (real Chrome value), keeps the
  fingerprint seed stable per origin during a session, and removed the hard-coded
  `platform:'Win32'`/Intel-GPU/screen spoofs that contradicted the real environment (a self-inflicted
  detection signal on non-Windows/non-Intel machines).

### 🧹 Housekeeping
- `package.json`: clean build (`dist` wiped before `tsc`), `files: ["dist"]`, `types`, `pack:check`;
  deleted the stale `package/` build duplicate and the outdated `verify-tools.ts` dev script.
- New unit tests for URL validation, filename sanitization and the output sandbox
  (`src/tests/security.test.ts`); validated with a real-Chrome headless E2E smoke.

### 📖 Docs (Phase 2)
- `docs/USAGE_GUIDE.md` rewritten against the current (v1.4) consolidated tool vocabulary
  (no more `navigate`/`click`/`type`/`list_tabs`/`enable_network_interception`/`get_har_entries`),
  with the action-enum tools, resources/prompts and the security defaults.
- `docs/TOOLS.md` added: complete machine-checked reference of all 90 tools (core vs advanced).
- `docs/INSTALL.md` rewritten in English with the current package name/version, npx usage and no
  machine-specific absolute paths; `docs/mcp-config-example.json` is now a reusable npx template.
- `scripts/validate-docs.mjs` + `npm run docs:check`: fails CI/build docs whenever a guide cites a
  tool that does not exist (guards against the v1.0→v1.4 drift class). CI now runs this step.

### ✨ Phase 3 — MCP 2026 polish
- **Structured output:** shared loose output schemas (`src/schemas.ts`, `success` required +
  passthrough) for ~35 high-traffic tools → the SDK validates results and forwards typed
  `structuredContent` (`outputSchema` declared next to handlers still wins).
- **Progress notifications:** tool calls that pass `_meta.progressToken` receive live
  `notifications/progress` (0/100 wrapper + granular stages during `launch_chrome_with_profile`).
  Long handlers call `reportProgress()` from `utils/log.ts`.
- **Standardized logging:** server → client `logging/message` via `sendLoggingMessage`
  (`utils/log.ts`), gated by `MCP_LOG_LEVEL` (default `info`).
- **Resource completions:** `chrome://tab/{tabId}/…` resources now autocomplete live tab IDs.
- **User-confirmation gate (optional):** `CHROME_MCP_CONFIRM=on` requires `_confirm:true` for
  destructive tools (`clear_cookies`, `delete_cookie`, `import_session`,
  `unregister_service_worker`, `clear_all_mocks`, …) until hosts support full MCP elicitation.
- **Trusted interaction:** `perform_interaction` clicks use real CDP mouse events at the element
  center (with visibility/actionability checks, synthetic fallback via `mode`), typing uses
  `Input.insertText` on a focused/selected field; `fill_form` uses the native value setter so
  React/Vue controlled inputs register changes.
- **Stealth per tab:** the stealth script now auto-applies to every NEW/activated tab (per-target
  guard prevents duplicate registration) — not just the first tab.
- **HAR conformance:** central `utils/har.ts` (`createHarLog`, guaranteed HAR 1.2 shape, creator
  version from package.json), CDP ResourceTiming → HAR timings mapping, case-insensitive
  `redirectURL`; unit-tested.
- **Service workers:** `unregister_service_worker` / `update_service_worker` use the CDP
  `ServiceWorker` domain → work for any scope, not only the current tab origin.
- **CI/release:** publish workflow on `v*` tags (lint + docs:check + build + test + pack dry-run +
  `npm publish --provenance`); E2E suite extended with real interception (`enable →
  capture → disable`) and HAR recording/export against a local HTTP server.

## [1.4.0] - 2026-08-19

### ✨ MCP Resources

- `chrome://tab/{tabId}/html`, `chrome://tab/{tabId}/screenshot`, `chrome://tab/{tabId}/har` — current tab state exposed as listable/cacheable resources instead of only one-shot tool results (`src/resources.ts`).

### ✨ MCP Prompts

- `audit-accessibility`, `debug-console-errors`, `scrape-table` — pre-baked task templates that instruct the calling LLM to chain this server's own tools (`src/prompts.ts`).

### ✨ Explicit output schemas

- `get_html`, `screenshot`, and `manage_tabs` now declare a Zod `outputSchema`; the SDK validates every non-error return against it and forwards typed `structuredContent` instead of relying on the generic best-effort passthrough used by the rest of the tools.

### ✨ New tools

- `download_file` — clicks a download trigger, enables `Browser.setDownloadBehavior` for the call, and returns the saved file path.
- `fill_form` — fills multiple fields (text/select/checkbox, auto-detected) in one call instead of N `perform_interaction` calls.
- `run_performance_audit` — Core Web Vitals (LCP, CLS) and basic timing (TTFB, FCP, long tasks, JS heap) via `PerformanceObserver`.
- `emulate_network_conditions` — throttle to Slow 3G / Fast 3G / 4G / offline (or custom values) via `Network.emulateNetworkConditions`.
- `get_indexed_db` — list IndexedDB databases, or read records from every object store in one.

### 🔒 Isolation fix

- `test_with_different_cookies` previously mutated the *real* tab's live cookies (save → overwrite → navigate → best-effort restore), meaning a crash mid-run could leave the user's actual session in the test's cookie state. It now runs inside a throwaway Playwright `browser.newContext()` — a separate cookie jar/storage that never touches the real profile. The now-meaningless `restoreOriginal` parameter was removed.

### 🧹 Housekeeping

- `.npmignore` was letting `assets/logo.png` (4.5MB) and `recordings/demo_recording.har` (86KB) into every published tarball — neither is needed at runtime (GitHub/npm render README images straight from the repo, not the tarball). Published package size: 4.7MB → 238KB.

## [1.3.0] - 2026-08-19

### 🚀 Modernization

- Migrated the server from the low-level `Server` API to `McpServer.registerTool`, dropping the ~70-line hand-rolled Zod→JSON-Schema converter in favor of the SDK's own conversion.
- Added MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title`) across all tools, derived from naming convention with explicit overrides for composite/lifecycle tools (see `src/tool-annotations.ts`).
- `show_advanced_tools` / `hide_advanced_tools` now use the SDK's native `RegisteredTool.enable()/disable()` (auto-sends `notifications/tools/list_changed`) instead of a manual boolean flag + manual notification call.
- Tool results now include `structuredContent` alongside the text block where the handler returns a plain object.
- Upgraded to Zod v4, `@modelcontextprotocol/sdk` 1.30, Playwright 1.62.
- Replaced hand-rolled `escJS` string-quote escaping (used when interpolating selectors into `Runtime.evaluate` expressions) with `JSON.stringify`, which correctly escapes all cases instead of just backslash/quote.

### 🐛 Fixes

- `get_accessibility_tree` was registered under the same name in both `capture.ts` and `network-accessibility.ts`; the weaker duplicate (capture.ts) is removed.
- `chrome-connector.ts` waited 3s twice in a row during launch verification (a copy-paste duplication), doubling launch latency for no reason.
- Server-reported version now reads from `package.json` at runtime instead of being hardcoded separately (was silently out of sync).

### ✨ New tools

- `get_console_logs` — reads buffered `console.log/warn/error/info/debug` output and uncaught exceptions for a tab; capture starts automatically on first call.
- `clear_console_logs` — clears the buffer without reading it.

### 🧹 Housekeeping

- Removed `src/tools/advanced-network.backup.ts` (1100+ lines of dead code) and the stray `package/` directory (leftover `npm pack` artifacts) from version control.
- Added `eslint.config.js` (flat config) — `npm run lint` was previously broken (ESLint 9 requires flat config, none existed).
- Added `vitest` with a unit suite (`src/tests/helpers.test.ts`), a registry regression test guarding against duplicate tool names (`src/tests/registry.test.ts`), and a full protocol-level integration test using an in-memory MCP client (`src/tests/server.integration.test.ts`).
- Added GitHub Actions CI (`.github/workflows/ci.yml`): lint + build + test on Node 20 and 22.
- Split `index.ts` into `registry.ts` (pure tool aggregation) and `server.ts` (McpServer assembly) so both are unit-testable without booting stdio transport.

## [1.0.0] - 2026-01-07

### ✨ Features

#### Core
- Initial release of Custom Chrome MCP
- Connect to existing Chrome instances via CDP (port 9222)
- Full MCP protocol implementation with 44 tools

#### Navigation & Tabs (8 tools)
- Navigate to URLs with wait conditions
- Browser history (back/forward)
- Page reload with cache options
- Multi-tab management (list, create, close, switch)
- Get current URL and page info

#### Interaction (8 tools)
- Click elements with human-like delays
- Type text with realistic timing
- Get text content and attributes
- Execute custom JavaScript
- Scroll pages and elements
- Wait for selectors with timeout
- Select options from dropdowns

#### Anti-Detection (5 tools)
- Stealth mode with navigator.webdriver masking
- Custom user agent configuration
- Viewport and device emulation
- Geolocation spoofing
- Timezone override

#### Service Workers (9 tools)
- List all registered service workers
- Get detailed worker information
- Unregister service workers
- Force update registrations
- Start/stop workers
- Inspect workers in DevTools
- Skip waiting phase
- Manage service worker caches

#### Capture & Export (5 tools)
- Screenshots (PNG/JPEG, full page, custom areas)
- Export to PDF
- Get HTML content
- Page layout metrics
- Accessibility tree export

#### Sessions & Cookies (9 tools)
- Cookie management (get, set, delete, clear)
- localStorage operations
- sessionStorage support
- Full session export/import
- Cross-session persistence

### 🛡️ Security
- Anti-detection measures
- Realistic browser fingerprinting
- Human-like interaction patterns

### 📚 Documentation
- Comprehensive README
- Usage examples
- Troubleshooting guide
- API documentation

### 🔧 Technical
- TypeScript implementation
- Zod schema validation
- Error handling
- Graceful shutdown
- Modular architecture

## [Unreleased]

### Planned Features
- Visual regression testing
- Network throttling
- Performance profiling
- Video recording
- Auto-recovery mechanisms
- Multi-profile support (future)
