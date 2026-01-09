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
      description: 'Opens and navigates to any URL/website in browser (apple.com, google.com, etc.). USE THIS WHEN: user says "go to", "open", "navigate to", "visit", "load page", "browse to" any website. Handles http://, https://, or plain domain names. 📋 PROPER WORKFLOW: 1️⃣ navigate to URL → 2️⃣ wait_for_load_state (networkidle) → 3️⃣ get_html or screenshot to analyze page → 4️⃣ THEN interact.',
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

    // List tabs
    {
      name: 'list_tabs',
      description: 'List all open tabs',
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
      description: 'Opens a new browser tab/page, optionally with specified URL. USE THIS WHEN: user wants new tab, open in new window, create new page, or open multiple pages simultaneously.',
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
      description: 'Close a tab by ID',
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
      description: 'Switch to a specific tab',
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
      description: 'Get the current URL of the page',
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
