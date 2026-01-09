/**
 * System-level Chrome Tools
 * For extensions, background workers, etc.
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import CDP from 'chrome-remote-interface';

export function createSystemTools(connector: ChromeConnector) {
  return [
    // List all Chrome targets (including extension service workers)
    {
      name: 'list_all_targets',
      description: '🎯 Lists ALL Chrome execution contexts - pages, extensions, service workers, iframes, web workers. EXTENSION WORKFLOW: 1️⃣ list_all_targets (filter: service_worker) → 2️⃣ find your extension by title/url → 3️⃣ get its targetId → 4️⃣ connect_to_target → 5️⃣ execute_in_target to run code in extension. Use for: discovering extensions, finding SWs to debug, analyzing page structure, monitoring browser processes.',
      inputSchema: z.object({
        filterType: z.enum(['all', 'service_worker', 'background_page', 'page', 'iframe', 'worker']).optional().describe('Filter by target type')
      }),
      handler: async ({ filterType }: any) => {
        await connector.verifyConnection();
        const port = connector.getPort();
        const targets = await CDP.List({ port });
        
        // Apply filter if specified
        const filteredTargets = filterType && filterType !== 'all' 
          ? targets.filter((t: any) => t.type === filterType)
          : targets;
        
        // Categorize targets
        const pages = filteredTargets.filter((t: any) => t.type === 'page');
        const serviceWorkers = filteredTargets.filter((t: any) => t.type === 'service_worker');
        const backgroundPages = filteredTargets.filter((t: any) => t.type === 'background_page');
        const iframes = filteredTargets.filter((t: any) => t.type === 'iframe');
        const workers = filteredTargets.filter((t: any) => t.type === 'worker');
        const others = filteredTargets.filter((t: any) => 
          !['page', 'service_worker', 'background_page', 'iframe', 'worker'].includes(t.type)
        );
        
        // Separate extension service workers from web service workers
        const extensionSWs = serviceWorkers.filter((t: any) => t.url.startsWith('chrome-extension://'));
        const webSWs = serviceWorkers.filter((t: any) => !t.url.startsWith('chrome-extension://'));
        
        return {
          success: true,
          total: filteredTargets.length,
          breakdown: {
            pages: pages.length,
            serviceWorkers: serviceWorkers.length,
            extensionServiceWorkers: extensionSWs.length,
            webServiceWorkers: webSWs.length,
            backgroundPages: backgroundPages.length,
            iframes: iframes.length,
            workers: workers.length,
            others: others.length
          },
          targets: {
            extensionServiceWorkers: extensionSWs.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              extensionId: t.url.match(/chrome-extension:\/\/([^\/]+)/)?.[1] || 'unknown',
              scriptPath: t.url.split('/').pop() || 'unknown',
              description: t.description,
              webSocketDebuggerUrl: t.webSocketDebuggerUrl
            })),
            webServiceWorkers: webSWs.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              description: t.description,
              webSocketDebuggerUrl: t.webSocketDebuggerUrl
            })),
            backgroundPages: backgroundPages.map((t: any) => ({
              id: t.id,
              title: t.title,
              url: t.url,
              extensionId: t.url.match(/chrome-extension:\/\/([^\/]+)/)?.[1],
              type: t.type
            })),
            pages: pages.slice(0, 10).map((t: any) => ({
              id: t.id,
              title: t.title?.substring(0, 80) || 'No title',
              url: t.url?.substring(0, 100) || 'No URL'
            })),
            iframes: iframes.length > 0 ? `${iframes.length} iframes found` : [],
            workers: workers.length > 0 ? `${workers.length} workers found` : [],
            others: others.length > 0 ? `${others.length} other targets found` : []
          },
          message: filterType ? `Filtered by: ${filterType}` : 'Showing all targets'
        };
      }
    },

    // Connect to a specific target (like extension service worker)
    {
      name: 'connect_to_target',
      description: '🔌 Connects to specific Chrome target (extension SW, iframe, etc.). WORKFLOW: 1️⃣ list_all_targets to get targetId → 2️⃣ connect_to_target with that ID → 3️⃣ now you can execute_in_target to run code in that context. CRITICAL: After connecting, use execute_in_target (NOT execute_script) to run code. Use for: extension debugging, iframe inspection, background script access.',
      inputSchema: z.object({
        targetId: z.string().describe('Target ID to connect to')
      }),
      handler: async ({ targetId }: any) => {
        await connector.verifyConnection();
        const port = connector.getPort();
        // Use a finder function to safely identify the target
        const client = await CDP({ 
          port, 
          target: (targets: any[]) => targets.find((t: any) => t.id === targetId)
        });
        
        if (!client) {
             throw new Error(`Failed to connect to target ${targetId}`);
        }

        const { Runtime } = client;
        await Runtime.enable();
        
        // Get some info about the target
        const result = await Runtime.evaluate({
          expression: 'typeof self + " - " + (self.location ? self.location.href : "no location")',
          returnByValue: true
        });
        
        await client.close();
        
        return {
          success: true,
          targetId,
          context: result.result.value,
          message: 'Successfully connected to target'
        };
      }
    },

    // Execute code in a specific target
    {
      name: 'execute_in_target',
      description: 'Execute JavaScript code in a specific target (extension service worker, etc.)',
      inputSchema: z.object({
        targetId: z.string().describe('Target ID'),
        script: z.string().describe('JavaScript code to execute'),
        awaitPromise: z.boolean().default(false).describe('Wait for promise')
      }),
      handler: async ({ targetId, script, awaitPromise }: any) => {
        await connector.verifyConnection();
        const port = connector.getPort();
        // Use a finder function to safely identify the target
        const client = await CDP({ 
          port, 
          target: (targets: any[]) => targets.find((t: any) => t.id === targetId)
        });
        
        if (!client) {
             throw new Error(`Failed to connect to target ${targetId}`);
        }

        const { Runtime } = client;
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: script,
          awaitPromise,
          returnByValue: true
        });
        
        await client.close();
        
        if (result.exceptionDetails) {
          throw new Error(`Script execution failed: ${result.exceptionDetails.text}`);
        }
        
        return {
          success: true,
          result: result.result.value,
          type: result.result.type
        };
      }
    },

    // Get extension service worker details
    {
      name: 'get_extension_service_workers',
      description: 'Get all extension service workers with detailed information and runtime access',
      inputSchema: z.object({
        executeTest: z.boolean().default(false).describe('Execute a test script to verify chrome.runtime access')
      }),
      handler: async ({ executeTest }: any) => {
        await connector.verifyConnection();
        const port = connector.getPort();
        const targets = await CDP.List({ port });
        
        const serviceWorkers = targets.filter((t: any) => 
          t.type === 'service_worker' && t.url.startsWith('chrome-extension://')
        );
        
        if (serviceWorkers.length === 0) {
          return {
            success: true,
            count: 0,
            message: 'No extension service workers found. Make sure Chrome/Edge is opened with extensions enabled.',
            serviceWorkers: []
          };
        }
        
        const details = await Promise.all(
          serviceWorkers.map(async (sw: any) => {
            try {
              // Connect using finder function
              const client = await CDP({ 
                 port, 
                 target: (targets: any[]) => targets.find((t: any) => t.id === sw.id)
              });
              
              if (!client) throw new Error("Could not connect");

              const { Runtime } = client;
              await Runtime.enable();
              
              // Get comprehensive extension info
              const infoScript = `
                JSON.stringify({
                  hasChrome: typeof chrome !== 'undefined',
                  hasRuntime: typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined',
                  extensionId: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null,
                  manifest: typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getManifest() : null,
                  contextType: typeof ServiceWorkerGlobalScope !== 'undefined' ? 'ServiceWorker' : typeof self !== 'undefined' ? 'Worker' : 'Unknown'
                })
              `;
              
              const info = await Runtime.evaluate({
                expression: infoScript,
                returnByValue: true,
                awaitPromise: false
              });
              
              let testResult = null;
              if (executeTest) {
                const test = await Runtime.evaluate({
                  expression: 'typeof chrome !== "undefined" ? "Chrome API Available" : "No Chrome API"',
                  returnByValue: true
                });
                testResult = test.result.value;
              }
              
              await client.close();
              
              const extInfo = JSON.parse(info.result.value || '{}');
              const extensionId = sw.url.match(/chrome-extension:\/\/([^\/]+)/)?.[1];
              
              return {
                id: sw.id,
                title: sw.title,
                url: sw.url,
                extensionId: extensionId,
                scriptFile: sw.url.split('/').pop(),
                description: sw.description,
                webSocketDebuggerUrl: sw.webSocketDebuggerUrl,
                runtimeInfo: {
                  hasChrome: extInfo.hasChrome,
                  hasRuntime: extInfo.hasRuntime,
                  contextType: extInfo.contextType,
                  manifestName: extInfo.manifest?.name,
                  manifestVersion: extInfo.manifest?.version,
                  permissions: extInfo.manifest?.permissions?.slice(0, 5)
                },
                testResult: executeTest ? testResult : undefined
              };
            } catch (error) {
              return {
                id: sw.id,
                title: sw.title,
                url: sw.url,
                extensionId: sw.url.match(/chrome-extension:\/\/([^\/]+)/)?.[1],
                error: (error as Error).message
              };
            }
          })
        );
        
        return {
          success: true,
          count: details.length,
          serviceWorkers: details,
          summary: {
            total: details.length,
            successful: details.filter(d => !d.error).length,
            failed: details.filter(d => d.error).length
          }
        };
      }
    }
  ];
}
