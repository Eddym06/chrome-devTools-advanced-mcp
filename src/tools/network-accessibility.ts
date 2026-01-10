/**
 * Network Interception and Accessibility Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { withTimeout } from '../utils/helpers.js';

// Store for intercepted requests (per tab)
const interceptedRequests = new Map<string, Map<string, any>>();

export function createNetworkAccessibilityTools(connector: ChromeConnector) {
  return [
    // Enable network interception
    {
      name: 'enable_network_interception',
      description: '🔒 Enables REQUEST interception (modify/block requests before they send). USE THIS WHEN: 1️⃣ Modifying request URLs (redirect API calls). 2️⃣ Changing request headers/method (test API variations). 3️⃣ Blocking specific resources (speed testing without ads). WORKFLOW: enable_network_interception → list_intercepted_requests → modify_intercepted_request/fail_intercepted_request. DIFFERENT FROM: enable_response_interception (responses, not requests). PATTERNS: ["*"] = all, ["*.js"] = JS only. CRITICAL: Set autoContinue=true if you only want to log/inspect without blocking. Otherwise page will freeze waiting for you to process each request!',
      inputSchema: z.object({
        patterns: z.array(z.string()).default(['*']).describe('URL patterns to intercept (e.g., ["*.js", "*.css", "*api*"]). Use "*" for all requests.'),
        autoContinue: z.boolean().default(false).describe('Automatically continue all intercepted requests without pausing. Set true for logging/inspection without blocking. Set false for manual control (you MUST call continue/modify/fail for each request).'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ patterns = ['*'], autoContinue = false, tabId }: any) => {
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
        
        // Listen for intercepted requests
        Fetch.requestPaused(async (params: any) => {
          const requests = interceptedRequests.get(effectiveTabId)!;
          requests.set(params.requestId, params);
          
          // Auto-continue if enabled (prevents page freeze)
          if (autoContinue) {
            try {
              await Fetch.continueRequest({ requestId: params.requestId });
              requests.delete(params.requestId);
            } catch (e) {
              console.error(`[Auto-continue] Failed for ${params.request.url}:`, e);
            }
          }
        });
        
        return {
          success: true,
          message: `Network interception enabled for patterns: ${patterns.join(', ')}`,
          autoContinue: autoContinue,
          warning: !autoContinue ? '⚠️ WARNING: You MUST call continue/modify/fail for EVERY intercepted request, otherwise pages will freeze!' : undefined,
          interceptedCount: 0
        };
      }
    },

    // List intercepted requests
    {
      name: 'list_intercepted_requests',
      description: '📝 Lists paused requests (after enable_network_interception). USE THIS WHEN: 1️⃣ After enable_network_interception (see what\'s paused). 2️⃣ Getting requestId for modification/blocking. 3️⃣ Checking request details (URL, method, headers). PREREQUISITE: enable_network_interception must be called first. RETURNS: Array with requestId, URL, method, resourceType. NEXT STEPS: Use requestId with modify_intercepted_request, fail_intercepted_request, or continue_intercepted_request.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const effectiveTabId = tabId || 'default';
        const requests = interceptedRequests.get(effectiveTabId);
        
        if (!requests || requests.size === 0) {
          return {
            success: true,
            interceptedRequests: [],
            count: 0,
            message: 'No requests currently intercepted. Use enable_network_interception first.'
          };
        }
        
        const requestList = Array.from(requests.values()).map((req: any) => ({
          requestId: req.requestId,
          url: req.request.url,
          method: req.request.method,
          resourceType: req.resourceType,
          headers: req.request.headers
        }));
        
        return {
          success: true,
          interceptedRequests: requestList,
          count: requestList.length
        };
      }
    },

    // Modify and continue intercepted request
    {
      name: 'modify_intercepted_request',
      description: '✏️ Modifies paused request before sending. USE THIS WHEN: 1️⃣ Redirecting request (change URL to different API). 2️⃣ Modifying headers (add auth token, change User-Agent). 3️⃣ Changing HTTP method (POST → GET for testing). 4️⃣ Testing API variations (modify request body). PREREQUISITE: Get requestId from list_intercepted_requests. PARAMETERS: All optional - only provide what needs changing. EFFECT: Modified request sent to server.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from list_intercepted_requests'),
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
      name: 'fail_intercepted_request',
      description: '⛔ Blocks intercepted request (network error). USE THIS WHEN: 1️⃣ Simulating network failures (test offline behavior). 2️⃣ Blocking ads/trackers (prevent resource load). 3️⃣ Testing error handling (force API failure). 4️⃣ Speed testing (block slow resources). PREREQUISITE: Get requestId from list_intercepted_requests. ERROR REASONS: Failed, Aborted, TimedOut, AccessDenied, ConnectionClosed, ConnectionReset, ConnectionRefused. EFFECT: Request fails as if network error occurred.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from list_intercepted_requests'),
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
      name: 'continue_intercepted_request',
      description: '▶️ Continues paused request without changes. USE THIS WHEN: 1️⃣ Inspected request but don\'t need to modify (let it proceed). 2️⃣ Conditionally modifying (if condition not met, continue). 3️⃣ Analyzing requests without altering behavior. PREREQUISITE: Get requestId from list_intercepted_requests. EFFECT: Request proceeds normally to server. TIP: Must call this, modify_intercepted_request, or fail_intercepted_request for ALL intercepted requests.',
      inputSchema: z.object({
        requestId: z.string().describe('Request ID from list_intercepted_requests'),
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

    // Disable network interception
    {
      name: 'disable_network_interception',
      description: '🔓 Disables request interception (cleanup). USE THIS WHEN: 1️⃣ Done testing request modifications. 2️⃣ Switching to normal browsing (no interception). 3️⃣ Cleanup after testing. EFFECT: All pending requests released, future requests not intercepted. CLEANUP: Clears intercepted request storage. TIP: Call after finishing with modify_intercepted_request workflow.',
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
        
        return {
          success: true,
          message: 'Network interception disabled'
        };
      }
    },

    // Get accessibility tree
    {
      name: 'get_accessibility_tree',
      description: '🌳 Full accessibility tree (screen reader view). USE THIS WHEN: 1️⃣ Testing accessibility compliance (ARIA roles, labels). 2️⃣ Debugging screen reader behavior (what\'s announced). 3️⃣ Verifying semantic HTML structure. 4️⃣ Finding accessibility issues (missing labels, invalid roles). RETURNS: Hierarchical tree with roles, names, values, children. COMMON ROLES: button, link, heading, textbox, region. TIP: Use get_accessibility_snapshot for simplified view.',
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
      description: '📸 Simplified accessibility snapshot (key info only). USE THIS WHEN: 1️⃣ Quick accessibility check (don\'t need full tree). 2️⃣ Finding interactive elements (buttons, links). 3️⃣ Verifying labels exist (form inputs have names). 4️⃣ Smaller output than get_accessibility_tree. RETURNS: Flat list with role, name, value for each element. FASTER: Less data than full tree. USE CASE: Playwright-style accessibility testing.',
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
