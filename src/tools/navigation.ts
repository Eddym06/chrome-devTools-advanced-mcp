/**
 * Navigation and Tab Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { isValidUrl, humanDelay, withTimeout } from '../utils/helpers.js';

export function createNavigationTools(connector: ChromeConnector) {
  return [
    // Navigate to URL
    {
      name: 'navigate',
      description: '🌐 PRIMARY NAVIGATION TOOL - Opens/loads/visits any URL. ✅ USE THIS for: "go to", "open", "navigate to", "visit", "load page", "browse to" any website. Navigates in CURRENT tab (doesn\'t create new tab). Examples: "go to apple.com", "navigate to google.com", "visit youtube.com". 📋 WORKFLOW: 1️⃣ navigate → 2️⃣ wait_for_load_state(networkidle) → 3️⃣ get_html (analyze) → 4️⃣ interact. ❌ DO NOT use create_tab for simple navigation!',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        tabId: z.string().optional().describe('Tab ID (optional, uses current tab if not specified)'),
        waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load')
          .describe('Wait until this event fires'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ url, tabId, waitUntil, timeout = 30000 }: any) => {
        console.error(`[Navigation] Starting navigation to ${url} (tab: ${tabId || 'active'})`);
        
        // VERIFY CONNECTION FIRST
        await connector.verifyConnection();
        
        if (!isValidUrl(url)) {
          console.error(`[Navigation] Invalid URL rejected: ${url}`);
          throw new Error(`Invalid URL: ${url}`);
        }

        console.error(`[Navigation] Connecting to tab...`);
        const client = await connector.getTabClient(tabId);
        console.error(`[Navigation] Connected to tab. Enabling Page domain...`);
        const { Page } = client;
        
        await Page.enable();

        console.error(`[Navigation] Setting up event listener for ${waitUntil}...`);
        
        // Set up the event listener BEFORE navigating
        let eventPromise;
        if (waitUntil === 'load') {
          eventPromise = Page.loadEventFired();
        } else if (waitUntil === 'domcontentloaded') {
          eventPromise = Page.domContentEventFired();
        } else {
          // For networkidle, just wait a bit
          eventPromise = new Promise(r => setTimeout(r, 1000));
        }

        console.error(`[Navigation] Page domain enabled. Sending navigate command...`);
        const navResponse = await Page.navigate({ url });
        console.error(`[Navigation] Navigate response:`, navResponse);
        
        console.error(`[Navigation] Waiting for ${waitUntil} event...`);
        await withTimeout(eventPromise, timeout, `Navigation to ${url} timed out`);
        
        console.error(`[Navigation] Event received successfully!`);
        
        await humanDelay();
        
        return {
          success: true,
          url,
          message: `Navigated to ${url}`
        };
      }
    },

    // Go back
    {
      name: 'go_back',
      description: 'Go back in browser history - same as pressing the back button. Use when user says "go back", "navigate back", "return to previous page", "press back button".',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const history = await Page.getNavigationHistory();
        if (history.currentIndex > 0) {
          const entry = history.entries[history.currentIndex - 1];
          await Page.navigateToHistoryEntry({ entryId: entry.id });
          await humanDelay();
          return { success: true, message: 'Navigated back' };
        }
        
        return { success: false, message: 'No history to go back' };
      }
    },

    // Go forward
    {
      name: 'go_forward',
      description: 'Navigate forward in browser history',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const history = await Page.getNavigationHistory();
        if (history.currentIndex < history.entries.length - 1) {
          const entry = history.entries[history.currentIndex + 1];
          await Page.navigateToHistoryEntry({ entryId: entry.id });
          await humanDelay();
          return { success: true, message: 'Navigated forward' };
        }
        
        return { success: false, message: 'No history to go forward' };
      }
    },

    // Reload page
    {
      name: 'reload',
      description: 'Reload the current page',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
        ignoreCache: z.boolean().default(false).describe('Ignore cache when reloading')
      }),
      handler: async ({ tabId, ignoreCache }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        await Page.reload({ ignoreCache });
        await Page.loadEventFired();
        await humanDelay();
        
        return {
          success: true,
          message: `Page reloaded${ignoreCache ? ' (cache ignored)' : ''}`
        };
      }
    },

    // Wait for load state
    {
      name: 'wait_for_load_state',
      description: '⏳ Waits for page to reach a specific state (load, networkidle, domcontentloaded). USE THIS WHEN: 1️⃣ After clicking a link/button that loads a new page. 2️⃣ After navigation to ensure page is ready. 3️⃣ When "get_html" returns incomplete content. STATES: "load" (default, page fully loaded), "domcontentloaded" (HTML ready), "networkidle" (no network activity for 500ms - useful for SPAs).',
      inputSchema: z.object({
        state: z.enum(['load', 'domcontentloaded', 'networkidle']).default('load').describe('State to wait for'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ state = 'load', timeout = 30000, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page, Network } = client;
        
        await Page.enable();

        if (state === 'networkidle') {
           await Network.enable();
             // Primitive network idle implementation for CDP
            await new Promise<void>((resolve, reject) => {
                let pendingRequests = 0;
                let lastRequestTime = Date.now();
                let checkInterval: NodeJS.Timeout;
                let timeoutId: NodeJS.Timeout;

                const cleanup = () => {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                };

                timeoutId = setTimeout(() => {
                    cleanup();
                    // Don't fail hard on network idle, just resolve with warning
                    console.error('[wait_for_load_state] networkidle timeout, proceeding anyway');
                    resolve();
                }, timeout);

                Network.requestWillBeSent(() => {
                    pendingRequests++;
                    lastRequestTime = Date.now();
                });

                const onRequestDone = () => {
                    if (pendingRequests > 0) pendingRequests--;
                    lastRequestTime = Date.now();
                };

                Network.loadingFinished(onRequestDone);
                Network.loadingFailed(onRequestDone);

                checkInterval = setInterval(() => {
                    // Wait for 0 pending requests and 500ms of silence
                    if (pendingRequests === 0 && (Date.now() - lastRequestTime) > 500) {
                        cleanup();
                        resolve();
                    }
                }, 100);
            });
        } else if (state === 'domcontentloaded') {
           await withTimeout(Page.domContentEventFired(), timeout, 'Wait for domcontentloaded timed out');
        } else {
           // 'load' state
           await withTimeout(Page.loadEventFired(), timeout, 'Wait for load timed out');
        }
        
        return {
          success: true,
          message: `Waited for state: ${state}`
        };
      }
    },

    // List tabs
    {
      name: 'list_tabs',
      description: '📋 Lists all open browser tabs. USE THIS WHEN: 1️⃣ Need to switch between tabs (get tab IDs). 2️⃣ Multiple tabs open, need to find specific one by title/URL. 3️⃣ Verifying tab was created. 4️⃣ Managing multiple pages simultaneously. 5️⃣ Debugging: "which tab am I in?". Returns: tab IDs, titles, URLs. Use returned ID with tabId parameter in other tools.',
      inputSchema: z.object({}),
      handler: async () => {
        await connector.verifyConnection();
        const tabs = await connector.listTabs();
        return {
          success: true,
          count: tabs.length,
          tabs: tabs.map(t => ({
            id: t.id,
            title: t.title,
            url: t.url
          }))
        };
      }
    },

    // Create new tab
    {
      name: 'create_tab',
      description: '➕ Creates NEW/ADDITIONAL browser tab. USE THIS ONLY when user explicitly wants MULTIPLE tabs or says "open in new tab", "create another tab", "new window". ❌ DO NOT USE for simple navigation! For "go to URL" or "navigate to", use navigate tool instead. create_tab is for managing multiple tabs simultaneously.',
      inputSchema: z.object({
        url: z.string().optional().describe('URL to open in new tab (optional)')
      }),
      handler: async ({ url }: any) => {
        await connector.verifyConnection();
        const newTab = await connector.createTab(url);
        await humanDelay();
        
        return {
          success: true,
          tab: {
            id: newTab.id,
            url: newTab.url,
            title: newTab.title
          },
          message: `Created new tab${url ? ` with URL: ${url}` : ''}`
        };
      }
    },

    // Close tab
    {
      name: 'close_tab',
      description: '❌ Closes specific tab by ID. USE THIS WHEN: Cleaning up after multi-tab workflow, closing popups/ads, managing tab overflow. PREREQUISITE: list_tabs to get tab ID. CAUTION: Cannot close if it\'s the only tab.',
      inputSchema: z.object({
        tabId: z.string().describe('Tab ID to close')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        await connector.closeTab(tabId);
        await humanDelay();
        
        return {
          success: true,
          message: `Closed tab ${tabId}`
        };
      }
    },

    // Activate/switch to tab
    {
      name: 'switch_tab',
      description: '🔄 Switches focus to specific tab. USE THIS WHEN: Working with multiple tabs, need to interact with different page. WORKFLOW: list_tabs → get target tab ID → switch_tab → interact with that tab.',
      inputSchema: z.object({
        tabId: z.string().describe('Tab ID to switch to')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        await connector.activateTab(tabId);
        await humanDelay();
        
        return {
          success: true,
          message: `Switched to tab ${tabId}`
        };
      }
    },

    // Get current URL
    {
      name: 'get_url',
      description: '🔗 Gets current page URL. USE THIS WHEN: 1️⃣ Verifying navigation worked (check URL changed). 2️⃣ Checking if redirect happened. 3️⃣ Confirming on correct page before interaction. 4️⃣ Extracting URL parameters (parse returned URL). 5️⃣ Debugging: "where am I?". Returns: Full URL including protocol, domain, path, query params.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        const { frameTree } = await Page.getFrameTree();
        
        return {
          success: true,
          url: frameTree.frame.url,
          title: frameTree.frame.name || 'Untitled'
        };
      }
    }
  ];
}
