# Tool Reference (all 94 tools)

Complete, machine-checked list of the tools exposed by this server
(`npm run docs:check` verifies this document never references a tool that
does not exist).

**Tiers:** 40 core tools are visible immediately + 2 control tools;
**52 advanced tools** are registered but hidden until `show_advanced_tools`
is called (`hide_advanced_tools` collapses the list again).

## Control (2)

| Tool | Purpose |
|---|---|
| `show_advanced_tools` | Unlock the hidden advanced toolset |
| `hide_advanced_tools` | Hide the advanced toolset again |

## 🎭 Browser & Profile (core, 7)

| Tool | Purpose |
|---|---|
| `launch_chrome_with_profile` | Start here — launches Chrome on a persistent clone of your real profile (session/logins carried over), without closing other windows |
| `close_browser` | Close gracefully (flushes cookies/localStorage) a Chrome that THIS server launched; external browsers are only detached |
| `get_browser_status` | Connection state, CDP port, Playwright-managed or external |
| `list_chrome_profiles` | List the real Chrome profiles (display name, Google account, clone status). Needs no browser |
| `clone_chrome_profile` | Clone a real profile into a managed folder so the browser opens already signed in (optional immediate launch) |
| `sync_chrome_profile_to_real` | Push logins/cookies created in the clone back into your real Chrome profile |
| `remove_chrome_profile_clone` | Delete a managed clone (frees disk, discards its session) |

## 🧭 Navigation & Tabs (core, 3)

| Tool | Purpose |
|---|---|
| `browser_action` | Navigate / back / forward / reload (validated http(s) URLs only) |
| `manage_tabs` | List / create / close / switch tabs, or get the current URL |
| `wait_for_load_state` | Wait for `load`, `domcontentloaded` or `networkidle` |

## 🖱️ Interaction & Extraction (core, 3)

| Tool | Purpose |
|---|---|
| `perform_interaction` | Click / type / select / scroll / wait on a CSS selector |
| `extract_element_data` | Read text or an attribute from an element |
| `execute_script` | Run custom JavaScript in the page (must `return` a value) |

## 🍪 Cookies, Storage & Sessions (core, 10)

| Tool | Purpose |
|---|---|
| `get_cookies` | List cookies for the page/URL (values redacted unless `includeValues` is set) |
| `set_cookie` | Set a cookie (name, value, domain, flags) |
| `delete_cookie` | Delete one cookie by name/domain/path |
| `clear_cookies` | Clear current-domain cookies or all domains |
| `get_local_storage` | Read localStorage of the current origin |
| `set_local_storage` | Write one localStorage key |
| `clear_local_storage` | Clear localStorage for the current origin |
| `export_session` | Export cookies+storage as JSON (redacted by default) |
| `import_session` | Restore an exported session (skips valueless cookies) |
| `get_indexed_db` | Inspect IndexedDB databases/records (read-only) |

## 📸 Capture (core, 4)

| Tool | Purpose |
|---|---|
| `screenshot` | Save a viewport/full-page/element PNG or JPEG to disk, returns `filePath` |
| `get_html` | Page HTML or HTML of a CSS `selector` (truncated at 50 KB) |
| `print_to_pdf` | Save the page as a PDF file |
| `get_page_metrics` | Layout/viewport metrics |

## 📋 Console (core, 2)

| Tool | Purpose |
|---|---|
| `get_console_logs` | Read buffered console + uncaught exceptions for a tab (capture starts on first call) |
| `clear_console_logs` | Clear the buffer without reading |

## ⬇️ Downloads (core, 1)

| Tool | Purpose |
|---|---|
| `download_file` | Click a download trigger and return the saved path (sandboxed directory) |

## 🧠 Smart Workflows (core, 10)

| Tool | Purpose |
|---|---|
| `add_custom_header_to_request` | Add a header to matching requests before they are sent |
| `intercept_and_modify_traffic` | Intercept + modify requests in real time (headers/body/method) around an action |
| `capture_network_on_action` | Capture requests triggered by a click / navigation / typing |
| `navigate_and_extract_content` | Navigate and extract text/links/images/metadata in one call |
| `test_api_endpoint` | Test an http(s) endpoint from the page context (CORS-aware) |
| `simulate_user_journey` | Execute a scripted sequence of click/type/wait/navigate/screenshot steps |
| `extract_api_data` | Navigate and capture all matching API/XHR responses as JSON |
| `manage_browser_session` | One-call save/load/clear/export of cookies + storage |
| `test_with_different_cookies` | Test a URL in a throwaway isolated context (never touches the real session) |
| `fill_form` | Fill multiple form fields (text/select/checkbox) in one call |

---

## 🔓 Advanced tools (52, hidden until `show_advanced_tools`)

