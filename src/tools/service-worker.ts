/**
 * Service Worker Management Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import type { ServiceWorkerInfo } from '../types/index.js';

export function createServiceWorkerTools(connector: ChromeConnector) {
  return [
    // List all service workers
    {
      name: 'list_service_workers',
      description: 'Lists all registered Service Workers on the page - shows scripts running in background for PWAs (Progressive Web Apps), offline caching, push notifications, background sync. Use for debugging PWAs, inspecting offline capabilities, monitoring background processes, or analyzing web app architecture.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        // Use JavaScript to query service workers
        const result = await Runtime.evaluate({
          expression: `
            (async () => {
              const registrations = await navigator.serviceWorker.getRegistrations();
              return registrations.map(reg => ({
                scope: reg.scope,
                scriptURL: reg.active ? reg.active.scriptURL : null,
                state: reg.active ? reg.active.state : 'none',
                installing: reg.installing ? reg.installing.scriptURL : null,
                waiting: reg.waiting ? reg.waiting.scriptURL : null
              }));
            })()
          `,
          awaitPromise: true,
          returnByValue: true
        });
        
        const workers = result.result.value || [];
        
        return {
          success: true,
          count: workers.length,
          workers
        };
      }
    },

    // Inspect service worker console logs
    {
      name: 'inspect_service_worker_logs',
      description: 'Captures console logs from a Service Worker in real-time - shows background debugging messages, sync events, cache operations, push notifications. Use for debugging PWA background behavior, monitoring offline sync, troubleshooting service worker issues, or understanding background processes.',
      inputSchema: z.object({
        targetId: z.string().describe('The Target ID of the service worker (from list_tabs)'),
        executeTestLogs: z.boolean().default(true).describe('Whether to execute test console.log statements to verify capture (default: true)'),
        captureTimeMs: z.number().default(3000).describe('How long to listen for logs in milliseconds (default: 3000)')
      }),
      handler: async ({ targetId, executeTestLogs = true, captureTimeMs = 3000 }: any) => {
        await connector.verifyConnection();
        // Connect directly to the specific target
        const client = await connector.getTabClient(targetId);
        const { Runtime, Log } = client;
        
        await Runtime.enable();
        await Log.enable();
        
        // Collect logs from BOTH Runtime and Log domains for better coverage
        const logs: Array<{time: string, source: string, type: string, message: string}> = [];
        
        // Listen to Runtime.consoleAPICalled (for console.log/warn/error)
        client.on('Runtime.consoleAPICalled', (params: any) => {
             try {
                 const message = params.args.map((a:any) => {
                     if (a.value !== undefined) return String(a.value);
                     if (a.description) return a.description;
                     if (a.preview?.properties) {
                         return JSON.stringify(Object.fromEntries(
                             a.preview.properties.map((p:any) => [p.name, p.value])
                         ));
                     }
                     return '[Complex Object]';
                 }).join(' ');
                 
                 logs.push({
                     time: new Date().toISOString(),
                     source: 'Runtime.consoleAPICalled',
                     type: params.type || 'log',
                     message
                 });
             } catch (e) {
                 logs.push({
                     time: new Date().toISOString(),
                     source: 'Runtime.consoleAPICalled',
                     type: 'error',
                     message: `Failed to parse console args: ${e}`
                 });
             }
        });
        
        // Listen to Log.entryAdded (alternative logging mechanism)
        client.on('Log.entryAdded', (params: any) => {
             logs.push({
                 time: new Date(params.entry.timestamp).toISOString(),
                 source: 'Log.entryAdded',
                 type: params.entry.level || 'info',
                 message: params.entry.text || params.entry.url || 'Unknown log'
             });
        });

        // Get initial status
        const evalResult = await Runtime.evaluate({
            expression: `(function() {
                return {
                    userAgent: navigator.userAgent,
                    time: new Date().toISOString(),
                    location: self.location.href,
                    serviceWorker: {
                        state: self.serviceWorker ? self.serviceWorker.state : 'unknown'
                    }
                };
            })()`,
            returnByValue: true
        });

        // Execute test logs if requested (AFTER listeners are set up)
        if (executeTestLogs) {
            await Runtime.evaluate({
                expression: `
                    console.log('🔍 [MCP Test 1] Service Worker Log Capture Test');
                    console.warn('⚠️ [MCP Test 2] Warning level test');
                    console.error('❌ [MCP Test 3] Error level test');
                    console.log('✅ [MCP Test 4] Capture timestamp:', new Date().toISOString());
                `,
                awaitPromise: false
            });
        }

        // Wait to capture logs
        await new Promise(r => setTimeout(r, captureTimeMs));
        
        return {
          success: true,
          targetId,
          status: evalResult.result.value,
          capturedLogs: logs.length > 0 ? logs : [],
          summary: {
              totalCaptured: logs.length,
              byType: logs.reduce((acc: any, log) => {
                  acc[log.type] = (acc[log.type] || 0) + 1;
                  return acc;
              }, {}),
              bySource: logs.reduce((acc: any, log) => {
                  acc[log.source] = (acc[log.source] || 0) + 1;
                  return acc;
              }, {})
          },
          note: logs.length === 0 ? 
              "No logs captured. Service Worker extensions may have limited console.log emission via CDP. Try using Log.entryAdded or check Chrome DevTools directly." :
              `Successfully captured ${logs.length} log entries. REMINDER: This targetId (${targetId}) is for the Service Worker. To click elements or execute DOM scripts, use the main PAGE/TAB ID from list_tabs, NOT this ID.`
        };
      }
    },
    
    // Get service worker details
    {
      name: 'get_service_worker',
      description: 'Get detailed information about a specific service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Service worker version ID'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        
        const { registrations } = await ServiceWorker.getRegistrations();
        const worker = registrations.find((r: any) => r.versionId === versionId);
        
        if (!worker) {
          throw new Error(`Service worker not found: ${versionId}`);
        }
        
        return {
          success: true,
          worker: {
            registrationId: worker.registrationId,
            scopeURL: worker.scopeURL,
            scriptURL: worker.scriptURL,
            status: worker.status,
            versionId: worker.versionId,
            runningStatus: worker.runningStatus
          }
        };
      }
    },

    // Unregister service worker
    {
      name: 'unregister_service_worker',
      description: 'Unregister a service worker by scope URL',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to unregister'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: `
            (async () => {
              const registrations = await navigator.serviceWorker.getRegistrations();
              const reg = registrations.find(r => r.scope === '${scopeURL}');
              if (reg) {
                const unregistered = await reg.unregister();
                return { success: unregistered };
              }
              return { success: false, error: 'Not found' };
            })()
          `,
          awaitPromise: true,
          returnByValue: true
        });
        
        return {
          success: result.result.value.success,
          message: `Service worker unregister ${result.result.value.success ? 'successful' : 'failed'}: ${scopeURL}`
        };
      }
    },

    // Update service worker
    {
      name: 'update_service_worker',
      description: 'Force update a service worker registration',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to update'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: `
            (async () => {
              const registrations = await navigator.serviceWorker.getRegistrations();
              const reg = registrations.find(r => r.scope === '${scopeURL}');
              if (reg) {
                await reg.update();
                return { success: true };
              }
              return { success: false, error: 'Not found' };
            })()
          `,
          awaitPromise: true,
          returnByValue: true
        });
        
        return {
          success: result.result.value.success,
          message: `Service worker update triggered: ${scopeURL}`
        };
      }
    },

    // Start service worker
    {
      name: 'start_service_worker',
      description: 'Start a service worker',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker to start'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.startWorker({ scopeURL });
        
        return {
          success: true,
          message: `Service worker started: ${scopeURL}`
        };
      }
    },

    // Stop service worker
    {
      name: 'stop_service_worker',
      description: 'Stop a running service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to stop'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.stopWorker({ versionId });
        
        return {
          success: true,
          message: `Service worker stopped: ${versionId}`
        };
      }
    },

    // Inspect service worker
    {
      name: 'inspect_service_worker',
      description: 'Open DevTools for a service worker',
      inputSchema: z.object({
        versionId: z.string().describe('Version ID of the service worker to inspect'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ versionId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.inspectWorker({ versionId });
        
        return {
          success: true,
          message: `DevTools opened for service worker: ${versionId}`
        };
      }
    },

    // Skip waiting
    {
      name: 'skip_waiting',
      description: 'Skip waiting phase for a service worker',
      inputSchema: z.object({
        scopeURL: z.string().describe('Scope URL of the service worker'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ scopeURL, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { ServiceWorker } = client;
        
        await ServiceWorker.enable();
        await ServiceWorker.skipWaiting({ scopeURL });
        
        return {
          success: true,
          message: `Skip waiting triggered for: ${scopeURL}`
        };
      }
    },

    // Get service worker cache names
    {
      name: 'get_sw_caches',
      description: 'Get cache names used by service workers',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { CacheStorage } = client;
        
        const { caches } = await CacheStorage.requestCacheNames({
          securityOrigin: await getCurrentOrigin(client)
        });
        
        return {
          success: true,
          count: caches.length,
          caches: caches.map((c: any) => ({
            securityOrigin: c.securityOrigin,
            cacheName: c.cacheName,
            cacheId: c.cacheId
          }))
        };
      }
    }
  ];
}

// Helper function to get current origin
async function getCurrentOrigin(client: any): Promise<string> {
  const { Runtime } = client;
  await Runtime.enable();
  
  const result = await Runtime.evaluate({
    expression: 'window.location.origin'
  });
  
  return result.result.value;
}
