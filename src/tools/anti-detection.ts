/**
 * Anti-Detection Tools
 * Helps evade bot detection mechanisms
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createAntiDetectionTools(connector: ChromeConnector) {
  return [
    // Apply / re-apply stealth mode
    {
      name: 'enable_stealth_mode',
      description: 'Re-apply stealth patches to a specific tab (webdriver flag, canvas/WebGL/audio fingerprinting, plugins). Stealth is already active automatically on launch; use this only to target a different tab or to force re-injection.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        // force=true so it always re-applies even if already done on this session
        await connector.applyStealthMode(tabId, true);
        return {
          success: true,
          message: 'Stealth mode applied: webdriver hidden, canvas/WebGL/audio fingerprints randomised, realistic plugins/navigator set.'
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
