# Custom Chrome MCP - AI Usage Guide

## 🎯 Philosophy: Always Analyze Before Acting

**GOLDEN RULE**: Never guess selectors or click blindly. Always analyze the page structure first.

---

## 📋 Common Workflows

### 1. Basic Web Navigation & Interaction

```
CORRECT WORKFLOW:
1️⃣ navigate - Go to the website
2️⃣ wait_for_load_state - Wait for page to fully load (use 'networkidle')
3️⃣ get_html or screenshot - ANALYZE the page structure
4️⃣ Identify correct CSS selectors from the HTML
5️⃣ click or type - Interact using verified selectors

EXAMPLE:
User: "Go to google.com and search for cats"

Correct sequence:
1. navigate("https://google.com")
2. wait_for_load_state("networkidle")
3. get_html() → See: <input name="q" class="gLFyf">
4. type("input[name='q']", "cats")
5. click("input[value='Google Search']")
```

**❌ WRONG**: 
```
navigate → click(".search-button")  // NO! You don't know if .search-button exists!
```

**✅ RIGHT**:
```
navigate → get_html → find selector → click with verified selector
```

---

### 2. Extension Debugging

```
WORKFLOW:
1️⃣ list_all_targets - Find all execution contexts
   → Filter by 'service_worker' to see extensions
2️⃣ Identify your extension - Look for title/url matching your extension
3️⃣ Get targetId - Copy the ID from the target
4️⃣ connect_to_target - Establish connection to that target
5️⃣ execute_in_target - Run code in the extension context
6️⃣ inspect_service_worker_logs - See console output (optional)

EXAMPLE:
User: "Debug my Chrome extension background script"

1. list_all_targets(filterType: 'service_worker')
   → Result: [{id: "ABC123", title: "My Extension", type: "service_worker"}]
2. connect_to_target("ABC123")
3. execute_in_target("ABC123", "return chrome.runtime.getManifest()")
4. inspect_service_worker_logs("ABC123") → See console.log output
```

**⚠️ CRITICAL**: 
- Use `execute_in_target` for extension contexts, NOT `execute_script`
- `execute_script` only works on page contexts (tabs)
- Extension service workers are separate execution contexts

---

### 3. Network Traffic Interception

```
WORKFLOW FOR INSPECTING REQUESTS:
1️⃣ enable_response_interception - Start capturing responses
   → Or use enable_network_interception for simpler request-only capture
2️⃣ navigate - Trigger the network request
3️⃣ list_intercepted_responses - See what was captured
4️⃣ modify_intercepted_response - Change response if needed (optional)
5️⃣ disable_response_interception - Stop capturing

WORKFLOW FOR MOCKING ENDPOINTS:
1️⃣ create_mock_endpoint - Set up fake API response
   → Pattern: "*api.example.com/users*"
   → Response: {"users": [...]}
2️⃣ navigate - Page will hit mock instead of real API
3️⃣ Test your frontend with fake data
4️⃣ delete_mock_endpoint - Clean up

⚠️ CONFLICTS:
- Cannot use response_interception AND mock_endpoint simultaneously
- Choose one: interception (for analysis) OR mocking (for testing)
```

---

### 4. Form Filling & Submission

```
WORKFLOW:
1️⃣ navigate to form page
2️⃣ wait_for_load_state('networkidle')
3️⃣ get_html → Analyze form structure
4️⃣ Identify input selectors:
   - input#email
   - input[name="password"]
   - button[type="submit"]
5️⃣ type into each field with verified selectors
6️⃣ click submit button with verified selector

EXAMPLE:
1. navigate("https://example.com/login")
2. wait_for_load_state("networkidle")
3. get_html() → See: 
   <input id="email" type="email">
   <input id="password" type="password">
   <button type="submit">Login</button>
4. type("#email", "user@example.com")
5. type("#password", "mypassword")
6. click("button[type='submit']")
```

---

### 5. Data Extraction / Web Scraping

