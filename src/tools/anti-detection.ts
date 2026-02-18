/**
 * Anti-Detection Tools
 * Helps evade bot detection mechanisms
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createAntiDetectionTools(connector: ChromeConnector) {
  return [
    // Apply stealth mode
    {
      name: 'enable_stealth_mode',
      description: 'Hide automation flags (webdriver, plugins) to bypass bot detection. Call before navigating to protected sites.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime, Page } = client;
        
        await Runtime.enable();
        await Page.enable();
        
        // Inject anti-detection scripts
        const stealthScript = `
          // Override navigator.webdriver
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
          });
          
          // Override plugins
          Object.defineProperty(navigator, 'plugins', {
            get: () => [
              {
                0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
                description: "Portable Document Format",
                filename: "internal-pdf-viewer",
                length: 1,
                name: "Chrome PDF Plugin"
              },
              {
                0: { type: "application/pdf", suffixes: "pdf", description: "Portable Document Format" },
                description: "Portable Document Format",
                filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
                length: 1,
                name: "Chrome PDF Viewer"
              },
              {
                0: { type: "application/x-nacl", suffixes: "", description: "Native Client Executable" },
                1: { type: "application/x-pnacl", suffixes: "", description: "Portable Native Client Executable" },
                description: "",
                filename: "internal-nacl-plugin",
                length: 2,
                name: "Native Client"
              }
            ]
          });
          
          // Override permissions
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          );
          
          // Override chrome runtime
          if (!window.chrome) {
            window.chrome = {};
          }
          
          if (!window.chrome.runtime) {
            window.chrome.runtime = {};
          }
          
          // Add realistic properties
          Object.defineProperty(navigator, 'languages', {
            get: () => ['en-US', 'en']
          });
          
          Object.defineProperty(navigator, 'platform', {
            get: () => 'Win32'
          });
          
          // Override toString methods
          const originalToString = Function.prototype.toString;
          Function.prototype.toString = function() {
            if (this === window.navigator.permissions.query) {
              return 'function query() { [native code] }';
            }
            return originalToString.call(this);
          };
          
          // Add realistic screen properties
          Object.defineProperty(screen, 'availWidth', {
            get: () => window.screen.width
          });
          
          Object.defineProperty(screen, 'availHeight', {
            get: () => window.screen.height - 40
          });
          
          // Spoof timezone
          Date.prototype.getTimezoneOffset = function() {
            return 300; // EST timezone
          };
          
          console.log('✅ Stealth mode enabled');
        `;
        
        await Page.addScriptToEvaluateOnNewDocument({
          source: stealthScript
        });
        
        // Also apply to current page
        await Runtime.evaluate({
          expression: stealthScript
        });
        
        return {
          success: true,
          message: 'Stealth mode enabled - navigator.webdriver hidden, plugins spoofed, and other anti-detection measures applied'
        };
      }
    },

    // Randomize user agent
    {
      name: 'set_user_agent',
      description: 'Change the browser user agent string to impersonate different browsers or devices.',
      inputSchema: z.object({
        userAgent: z.string().optional().describe('Custom user agent (optional, uses realistic default if not provided)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ userAgent, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network } = client;
        
        await Network.enable();
        
        const ua = userAgent || 
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        
        await Network.setUserAgentOverride({
          userAgent: ua,
          acceptLanguage: 'en-US,en;q=0.9',
          platform: 'Win32'
        });
        
        return {
          success: true,
          userAgent: ua,
          message: 'User agent updated'
        };
      }
    },

    // Set viewport
    {
      name: 'set_viewport',
      description: 'Set viewport dimensions and device emulation (width, height, mobile, deviceScaleFactor).',
      inputSchema: z.object({
        width: z.number().describe('Viewport width'),
        height: z.number().describe('Viewport height'),
        deviceScaleFactor: z.number().default(1).describe('Device scale factor'),
        mobile: z.boolean().default(false).describe('Emulate mobile device'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ width, height, deviceScaleFactor, mobile, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Emulation } = client;
        
        await Emulation.setDeviceMetricsOverride({
          width,
          height,
          deviceScaleFactor,
          mobile
        });
        
        return {
          success: true,
          viewport: { width, height, deviceScaleFactor, mobile },
          message: `Viewport set to ${width}x${height}`
        };
      }
    },

    // Emulate geolocation
    {
      name: 'set_geolocation',
      description: 'Override GPS location with custom latitude/longitude coordinates.',
      inputSchema: z.object({
        latitude: z.number().describe('Latitude'),
        longitude: z.number().describe('Longitude'),
        accuracy: z.number().default(100).describe('Accuracy in meters'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ latitude, longitude, accuracy, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Emulation } = client;
        
        await Emulation.setGeolocationOverride({
          latitude,
          longitude,
          accuracy
        });
        
        return {
          success: true,
          location: { latitude, longitude, accuracy },
          message: `Geolocation set to ${latitude}, ${longitude}`
        };
      }
    },

    // Set timezone
    {
      name: 'set_timezone',
      description: 'Override browser timezone using IANA timezone ID (e.g., America/New_York, Europe/London).',
      inputSchema: z.object({
        timezoneId: z.string().describe('Timezone ID (e.g., "America/New_York")'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ timezoneId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Emulation } = client;
        
        await Emulation.setTimezoneOverride({
          timezoneId
        });
        
        return {
          success: true,
          timezone: timezoneId,
          message: `Timezone set to ${timezoneId}`
        };
      }
    }
  ];
}
