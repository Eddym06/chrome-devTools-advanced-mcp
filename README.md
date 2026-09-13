
# Chrome Devtools Advanced MCP

<img src="assets/logo.png" align="right" width="120" height="auto" alt="Logo">

**Your Intelligent Bridge Between AI and the Browser.**

This Model Context Protocol (MCP) server enables AI assistants like Claude, Roo Code, or Windsurf to interact with Google Chrome in a **natural, powerful, and stealthy way**. Unlike other automation tools, this solution connects to your actual browser profile, allowing you to use your existing login sessions, cookies, and extensions without detection.

---

## ✨ Why Use This?

*   **🕵️ "Human" Navigation:** Uses a persistent clone of your real Chrome profile (cookies, localStorage, logged-in accounts). If you're logged into LinkedIn, Gmail, or your corporate ERP, your AI assistant is too — and the session survives between runs.
*   **👤 Profile Cloning:** `list_chrome_profiles` finds every profile on the machine, `clone_chrome_profile` mirrors the one you want into `~/.chrome-mcp/profiles/…`, and `sync_chrome_profile_to_real` pushes logins back into your own Chrome.
*   **🛡️ Undetectable:** Stealth mode is applied per tab, and Chrome runs with the automation switch excluded.
*   **🛠️ Robust Toolset:** 96+ specialized tools, plus MCP resources and prompts, optimized for data scraping, specific element extraction, and visual analysis.
*   **⚡ Fast & Safe:** Safely executes scripts and screenshots, with intelligent output truncation to prevent crashing your AI context.

---

## 🚀 Quick Installation

### For Users (VS Code / Cline / Kilo Code / Antigravity / Claude Desktop)

Simply add this to your `mcp.json` configuration file:

```json
{
  "mcpServers": {
    "chrome-devtools-advanced-mcp": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-advanced-mcp", "--port=9223"]
    }
  }
}
```

Restart your assistant (Ctrl+R in VS Code), and you'll have instant access.

---

## 💡 Simplified Usage Guide

### 0. First time: use your real Chrome profile (one command, one sign-in)

Ask your AI:

> *"Set up Chrome with my profile"* → it calls **`setup_chrome_profile`**

That mirrors your real profile (your profile name/avatar, bookmarks, history,
new-tab tiles, settings and — once — your extensions) into
`~/.chrome-mcp/profiles/<profile>` and opens Chrome on it.

**What you have to do (the whole list):**

| Platform | You do this | Then |
|---|---|---|
| **Windows** | Sign in to Google **once**, in the Chrome window that just opened | Done forever: that session lives in the clone and is reused on every launch. Chrome never needs closing, and your own browser keeps working normally |
| **macOS / Linux** | **Close Chrome once** before the setup | Done: the cloned session works as-is, no sign-in needed |

Nothing else ever: no re-login, no closing Chrome afterwards, your personal
browser is never touched (the clone is a separate Chrome instance). Saved
passwords and autofill cannot be copied on Windows (Chrome encrypts them with a
key bound to the browser) — save them once inside the clone if you want them
there.

### 1. Launch the Browser
After that, ask your AI:
> *"Launch Chrome with my profile"*

This triggers `launch_chrome_with_profile`, which **reuses the clone window**
(or an already-debuggable Chrome) without closing your other windows.

### 2. Navigate & Analyze
You can ask:
*   *"Go to amazon.com and search for laptops"*
*   *"Analyze the HTML of the login form"* (Uses optimized `get_html`)
*   *"Take a screenshot of the pricing table"*

### 3. Interact
The AI can click, type, and fill forms intelligently, waiting for elements to load automatically.

---

## 🛠️ Tool List

Tools are split into two tiers so the default list stays manageable for the AI: **~42 core tools** are visible from the start; **~52 advanced tools** (Network Advanced, Anti-Detection & Privacy, Service Workers, System, Performance) stay hidden until the AI calls `show_advanced_tools` (call `hide_advanced_tools` to collapse the list again).

<details>
<summary><strong>👇 Click here to view all available tools</strong></summary>

### 🎭 Browser & Session Control
| Tool | Description |
|------|-------------|
| `launch_chrome_with_profile` | **Start Here!** Launches Chrome with your cookies/extensions. |
| `browser_action` | Navigate, reload, go back/forward. |
| `manage_tabs` | Create, close, switch, or list tabs. |
| `close_browser` | Safely closes the controlled session. |

