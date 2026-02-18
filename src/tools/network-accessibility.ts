/**
 * Network Interception and Accessibility Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { withTimeout } from '../utils/helpers.js';

// Store for intercepted requests (per tab)
const interceptedRequests = new Map<string, Map<string, any>>();
// Store history of processed requests (per tab) for logging/inspection
const requestHistory = new Map<string, any[]>();
// Store interception state (per tab)
const interceptionState = new Map<string, { autoContinue: boolean; pauseMode: string; pausedCount: number }>();


export function createNetworkAccessibilityTools(connector: ChromeConnector) {
  return [
    // Show captured requests - RENAMED for clarity
    {
      name: 'show_captured_network_traffic',
      description: 'List all captured network requests with URLs, methods, headers, and requestIds.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        
        const activeRequests = interceptedRequests.get(effectiveTabId);
        const history = requestHistory.get(effectiveTabId) || [];
        
        if ((!activeRequests || activeRequests.size === 0) && history.length === 0) {
          return {
            success: true,
            interceptedRequests: [],
            count: 0,
            message: 'No requests currently intercepted or in history. Use enable_network_interception first.'
          };
        }
        
        // Format active requests
        const activeList = activeRequests ? Array.from(activeRequests.values()).map((req: any) => ({
          requestId: req.requestId,
          url: req.request.url,
          method: req.request.method,
          resourceType: req.resourceType,
          headers: req.request.headers,
          status: 'paused (waiting for action)'
        })) : [];

        // Format history requests
        const historyList = history.map((req: any) => ({
          requestId: req.requestId,
          url: req.request.url,
          method: req.request.method,
          resourceType: req.resourceType,
          headers: req.request.headers,
          status: req.status || 'processed',
          timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined
        }));

        const allRequests = [...activeList, ...historyList];
        
        return {
          success: true,
          interceptedRequests: allRequests,
          count: allRequests.length,
          message: `Found ${activeList.length} paused requests and ${historyList.length} processed/auto-continued requests.`,
          nextStep: allRequests.length > 0 ? `⚠️ To replay a packet, call resend_network_request with one of the requestId values above` : undefined
        };
      }
    },

    // Enable network interception - RENAMED
    {
      name: 'start_capturing_network_requests',
      description: 'Enable request interception. Use autoContinue=true for monitoring, pauseMode for modification with modify_network_request.',
      inputSchema: z.object({
        patterns: z.array(z.string()).default(['*']).describe('URL patterns to intercept (e.g., ["*.js", "*.css", "*api*"]). Use "*" for all requests.'),
        autoContinue: z.boolean().default(true).describe('Automatically continue requests? TRUE (Default): Logs request to history and continues immediately (No Freeze). FALSE: Pauses browser for manual modify/continue (CAUTION: FREEZES PAGE).'),
        pauseMode: z.enum(['firstOnly', 'limitedPause', 'persistent']).default('firstOnly').describe('SAFETY MODE when autoContinue=false. "firstOnly" (SAFE DEFAULT): Only first request pauses, rest auto-continue (prevents browser freeze). "limitedPause" (SAFE): Pauses up to maxPaused requests, rest auto-continue. "persistent" (DANGEROUS): ALL requests pause forever until manually continued (can crash browser).'),
        maxPaused: z.number().default(1).describe('When pauseMode="limitedPause", maximum requests to pause before auto-continuing (default: 1).'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ patterns = ['*'], autoContinue = true, pauseMode = 'firstOnly', maxPaused = 1, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Network, Fetch } = client;
        
        // Enable Network domain
        await Network.enable();
        
        // Enable Fetch domain for interception
        await Fetch.enable({
          patterns: patterns.map((pattern: string) => ({
            urlPattern: pattern,
            requestStage: 'Request'
          }))
        });
        
        // Initialize storage for this tab
        const effectiveTabId = tabId || 'default';
        if (!interceptedRequests.has(effectiveTabId)) {
          interceptedRequests.set(effectiveTabId, new Map());
        }
        
        // Initialize interception state
        interceptionState.set(effectiveTabId, {
          autoContinue,
          pauseMode,
          pausedCount: 0
        });
        
        // Listen for intercepted requests
        Fetch.requestPaused(async (params: any) => {
          const requests = interceptedRequests.get(effectiveTabId)!;
          const state = interceptionState.get(effectiveTabId)!;
          requests.set(params.requestId, params);
          
          // Determine if we should auto-continue this request
          let shouldAutoContinue = state.autoContinue;
          
          // Handle special pause modes when autoContinue is false
          if (!state.autoContinue && state.pauseMode !== 'persistent') {
            if (state.pauseMode === 'firstOnly') {
              // After first pause, switch to auto-continue
              if (state.pausedCount > 0) {
                shouldAutoContinue = true;
              } else {
                state.pausedCount++;
              }
            } else if (state.pauseMode === 'limitedPause') {
              // Pause up to maxPaused requests
              if (state.pausedCount >= maxPaused) {
                shouldAutoContinue = true;
              } else {
                state.pausedCount++;
              }
            }
          }
          
          // Auto-continue if enabled or triggered by pause mode
          if (shouldAutoContinue) {
            try {
              // Store in history
              if (!requestHistory.has(effectiveTabId)) {
                requestHistory.set(effectiveTabId, []);
              }
              const history = requestHistory.get(effectiveTabId)!;
              
              history.unshift({
                ...params,
                status: state.autoContinue ? 'auto-continued' : 'auto-continued-after-pause-limit',
                timestamp: Date.now()
              });
              
              // Keep last 100 requests
              if (history.length > 100) history.pop();
              
              await Fetch.continueRequest({ requestId: params.requestId });
              requests.delete(params.requestId);
            } catch (e) {
              console.error(`[Auto-continue] Failed for ${params.request.url}:`, e);
            }
          }
        });
        
        const warningMessage = !autoContinue && pauseMode === 'persistent' 
          ? '🚨 DANGER: persistent pause mode active! You MUST manually continue/modify/fail EVERY request or browser will FREEZE! Switch to pauseMode="firstOnly" for safety.' 
          : !autoContinue && pauseMode === 'firstOnly'
          ? '✅ SAFE MODE ACTIVE: Only the FIRST request will pause for inspection. All subsequent requests auto-continue (no freeze risk).'
          : !autoContinue && pauseMode === 'limitedPause'
          ? `✅ SAFE MODE ACTIVE: Only the first ${maxPaused} request(s) will pause. All subsequent requests auto-continue (no freeze risk).`
          : autoContinue
          ? '✅ MONITORING MODE: All requests logged to history and auto-continued (no freeze risk). Use list_intercepted_requests to view history.'
          : undefined;
        
        return {
          success: true,
          message: `Network interception enabled for patterns: ${patterns.join(', ')}`,
          autoContinue: autoContinue,
          pauseMode: pauseMode,
          maxPaused: pauseMode === 'limitedPause' ? maxPaused : undefined,
          warning: warningMessage,
          interceptedCount: 0,
          nextStep: '⚠️ NEXT: Call list_intercepted_requests to see captured traffic (DO NOT use execute_script or Performance API)'
        };
      }
    },

    // Modify and continue intercepted request
    {
      name: 'modify_network_request',
      description: 'Modify an intercepted request URL, headers, or body before sending. Preserves original authentication and cookies.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from show_captured_network_traffic'),
        modifiedUrl: z.string().optional().describe('New URL to request'),
        modifiedMethod: z.string().optional().describe('New HTTP method (GET, POST, etc.)'),
        modifiedHeaders: z.record(z.string()).optional().describe('New/modified headers'),
        modifiedPostData: z.string().optional().describe('New POST body data'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, modifiedUrl, modifiedMethod, modifiedHeaders, modifiedPostData, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Fetch } = client;
        
        const effectiveTabId = tabId || 'default';
        const requests = interceptedRequests.get(effectiveTabId);
        const originalRequest = requests?.get(requestId);
        
        if (!originalRequest) {
          throw new Error(`Request ${requestId} not found. It may have already been processed.`);
        }
        
        // Prepare modified headers
        let headers: any[] | undefined;
        if (modifiedHeaders) {
          headers = Object.entries(modifiedHeaders).map(([name, value]) => ({ name, value }));
        }
        
        // Continue request with modifications
        await Fetch.continueRequest({
          requestId,
          url: modifiedUrl,
          method: modifiedMethod,
          headers,
          postData: modifiedPostData
        });
        
        // Remove from pending requests
        requests?.delete(requestId);
        
        return {
          success: true,
          message: `Request ${requestId} modified and continued`,
          originalUrl: originalRequest.request.url,
          modifiedUrl: modifiedUrl || originalRequest.request.url
        };
      }
    },

    // Fail intercepted request
    {
      name: 'block_network_request',
      description: 'Block an intercepted request with a network error (Failed, Aborted, TimedOut, AccessDenied).',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from show_captured_network_traffic'),
        errorReason: z.enum([
          'Failed',
          'Aborted',
          'TimedOut',
          'AccessDenied',
          'ConnectionClosed',
          'ConnectionReset',
          'ConnectionRefused',
          'ConnectionAborted',
          'ConnectionFailed',
          'NameNotResolved',
          'InternetDisconnected',
          'AddressUnreachable',
          'BlockedByClient',
          'BlockedByResponse'
        ]).default('Failed').describe('Reason for failing the request'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, errorReason = 'Failed', tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Fetch } = client;
        
        const effectiveTabId = tabId || 'default';
        const requests = interceptedRequests.get(effectiveTabId);
        const originalRequest = requests?.get(requestId);
        
        if (!originalRequest) {
          throw new Error(`Request ${requestId} not found. It may have already been processed.`);
        }
        
        // Fail the request
        await Fetch.failRequest({
          requestId,
          errorReason
        });
        
        // Remove from pending requests
        requests?.delete(requestId);
        
        return {
          success: true,
          message: `Request ${requestId} failed with reason: ${errorReason}`,
          url: originalRequest.request.url
        };
      }
    },

    // Continue intercepted request (without modifications)
    {
      name: 'continue_network_request',
      description: 'Continue a paused request without modifications.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from show_captured_network_traffic'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ requestId, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Fetch } = client;
        
        const effectiveTabId = tabId || 'default';
        const requests = interceptedRequests.get(effectiveTabId);
        const originalRequest = requests?.get(requestId);
        
        if (!originalRequest) {
          throw new Error(`Request ${requestId} not found. It may have already been processed.`);
        }
        
        // Continue without modifications
        await Fetch.continueRequest({ requestId });
        
        // Remove from pending requests
        requests?.delete(requestId);
        
        return {
          success: true,
          message: `Request ${requestId} continued without modifications`,
          url: originalRequest.request.url
        };
      }
    },

    // Replay/Resend intercepted request - RENAMED
    {
      name: 'resend_network_request',
      description: 'Replay a captured request with optional header/body modifications. May fail with CORS on strict APIs.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from show_captured_network_traffic (active or history)'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        customMethod: z.string().optional().describe('Override HTTP method (e.g., change GET to POST)'),
        customHeaders: z.record(z.string()).optional().describe('Override specific headers (e.g., { "x-csrf-token": "new-token" }). Merges with, does not replace, original headers.'),
        customBody: z.string().optional().describe('Override request body (raw string/JSON).')
      }),
      handler: async ({ requestId, tabId, customMethod, customHeaders, customBody }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const effectiveTabId = tabId || 'default';
        
        // Search in active requests first
        const activeRequests = interceptedRequests.get(effectiveTabId);
        let requestData = activeRequests?.get(requestId);
        
        // If not found, search in history
        if (!requestData) {
          const history = requestHistory.get(effectiveTabId);
          requestData = history?.find((r: any) => r.requestId === requestId);
        }
        
        if (!requestData) {
          throw new Error(`Request ${requestId} not found in active queue or history.`);
        }
        
        const { request } = requestData;
        
        // Determine final parameters (Original vs Override)
        const finalMethod = customMethod || request.method;
        const finalBody = customBody !== undefined ? customBody : request.postData;
        
        // Headers merging logic
        const forbiddenHeaders = ['host', 'connection', 'content-length', 'origin', 'referer', 'accept-encoding', 'cookie', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'user-agent'];
        const safeHeaders: Record<string, string> = {};
        
        // 1. Start with original headers (filtered)
        if (request.headers) {
             Object.entries(request.headers).forEach(([k, v]) => {
                 if (!forbiddenHeaders.includes(k.toLowerCase())) {
                     safeHeaders[k] = v as string;
                 }
             });
        }
        
        // 2. Apply custom headers (overrides)
        if (customHeaders) {
            Object.entries(customHeaders).forEach(([k, v]) => {
                safeHeaders[k] = v as string;
            });
        }
        
        console.error(`[Replay] Resending ${finalMethod} request to ${request.url}`);
        
        // Construct fetch script
        const script = `
        (async function() {
            try {
                const response = await fetch("${request.url}", {
                    method: "${finalMethod}",
                    headers: ${JSON.stringify(safeHeaders)},
                    body: ${finalBody ? JSON.stringify(finalBody) : 'undefined'},
                    credentials: 'include', 
                    mode: 'cors'
                });
                
                // Read body to verify
                const text = await response.text();
                
                return {
                    success: response.ok,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    bodySize: text.length,
                    preview: text.substring(0, 500)
                };
            } catch (e) {
                return { __error: e.message, stack: e.stack };
            }
        })()
        `;
        
        const result: any = await Runtime.evaluate({
            expression: script,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
        });
        
         if (result.exceptionDetails) {
            throw new Error(`Replay failed: ${result.exceptionDetails.exception?.description}`);
        }
        
        const value = result.result.value;
        if (value && value.__error) {
             return {
                success: false,
                originalRequestId: requestId,
                requestUrl: request.url,
                requestMethod: finalMethod,
                replayError: value.__error,
                message: '✅ Packet data retrieved, ❌ Replay failed due to browser security',
                explanation: 'The server rejected the replayed request (CORS/authentication). This is expected for secure APIs. The original request was captured with full details.',
                alternativeWorkflow: 'Use start_capturing_network_requests + modify_network_request to intercept and modify requests BEFORE they are sent, not after.'
             };
        }
        
        return {
            success: true,
            message: `Request replayed successfully`,
            originalRequestId: requestId,
            replayResult: value,
            hint: '✅ Packet resent with preserved authentication. Response received from server.'
        };
      }
    },

    // Disable network interception - RENAMED
    {
      name: 'stop_capturing_network_requests',
      description: 'Disable request interception and release pending requests.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Fetch } = client;
        
        // Disable Fetch domain
        await Fetch.disable();
        
        // Clear intercepted requests for this tab
        const effectiveTabId = tabId || 'default';
        interceptedRequests.delete(effectiveTabId);
        interceptionState.delete(effectiveTabId);
        
        return {
          success: true,
          message: 'Network interception disabled'
        };
      }
    },

    // Get accessibility tree
    {
      name: 'get_accessibility_tree',
      description: 'Get the full accessibility tree with roles, names, and values for accessibility testing.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
        depth: z.number().default(-1).describe('Depth of the tree to retrieve (-1 for full tree)'),
        includeIgnored: z.boolean().default(false).describe('Include ignored accessibility nodes')
      }),
      handler: async ({ tabId, depth = -1, includeIgnored = false }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Accessibility } = client;
        
        // Get the full accessibility tree
        const result: any = await withTimeout(
          Accessibility.getFullAXTree({ depth }),
          30000,
          'Accessibility tree retrieval timed out'
        );
        
        const nodes = result.nodes || [];
        
        // Filter out ignored nodes if requested
        const filteredNodes = includeIgnored 
          ? nodes 
          : nodes.filter((node: any) => !node.ignored);
        
        // Format tree in a more readable structure
        const formatNode = (node: any) => {
          const formatted: any = {
            nodeId: node.nodeId,
            role: node.role?.value || 'unknown',
            name: node.name?.value || '',
          };
          
          // Add additional properties if present
          if (node.description?.value) formatted.description = node.description.value;
          if (node.value?.value) formatted.value = node.value.value;
          if (node.properties) {
            formatted.properties = node.properties.reduce((acc: any, prop: any) => {
              acc[prop.name] = prop.value.value;
              return acc;
            }, {});
          }
          
          // Add children references
          if (node.childIds && node.childIds.length > 0) {
            formatted.childIds = node.childIds;
          }
          
          return formatted;
        };
        
        const formattedTree = filteredNodes.map(formatNode);
        
        // Create a hierarchical view (root nodes)
        const rootNodes = formattedTree.filter((node: any) => {
          // Root nodes are those not referenced as children by others
          const allChildIds = new Set(
            formattedTree.flatMap((n: any) => n.childIds || [])
          );
          return !allChildIds.has(node.nodeId);
        });
        
        return {
          success: true,
          totalNodes: formattedTree.length,
          rootNodes: rootNodes.map((n: any) => ({
            nodeId: n.nodeId,
            role: n.role,
            name: n.name
          })),
          nodes: formattedTree,
          message: `Retrieved ${formattedTree.length} accessibility nodes (${rootNodes.length} root nodes)`
        };
      }
    },

    // Get accessibility snapshot (simpler, Playwright-style)
    {
      name: 'get_accessibility_snapshot',
      description: 'Get a simplified accessibility snapshot with key interactive elements (roles, names, values).',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
        interestingOnly: z.boolean().default(true).describe('Only include interesting nodes (buttons, links, inputs, etc.)')
      }),
      handler: async ({ tabId, interestingOnly = true }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Accessibility } = client;
        
        // Get the accessibility snapshot
        const result: any = await withTimeout(
          Accessibility.getFullAXTree({}),
          30000,
          'Accessibility snapshot retrieval timed out'
        );
        
        const nodes = result.nodes || [];
        
        // Filter interesting roles if requested
        const interestingRoles = new Set([
          'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio',
          'combobox', 'listbox', 'menuitem', 'tab', 'heading', 'article',
          'navigation', 'main', 'banner', 'form', 'dialog', 'alert'
        ]);
        
        const filteredNodes = nodes.filter((node: any) => {
          if (node.ignored) return false;
          if (!interestingOnly) return true;
          return interestingRoles.has(node.role?.value?.toLowerCase() || '');
        });
        
        // Build a YAML-like string representation
        const lines: string[] = [];
        const nodeMap = new Map(nodes.map((n: any) => [n.nodeId, n]));
        const processed = new Set<string>();
        
        function renderNode(node: any, indent: number = 0): void {
          if (processed.has(node.nodeId)) return;
          processed.add(node.nodeId);
          
          const prefix = '  '.repeat(indent) + '- ';
          const role = node.role?.value || 'unknown';
          const name = node.name?.value || '';
          const value = node.value?.value || '';
          
          let line = `${prefix}${role}`;
          if (name) line += ` "${name}"`;
          if (value && value !== name) line += ` [value: "${value}"]`;
          if (node.nodeId) line += ` [ref=${node.nodeId.substring(0, 8)}]`;
          
          lines.push(line);
          
          // Render children
          if (node.childIds) {
            for (const childId of node.childIds) {
              const childNode = nodeMap.get(childId);
              if (childNode && !processed.has(childId)) {
                const isInteresting = !interestingOnly || 
                  interestingRoles.has((childNode as any).role?.value?.toLowerCase() || '');
                if (isInteresting) {
                  renderNode(childNode, indent + 1);
                }
              }
            }
          }
        }
        
        // Find root node
        const rootNode = nodes.find((n: any) => n.role?.value === 'RootWebArea' || n.role?.value === 'WebArea');
        if (rootNode) {
          renderNode(rootNode, 0);
        }
        
        const snapshot = lines.join('\n');
        
        return {
          success: true,
          snapshot,
          nodeCount: filteredNodes.length,
          totalNodes: nodes.length
        };
      }
    }
  ];
}
