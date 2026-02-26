# Changelog

All notable changes to this project will be documented in this file.

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
