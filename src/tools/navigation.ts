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
      description: 'Navigate to a URL in the current or specified tab',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        tabId: z.string().optional().describe('Tab ID (optional, uses current tab if not specified)'),
        waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().default('load')
          .describe('Wait until this event fires'),
        timeout: z.number().optional().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ url, tabId, waitUntil, timeout = 30000 }: any) => {
        if (!isValidUrl(url)) {
          throw new Error(`Invalid URL: ${url}`);
        }

        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        await Page.navigate({ url });
        
        // Wait for the specified event
        const waitPromise = (async () => {
             if (waitUntil === 'load') {
               await Page.loadEventFired();
             } else if (waitUntil === 'domcontentloaded') {
               await Page.domContentEventFired();
             }
        })();
        
        await withTimeout(waitPromise, timeout, `Navigation to ${url} timed out`);
        
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
      description: 'Navigate back in browser history',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
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
        ignoreCache: z.boolean().optional().default(false).describe('Ignore cache when reloading')
      }),
      handler: async ({ tabId, ignoreCache }: any) => {
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
      description: 'Create a new tab',
      inputSchema: z.object({
        url: z.string().optional().describe('URL to open in new tab (optional)')
      }),
      handler: async ({ url }: any) => {
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