```
WORKFLOW:
1️⃣ navigate to target page
2️⃣ wait_for_load_state('networkidle') - Ensure dynamic content loaded
3️⃣ get_html → Get full page structure
4️⃣ execute_script with complex query:
   return Array.from(document.querySelectorAll('.item'))
     .map(el => ({
       title: el.querySelector('.title').textContent,
       price: el.querySelector('.price').textContent
     }))

WHEN TO USE execute_script:
✅ Complex data extraction (querySelectorAll + map/filter)
✅ Accessing window variables (return window.appConfig)
✅ Triggering custom events
✅ Advanced DOM manipulation

WHEN NOT TO USE execute_script:
❌ Simple clicks (use click tool instead)
❌ Simple typing (use type tool instead)
❌ Getting HTML (use get_html instead)
```

---

### 6. Visual Analysis & Debugging

```
WORKFLOW:
1️⃣ navigate
2️⃣ screenshot - Take visual snapshot
3️⃣ Analyze screenshot visually
4️⃣ Identify elements by their visual position
5️⃣ get_html to find selectors for those elements
6️⃣ Interact with verified selectors

WHEN TO USE SCREENSHOT:
✅ Page layout is complex
✅ Need visual confirmation (before/after actions)
✅ Debugging UI issues
✅ HTML is too large to analyze

WHEN TO USE GET_HTML:
✅ Need exact selectors
✅ Scraping structured data
✅ Analyzing page structure
✅ Finding element attributes/IDs/classes
```

---

### 7. HAR Recording (Performance Analysis)

```
WORKFLOW:
1️⃣ start_har_recording - Begin capturing all network traffic
2️⃣ navigate or perform actions - Trigger network requests
3️⃣ stop_har_recording - Stop capture
4️⃣ get_har_entries - Analyze requests/responses
   → Or export_har_file - Save for external analysis

USE CASES:
- Performance testing (find slow requests)
- Network debugging (see all API calls)
- Security analysis (inspect headers/cookies)
- Regression testing (compare HAR files)
```

---

### 8. CSS/JS Injection (Persistent Modifications)

```
WORKFLOW FOR STYLING:
1️⃣ inject_css_global - Add persistent styles
   → CSS applies to all new pages automatically
2️⃣ navigate to any page
3️⃣ CSS is automatically injected
4️⃣ clear_all_injections - Remove when done

WORKFLOW FOR BEHAVIOR:
1️⃣ inject_js_global - Add persistent JavaScript
   → Runs BEFORE page scripts
   → Can intercept functions
2️⃣ navigate to any page
3️⃣ Your code runs automatically
4️⃣ clear_all_injections - Remove when done

USE CASES:
- UI customization (dark mode, hide elements)
- Function interception (override fetch, console.log)
- Auto-fill forms
- Add custom buttons/features
```

---

## 🚫 Common Mistakes to Avoid

### ❌ Mistake #1: Guessing Selectors
```javascript
// WRONG
navigate("https://example.com")
click(".login-button")  // What if .login-button doesn't exist?
```

```javascript
// RIGHT
navigate("https://example.com")
get_html()  // See: <button id="signin">Login</button>
click("#signin")  // Use verified selector
```

---

### ❌ Mistake #2: Not Waiting for Page Load
```javascript
// WRONG
navigate("https://example.com")
click("#button")  // Button might not exist yet!
```

```javascript
// RIGHT
navigate("https://example.com")
wait_for_load_state("networkidle")  // Wait for page to finish loading
get_html()  // Now analyze
click("#button")  // Now interact
```

---

### ❌ Mistake #3: Using Wrong Tool for Context
```javascript
// WRONG - Trying to debug extension with execute_script
list_all_targets()  // Find extension targetId: "ABC123"
execute_script("chrome.runtime.getManifest()")  // ❌ Won't work!
```

