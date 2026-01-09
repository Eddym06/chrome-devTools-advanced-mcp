/**
 * Cookie and Session Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import type { SessionData } from '../types/index.js';

export function createSessionTools(connector: ChromeConnector) {
  return [
    // Get cookies
    {
      name: 'get_cookies',
      description: 'Retrieves all cookies from current page or domain - shows authentication tokens, session data, tracking cookies, preferences. Use for analyzing user sessions, debugging login issues, extracting auth tokens, monitoring tracking, testing cookie behavior, or transferring sessions between browsers.',
      inputSchema: z.object({
        url: z.string().optional().describe('URL to get cookies for (optional, uses current page if not specified)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        const params: any = {};
        if (url) params.urls = [url];
        
        const { cookies } = await Network.getCookies(params);
        
        return {
          success: true,
          count: cookies.length,
          cookies: cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite
          }))
        };
      }
    },

    // Set cookie
    {
      name: 'set_cookie',
      description: 'Creates or modifies cookies for any domain - inject session tokens, set authentication cookies, configure preferences, simulate logged-in state. Use for bypassing login, testing authenticated features, transferring sessions, setting up test environments, or manipulating user state.',
      inputSchema: z.object({
        name: z.string().describe('Cookie name'),
        value: z.string().describe('Cookie value'),
        domain: z.string().optional().describe('Cookie domain'),
        path: z.string().default('/').describe('Cookie path'),
        secure: z.boolean().default(false).describe('Secure flag'),
        httpOnly: z.boolean().default(false).describe('HttpOnly flag'),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
        expires: z.number().optional().describe('Expiration timestamp'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ name, value, domain, path, secure, httpOnly, sameSite, expires, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        // Get current domain if not specified
        if (!domain) {
          const { Runtime } = client;
          await Runtime.enable();
          const result = await Runtime.evaluate({
            expression: 'window.location.hostname'
          });
          domain = result.result.value;
        }
        
        const cookie: any = {
          name,
          value,
          domain,
          path,
          secure,
          httpOnly
        };
        
        if (sameSite) cookie.sameSite = sameSite;
        if (expires) cookie.expires = expires;
        
        const { success } = await Network.setCookie(cookie);
        
        if (!success) {
          throw new Error('Failed to set cookie');
        }
        
        return {
          success: true,
          cookie: { name, value, domain },
          message: `Cookie "${name}" set successfully`
        };
      }
    },

    // Delete cookie
    {
      name: 'delete_cookie',
      description: 'Delete a specific cookie',
      inputSchema: z.object({
        name: z.string().describe('Cookie name to delete'),
        domain: z.string().optional().describe('Cookie domain (optional, uses current domain if not specified)'),
        path: z.string().default('/').describe('Cookie path'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ name, domain, path, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        // Get current domain if not specified
        if (!domain) {
          const { Runtime } = client;
          await Runtime.enable();
          const result = await Runtime.evaluate({
            expression: 'window.location.hostname'
          });
          domain = result.result.value;
        }
        
        await Network.deleteCookies({ name, domain, path });
        
        return {
          success: true,
          message: `Cookie "${name}" deleted`
        };
      }
    },

    // Clear all cookies
    {
      name: 'clear_cookies',
      description: 'Clear all cookies for the current domain or all domains',
      inputSchema: z.object({
        allDomains: z.boolean().default(false).describe('Clear cookies for all domains'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ allDomains, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        if (allDomains) {
          await Network.clearBrowserCookies();
          return {
            success: true,
            message: 'All cookies cleared from all domains'
          };
        } else {
          // Clear only current domain cookies
          const { cookies } = await Network.getCookies();
          
          for (const cookie of cookies) {
            await Network.deleteCookies({
              name: cookie.name,
              domain: cookie.domain,
              path: cookie.path
            });
          }
          
          return {
            success: true,
            count: cookies.length,
            message: `Cleared ${cookies.length} cookies from current domain`
          };
        }
      }
    },

    // Get localStorage
    {
      name: 'get_local_storage',
      description: 'Get all localStorage items',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, localStorage))',
          returnByValue: true
        });
        
        const storage = JSON.parse(result.result.value || '{}');
        
        return {
          success: true,
          count: Object.keys(storage).length,
          storage
        };
      }
    },

    // Set localStorage item
    {
      name: 'set_local_storage',
      description: 'Set a localStorage item',
      inputSchema: z.object({
        key: z.string().describe('Storage key'),
        value: z.string().describe('Storage value'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ key, value, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        await Runtime.evaluate({
          expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
        });
        
        return {
          success: true,
          message: `localStorage item "${key}" set successfully`
        };
      }
    },

    // Clear localStorage
    {
      name: 'clear_local_storage',
      description: 'Clear all localStorage items',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        await Runtime.evaluate({
          expression: 'localStorage.clear()'
        });
        
        return {
          success: true,
          message: 'localStorage cleared'
        };
      }
    },

    // Export session
    {
      name: 'export_session',
      description: 'Export current session (cookies, localStorage, sessionStorage)',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Runtime } = client;
        
        await Network.enable();
        await Runtime.enable();
        
        // Get cookies
        const { cookies } = await Network.getCookies();
        
        // Get localStorage
        const localStorageResult = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, localStorage))',
          returnByValue: true
        });
        
        // Get sessionStorage
        const sessionStorageResult = await Runtime.evaluate({
          expression: 'JSON.stringify(Object.assign({}, sessionStorage))',
          returnByValue: true
        });
        
        const sessionData: SessionData = {
          cookies: cookies.map((c: any) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite as any
          })),
          localStorage: JSON.parse(localStorageResult.result.value || '{}'),
          sessionStorage: JSON.parse(sessionStorageResult.result.value || '{}'),
          timestamp: Date.now()
        };
        
        return {
          success: true,
          session: sessionData,
          message: 'Session exported successfully'
        };
      }
    },

    // Import session
    {
      name: 'import_session',
      description: 'Import a previously exported session',
      inputSchema: z.object({
        sessionData: z.string().describe('Session data as JSON string'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ sessionData, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Runtime } = client;
        
        await Network.enable();
        await Runtime.enable();
        
        const session: SessionData = JSON.parse(sessionData);
        
        // Import cookies
        for (const cookie of session.cookies) {
          await Network.setCookie(cookie as any);
        }
        
        // Import localStorage
        for (const [key, value] of Object.entries(session.localStorage)) {
          await Runtime.evaluate({
            expression: `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
          });
        }
        
        // Import sessionStorage
        for (const [key, value] of Object.entries(session.sessionStorage)) {
          await Runtime.evaluate({
            expression: `sessionStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`
          });
        }
        
        return {
          success: true,
          imported: {
            cookies: session.cookies.length,
            localStorage: Object.keys(session.localStorage).length,
            sessionStorage: Object.keys(session.sessionStorage).length
          },
          message: 'Session imported successfully'
        };
      }
    }
  ];
}