### 🔍 Analysis & Extraction
| Tool | Description |
|------|-------------|
| `get_html` | **Critical.** Extracts simplified or full HTML. Supports selectors. |
| `screenshot` | Captures visual proof (png/jpeg). |
| `get_page_metrics` | Layout and viewport analysis. |
| `get_accessibility_tree` | See the page structure as screen readers do (advanced tools). |
| `get_console_logs` | Read console.log/warn/error/info/debug and uncaught exceptions for a tab — capture starts automatically on first call. |

### 🖱️ Interaction
| Tool | Description |
|------|-------------|
| `perform_interaction` | Click, Type, Hover, Drag & Drop with auto-wait. |
| `fill_form` | Fill multiple fields (text/select/checkbox) in a single call instead of N `perform_interaction` calls. |
| `execute_script` | Run custom JavaScript safely (requires `return`). |
| `extract_element_data` | Get specific text or attributes from elements. |
| `set_viewport` | Resize window for responsive testing. |
| `download_file` | Click a download trigger, wait for it to finish, and get the saved file path. |

### 🛡️ Anti-Detection & Privacy
| Tool | Description |
|------|-------------|
| `enable_stealth_mode` | Hides automation flags. |
| `set_user_agent` | Spoof device/browser identity. |
| `set_geolocation` | Mock GPS coordinates. |
| `set_timezone` | Change browser timezone. |

### 📡 Network (Advanced)
| Tool | Description |
|------|-------------|
| `capture_network_on_action` | Record traffic while performing an action. |
| `resend_network_request` | Replay captured API calls. |
| `start_har_recording` | Save full network logs (HAR format). |
| `list_websocket_messages` | Listen to socket traffic. |
| `emulate_network_conditions` | Throttle to Slow 3G/4G/offline to test resilience. |
| `run_performance_audit` | Core Web Vitals (LCP, CLS) + basic timing via PerformanceObserver. |

### 🍪 Storage & Cookies
| Tool | Description |
|------|-------------|
| `get_cookies` / `set_cookie` | Manage browser cookies. |
| `get_local_storage` | Read/Write local storage data. |
| `get_indexed_db` | List IndexedDB databases, or read records from one. |
| `export_session` | Save current session state to file. |
| `test_with_different_cookies` | Test a URL with a different cookie set inside a throwaway, fully isolated browser context — never touches your real session. |

</details>

### 📚 Resources & Prompts

Beyond tools, this server exposes two other MCP primitives:

* **Resources** (cacheable/listable, not just one-shot tool calls) — for each open tab:
  `chrome://tab/{tabId}/html`, `chrome://tab/{tabId}/screenshot`, `chrome://tab/{tabId}/har`.
* **Prompts** (pre-baked task templates that chain the tools above): `audit-accessibility`, `debug-console-errors`, `scrape-table`.

In clients that support them (e.g. Claude Desktop), these show up as attachable resources / slash-style prompts, separate from the tool list.

---

## ❓ FAQ

**Do I need to close my Chrome?**
No! Thanks to "Shadow Profile" technology, this server creates a temporary safe clone of your profile. You can keep browsing normally while the AI works in parallel.

**Does it work on Mac/Linux?**
Yes, it is fully cross-platform.

**I see "Tool disabled by user" error**
This is a VS Code security feature.
1. Reload VS Code (`Ctrl+R`).
2. When the AI tries to use a tool again, click **"Always Allow"** on the popup.

**Why are cookie values redacted / `file://` blocked?**
Security defaults (see `docs/USAGE_GUIDE.md` → *Security defaults*): navigation
is limited to `http(s)`, cookie values require `includeValues:true`, and HAR
exports/downloads are sandboxed to your working dir or temp folder.

---

## 📚 Documentation

*   **[docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md)** — practical workflows for
    the AI on the current (v1.5) tool vocabulary.
*   **[docs/TOOLS.md](docs/TOOLS.md)** — complete, machine-checked reference of
    all 96 tools.
*   **[docs/INSTALL.md](docs/INSTALL.md)** — installation & configuration.
*   **[docs/CHANGELOG.md](docs/CHANGELOG.md)** — release notes.

---

## 👨‍💻 For Developers

To contribute or run locally:

```bash
git clone https://github.com/Eddym06/chrome-devTools-advanced-mcp.git
cd chrome-devTools-advanced-mcp
npm install
npm run build
npm start
```

Before opening a PR:

```bash
npm run lint        # ESLint (flat config)
npm run build       # clean tsc build
npm test            # vitest — includes an in-memory MCP client/server integration test
npm run docs:check  # fails if any guide references a non-existent tool
# optional, on a machine with Chrome installed:
CHROME_MCP_E2E=1 npm test   # real-Chrome end-to-end suite
```

CI (`.github/workflows/ci.yml`) runs lint + build + test on Node 20 and 22 for every push/PR.

---
*Developed with ❤️ by @eddym06*