```javascript
// RIGHT - Use execute_in_target for extensions
list_all_targets()  // Find extension: "ABC123"
connect_to_target("ABC123")
execute_in_target("ABC123", "return chrome.runtime.getManifest()")  // ✅ Works!
```

---

### ❌ Mistake #4: Over-using execute_script
```javascript
// WRONG - Using execute_script for simple actions
execute_script("document.querySelector('#button').click()")
```

```javascript
// RIGHT - Use dedicated tools
get_html()  // Verify selector exists
click("#button")  // Simpler, more reliable
```

---

### ❌ Mistake #5: Not Analyzing Before Clicking
```javascript
// WRONG
User: "Click the submit button on example.com"
navigate("https://example.com")
click("button")  // Which button? There might be many!
```

```javascript
// RIGHT
navigate("https://example.com")
get_html()  // Analyze: <button class="submit-btn">Submit</button>
click(".submit-btn")  // Use specific selector
```

---

## 🎓 Decision Trees

### "Should I use screenshot or get_html?"

```
START: Need to analyze page
├─ Need exact selectors/IDs/classes? → get_html
├─ Need visual layout/position? → screenshot
├─ HTML is very large (>50KB)? → screenshot first, then get_html if needed
└─ Need both? → screenshot (visual), then get_html (selectors)
```

### "Should I use execute_script or dedicated tools?"

```
START: Need to interact with page
├─ Simple click? → click tool
├─ Simple type? → type tool
├─ Get HTML? → get_html tool
├─ Complex query (querySelectorAll + map)? → execute_script
├─ Access window variables? → execute_script
└─ Trigger custom events? → execute_script
```

### "Which interception tool should I use?"

```
START: Need to intercept network traffic
├─ Need to ANALYZE real traffic? → enable_response_interception
├─ Need to MOCK/FAKE responses? → create_mock_endpoint
├─ Need WebSocket traffic? → enable_websocket_interception
├─ Need HAR file for analysis? → start_har_recording
└─ Just need simple request logging? → enable_network_interception
```

---

## 🔧 Troubleshooting

### Problem: "Element not found" errors
**Solution**: Always use get_html BEFORE clicking to verify selector exists

### Problem: "Timeout" errors
**Solution**: Use wait_for_load_state("networkidle") after navigation

### Problem: "Cannot read property of undefined" in extension
**Solution**: Verify you're using execute_in_target, not execute_script

### Problem: Mock endpoint not working
**Solution**: Check if response_interception is active (conflicts with mocks)

### Problem: Injection not persisting
**Solution**: Use inject_css_global/inject_js_global, not execute_script

---

## 💡 Pro Tips

1. **Always analyze before acting** - get_html or screenshot first
2. **Use specific selectors** - ID > class > tag name
3. **Wait for page load** - Use wait_for_load_state("networkidle")
4. **Test selectors in browser console** - Before using them in tools
5. **Use timeouts wisely** - Increase for slow pages, decrease for fast ones
6. **Clean up after yourself** - Clear injections, disable interceptors
7. **Read tool descriptions** - They contain workflows and examples
8. **Combine tools logically** - navigate → wait → analyze → interact

---

## 📚 Quick Reference

| Task | Tools | Workflow |
|------|-------|----------|
| Navigate web | navigate → wait_for_load_state → get_html → click/type | Analysis-first approach |
| Debug extension | list_all_targets → connect_to_target → execute_in_target | Extension-specific execution |
| Intercept traffic | enable_response_interception → navigate → list_intercepted_responses | Live traffic capture |
| Mock APIs | create_mock_endpoint → navigate | Testing without backend |
| Scrape data | navigate → wait → get_html → execute_script (complex queries) | Structured extraction |
| Visual debug | navigate → screenshot → analyze → get_html → interact | Visual-first analysis |
| Performance | start_har_recording → actions → stop → get_har_entries | Full network profile |
| Inject styles | inject_css_global → navigate → clear_all_injections | Persistent modifications |

---

**Remember**: The AI should read page structure BEFORE attempting any interaction. Never guess - always verify!