### Request interception & replay (network-accessibility, 9)

| Tool | Purpose |
|---|---|
| `start_capturing_network_requests` | Enable Fetch request interception (autoContinue for monitoring, pauseMode for modification) |
| `show_captured_network_traffic` | List paused + history requests with URLs/methods/headers/requestIds |
| `modify_network_request` | Modify URL/headers/body of a paused request, then continue |
| `block_network_request` | Fail a paused request with a network error reason |
| `continue_network_request` | Continue a paused request unchanged |
| `resend_network_request` | Replay a captured request with optional overrides (CORS may apply) |
| `stop_capturing_network_requests` | Disable interception on the owning session (safe) |
| `get_accessibility_tree` | Full accessibility tree (roles/names/values) |
| `get_accessibility_snapshot` | Compact YAML-like snapshot of interactive roles |

### Response interception, mocking, WebSockets, HAR, injection (advanced-network, 22)

| Tool | Purpose |
|---|---|
| `enable_response_interception` | Pause/capture server responses before the browser gets them |
| `list_intercepted_responses` | Show captured/paused responses with requestIds |
| `modify_intercepted_response` | Replace a paused response body/headers/status |
| `disable_response_interception` | Disable response interception on the owning session (safe) |
| `create_mock_endpoint` | Serve canned responses for a URL pattern (multiple mocks supported) |
| `list_mock_endpoints` | List active mocks with hit counts |
| `delete_mock_endpoint` | Remove one mock (remaining patterns stay live) |
| `clear_all_mocks` | Remove all mocks and detach the interceptor |
| `enable_websocket_interception` | Capture WebSocket connections and frames |
| `list_websocket_connections` | List captured WebSocket connections |
| `list_websocket_messages` | List sent/received WS messages (bounded buffer) |
| `send_websocket_message` | Send over a NEW page WebSocket (CDP cannot push into open sockets) |
| `disable_websocket_interception` | Detach WS listeners and clear buffers |
| `start_har_recording` | Begin HAR recording for a tab |
| `stop_har_recording` | Stop and return the HAR (parked for export) |
| `export_har_file` | Write HAR data to disk (sandboxed path; active or last-completed recording) |
| `add_advanced_interception_pattern` | Advanced logging/blocking/delaying by status/size/duration/content-type |
| `inject_css_global` | Persistent CSS that survives navigation (per tab) |
| `inject_js_global` | Persistent JS that runs before page scripts (per tab) |
| `list_injected_scripts` | List active injection identifiers |
| `remove_injection` | Remove one injection by identifier |
| `clear_all_injections` | Remove all injections |

### Anti-detection (5)

| Tool | Purpose |
|---|---|
| `enable_stealth_mode` | Re-apply stealth patches to a tab (already active on launch) |
| `set_user_agent` | Override the UA string for a tab |
| `set_viewport` | Emulate viewport size / mobile / DPR |
| `set_geolocation` | Mock GPS coordinates |
| `set_timezone` | Override the timezone (IANA id) |

### Service workers & extensions (10)

| Tool | Purpose |
|---|---|
| `list_service_workers` | List service-worker CDP targets (all origins) |
| `get_service_worker` | Registration info by registrationId / targetId / scopeURL |
| `inspect_service_worker_logs` | Capture console logs from a worker target |
| `inspect_service_worker` | General worker inspection entry point |
| `start_service_worker` | Start a stopped worker by scopeURL |
| `stop_service_worker` | Stop a worker by versionId |
| `update_service_worker` | Force an update check for a scope |
| `unregister_service_worker` | Permanently remove a registration by scopeURL (careful) |
| `skip_waiting` | Activate a waiting worker immediately |
| `get_sw_caches` | Inspect CacheStorage entries via CDP |

### System & targets (4)

| Tool | Purpose |
|---|---|
| `list_all_targets` | List every Chrome target (pages, extensions, workers, iframes) |
| `connect_to_target` | Probe a specific target's execution context |
| `execute_in_target` | Run JS inside a specific target context (extension SW, iframe…) |
| `get_extension_service_workers` | Detailed extension-SW info + runtime access checks |

### Performance (2)

| Tool | Purpose |
|---|---|
| `run_performance_audit` | Core Web Vitals (LCP/CLS) + TTFB/FCP/long-tasks/heap |
| `emulate_network_conditions` | Throttle to slow-3g/fast-3g/4g/offline or reset |

---

## Resources & Prompts (not tools)

- Resources: `chrome://tab/{tabId}/html`, `chrome://tab/{tabId}/screenshot`,
  `chrome://tab/{tabId}/har`
- Prompts: `audit-accessibility`, `debug-console-errors`, `scrape-table`
