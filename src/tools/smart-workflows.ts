/**
 * Smart Workflow Tools
 * High-level tools that combine multiple primitives for common use cases
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { escJS } from '../utils/helpers.js';

export function createSmartWorkflowTools(connector: ChromeConnector) {
  return [
    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL SIMPLE: Add Header to Request (SIMPLIFIED VERSION)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'add_custom_header_to_request',
      description: 'Add a custom header to matching requests before sending. Simpler alternative to intercept_and_modify_traffic with flat parameters.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to intercept (e.g., "*api*", "*.json")'),
        headerName: z.string().describe('Name of header to add (e.g., "X-Custom-Header")'),
        headerValue: z.string().describe('Value of header (e.g., "test-value")'),
        clickSelector: z.string().optional().describe('CSS selector of element to click (if action is click)'),
        navigateUrl: z.string().optional().describe('URL to navigate to (if action is navigate)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, headerName, headerValue, clickSelector, navigateUrl, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Fetch, Runtime, Page } = client;

          // Enable interception
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const modifiedRequests: any[] = [];

          // Set up handler
          Fetch.requestPaused(async (params: any) => {
            try {
              const headers = params.request.headers || {};
              headers[headerName] = headerValue;

              const headersArray = Object.entries(headers).map(([name, value]) => ({
                name,
                value: String(value)
              }));

              await Fetch.continueRequest({
                requestId: params.requestId,
                headers: headersArray
              });

              modifiedRequests.push({
                url: params.request.url,
                addedHeader: `${headerName}: ${headerValue}`,
                modified: true
              });
            } catch (error) {
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => { });
            }
          });

          // Perform action
          await Page.enable();

          if (clickSelector) {
            await Runtime.evaluate({
              expression: `document.querySelector('${escJS(clickSelector)}')?.click()`,
              userGesture: true
            });
          } else if (navigateUrl) {
            await Page.navigate({ url: navigateUrl });
            await Page.loadEventFired();
          }

          // Wait for network
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Cleanup
          await Fetch.disable();

          return {
            success: true,
            modifiedCount: modifiedRequests.length,
            requests: modifiedRequests,
            message: `✅ Added header "${headerName}: ${headerValue}" to ${modifiedRequests.length} request(s)`,
            explanation: 'Requests were modified BEFORE sending with original authentication preserved'
          };

        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            hint: 'Provide either clickSelector or navigateUrl to trigger requests'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL NEW: Intercept and Modify Traffic (ADVANCED VERSION)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'intercept_and_modify_traffic',
      description: 'Intercept and modify network requests in real-time before sending. Preserves cookies and authentication. Supports header/body/method changes.',
      inputSchema: z.object({
        urlPattern: z.string().describe('URL pattern to intercept (e.g., "**/api/**", "*/graphql*")'),
        modifications: z.object({
          addHeaders: z.record(z.string()).optional().describe('Headers to add/override as object: { "X-Custom": "value" }'),
          removeHeaders: z.array(z.string()).optional().describe('Header names to remove as array: ["X-Old"]'),
          modifyBody: z.string().optional().describe('New request body (replaces original)'),
          modifyMethod: z.string().optional().describe('New HTTP method (GET, POST, PUT, etc.)'),
        }).describe('Modifications object (NOT string). Example: { addHeaders: { "X-Test": "value" } }'),
        action: z.object({
          type: z.enum(['click', 'navigate', 'wait']).describe('Action that triggers the request'),
          selector: z.string().optional().describe('CSS selector for click action'),
          url: z.string().optional().describe('URL for navigate action'),
          waitMs: z.number().optional().describe('Milliseconds to wait (for wait action)'),
        }).describe('Action object (NOT string). Example: { type: "click", selector: ".button" }'),
        captureResponse: z.boolean().default(false).describe('Also capture the response after modification'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ urlPattern, modifications, action, captureResponse, tabId }: any) => {
        try {
          // Validate inputs
          if (typeof modifications === 'string') {
            throw new Error('❌ modifications must be an OBJECT, not a string. Example: { addHeaders: { "X-Test": "value" } }');
          }
          if (typeof action === 'string') {
            throw new Error('❌ action must be an OBJECT, not a string. Example: { type: "click", selector: ".button" }');
          }
          if (!action.type) {
            throw new Error('❌ action.type is required. Must be: "click", "navigate", or "wait"');
          }
          if (action.type === 'click' && !action.selector) {
            throw new Error('❌ action.selector is required for click actions');
          }
          if (action.type === 'navigate' && !action.url) {
            throw new Error('❌ action.url is required for navigate actions');
          }

          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Fetch, Runtime, Page, Input } = client;

          // Step 1: Enable interception
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const modifiedRequests: any[] = [];
          const responses: any[] = [];

          // Step 2: Set up interception handler
          Fetch.requestPaused(async (params: any) => {
            try {
              // Build modified headers
              const originalHeaders = params.request.headers || {};
              let finalHeaders = { ...originalHeaders };

              // Add/override headers
              if (modifications.addHeaders) {
                finalHeaders = { ...finalHeaders, ...modifications.addHeaders };
              }

              // Remove headers
              if (modifications.removeHeaders) {
                modifications.removeHeaders.forEach((header: string) => {
                  delete finalHeaders[header];
                });
              }

              // Convert to CDP format
              const headersArray = Object.entries(finalHeaders).map(([name, value]) => ({ name, value: String(value) }));

              // Prepare modification params
              const modifyParams: any = {
                requestId: params.requestId,
                headers: headersArray,
              };

              if (modifications.modifyMethod) {
                modifyParams.method = modifications.modifyMethod;
              }

              if (modifications.modifyBody !== undefined) {
                modifyParams.postData = modifications.modifyBody;
              }

              // Continue with modifications
              await Fetch.continueRequest(modifyParams);

              modifiedRequests.push({
                url: params.request.url,
                originalMethod: params.request.method,
                modifiedMethod: modifications.modifyMethod || params.request.method,
                originalHeaders: originalHeaders,
                modifiedHeaders: finalHeaders,
                modified: true
              });

            } catch (error) {
              // Fallback: continue without modification
              await Fetch.continueRequest({ requestId: params.requestId }).catch(() => { });
            }
          });

          // Step 3: Perform the action that triggers the request
          await Page.enable();

          switch (action.type) {
            case 'click':
              if (!action.selector) throw new Error('selector required for click action');
              await Runtime.evaluate({
                expression: `document.querySelector('${escJS(action.selector)}')?.click()`,
                userGesture: true
              });
              break;

            case 'navigate':
              if (!action.url) throw new Error('url required for navigate action');
              await Page.navigate({ url: action.url });
              await Page.loadEventFired();
              break;

            case 'wait':
              await new Promise(resolve => setTimeout(resolve, action.waitMs || 2000));
              break;
          }

          // Wait for network activity
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Step 4: Cleanup
          await Fetch.disable();

          return {
            success: true,
            interceptedAndModified: modifiedRequests.length,
            requests: modifiedRequests,
            message: `✅ Intercepted and modified ${modifiedRequests.length} request(s) in real-time`,
            explanation: 'Requests were modified BEFORE sending, preserving authentication and avoiding CORS issues',
            advantage: 'This is the ONLY reliable way to modify authenticated requests - they are sent with original cookies/auth',
            capturedResponses: captureResponse ? responses : undefined
          };

        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            hint: 'Ensure the action triggers a network request matching the URL pattern'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 1: Capture Network on Action (ANALYSIS ONLY)
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'capture_network_on_action',
      description: 'Capture network requests triggered by an action (click, navigate, type). Returns full request details including URL, headers, body, and method.',
      inputSchema: z.object({
        action: z.enum(['click', 'navigate', 'type']).describe('Action to perform: click element, navigate to URL, or type text'),
        selector: z.string().optional().describe('CSS selector (required for click/type actions)'),
        url: z.string().optional().describe('URL (required for navigate action)'),
        text: z.string().optional().describe('Text to type (required for type action)'),
        urlPattern: z.string().default('*').describe('Filter captured requests by URL pattern (e.g., "*api*", "*.json")'),
        waitAfterAction: z.number().default(2000).describe('Milliseconds to wait after action before capturing (default: 2000)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ action, selector, url, text, urlPattern, waitAfterAction, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Fetch, Runtime, Input } = client;

          // Step 1: Enable network interception
          await Network.enable();
          await Fetch.enable({
            patterns: [{ urlPattern, requestStage: 'Request' as const }]
          });

          const interceptedRequests: any[] = [];

          // Listen for requests
          Fetch.requestPaused((params: any) => {
            interceptedRequests.push(params);
            Fetch.continueRequest({ requestId: params.requestId }).catch(() => { });
          });

          // Step 2: Perform action
          switch (action) {
            case 'click':
              if (!selector) throw new Error('selector is required for click action');
              await Runtime.evaluate({
                expression: `document.querySelector('${escJS(selector)}')?.click()`,
                userGesture: true
              });
              break;

            case 'navigate':
              if (!url) throw new Error('url is required for navigate action');
              await client.Page.navigate({ url });
              break;

            case 'type':
              if (!selector || !text) throw new Error('selector and text are required for type action');
              await Runtime.evaluate({
                expression: `document.querySelector('${escJS(selector)}')?.focus()`,
                userGesture: true
              });
              for (const char of text) {
                await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
                await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
              }
              break;
          }

          // Step 3: Wait for network activity
          await new Promise(resolve => setTimeout(resolve, waitAfterAction));

          // Step 4: Cleanup
          await Fetch.disable();

          // Step 5: Format and return results
          const formattedRequests = interceptedRequests.map(req => ({
            requestId: req.requestId,
            url: req.request.url,
            method: req.request.method,
            resourceType: req.resourceType,
            headers: req.request.headers,
            postData: req.request.postData
          }));

          return {
            success: true,
            action: action,
            capturedCount: formattedRequests.length,
            requests: formattedRequests,
            message: `Captured ${formattedRequests.length} network request(s) after ${action} action`,
            analysisComplete: true,
            hint: '💡 To MODIFY requests in real-time, use intercept_and_modify_traffic before the action',
            note: 'This tool is for ANALYSIS. For modification with auth preserved, intercept BEFORE the action happens.'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            suggestion: 'Check selector/URL is valid and page is loaded'
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 2: Navigate and Extract Content
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'navigate_and_extract_content',
      description: 'Navigate to URL and extract page content (text, links, images, metadata) in one call.',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        waitForSelector: z.string().optional().describe('CSS selector to wait for before extracting (ensures dynamic content loads)'),
        extractText: z.boolean().default(true).describe('Extract visible text'),
        extractLinks: z.boolean().default(true).describe('Extract all links'),
        extractImages: z.boolean().default(false).describe('Extract image sources'),
        extractMetadata: z.boolean().default(true).describe('Extract page title and meta tags'),
        timeout: z.number().default(30000).describe('Navigation timeout in ms'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, waitForSelector, extractText, extractLinks, extractImages, extractMetadata, timeout, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Page, Runtime } = client;

          // Step 1: Navigate
          await Page.enable();
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Step 2: Wait for selector if provided
          if (waitForSelector) {
            const waitScript = `
              new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject('Timeout waiting for selector'), ${timeout});
                const check = () => {
                  if (document.querySelector('${escJS(waitForSelector)}')) {
                    clearTimeout(timeout);
                    resolve(true);
                  } else {
                    setTimeout(check, 100);
                  }
                };
                check();
              })
            `;
            await Runtime.evaluate({ expression: waitScript, awaitPromise: true });
          }

          // Step 3: Extract data
          const extractionScript = `
            ({
              text: ${extractText} ? document.body.innerText : null,
              links: ${extractLinks} ? Array.from(document.querySelectorAll('a')).map(a => ({ href: a.href, text: a.textContent?.trim() })) : null,
              images: ${extractImages} ? Array.from(document.querySelectorAll('img')).map(img => ({ src: img.src, alt: img.alt })) : null,
              metadata: ${extractMetadata} ? {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.content,
                keywords: document.querySelector('meta[name="keywords"]')?.content,
                ogImage: document.querySelector('meta[property="og:image"]')?.content
              } : null,
              url: window.location.href,
              html: document.documentElement.outerHTML.substring(0, 5000)
            })
          `;

          const result = await Runtime.evaluate({
            expression: extractionScript,
            returnByValue: true
          });

          return {
            success: true,
            url: url,
            data: result.result.value,
            message: 'Page loaded and content extracted successfully'
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 3: Test API Endpoint
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'test_api_endpoint',
      description: 'Send HTTP request to an API endpoint and capture the response. Handles auth cookies automatically.',
      inputSchema: z.object({
        url: z.string().describe('API endpoint URL'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
        headers: z.union([z.record(z.string()), z.string()]).optional().describe('Request headers as object {"Content-Type": "application/json"} OR JSON string'),
        body: z.string().optional().describe('Request body (JSON string for POST/PUT)'),
        includeCredentials: z.boolean().default(true).describe('Include cookies and auth in request'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, method, headers, body, includeCredentials, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime } = client;

          await Runtime.enable();

          // Parse headers if it's a JSON string
          let headersObj = {};
          if (headers) {
            if (typeof headers === 'string') {
              try {
                headersObj = JSON.parse(headers);
              } catch (e) {
                throw new Error(`Invalid headers JSON string: ${(e as Error).message}`);
              }
            } else {
              headersObj = headers;
            }
          }
          const fetchScript = `
            (async function() {
              try {
                const response = await fetch("${url}", {
                  method: "${method}",
                  headers: ${JSON.stringify(headersObj)},
                  body: ${body ? JSON.stringify(body) : 'undefined'},
                  credentials: ${includeCredentials ? '"include"' : '"omit"'},
                  mode: 'cors'
                });
                
                const text = await response.text();
                let parsedBody;
                try {
                  parsedBody = JSON.parse(text);
                } catch {
                  parsedBody = text;
                }
                
                return {
                  success: response.ok,
                  status: response.status,
                  statusText: response.statusText,
                  headers: Object.fromEntries(response.headers.entries()),
                  body: parsedBody,
                  bodySize: text.length
                };
              } catch (e) {
                return { __error: e.message, stack: e.stack };
              }
            })()
          `;

          const result = await Runtime.evaluate({
            expression: fetchScript,
            awaitPromise: true,
            returnByValue: true,
            userGesture: true
          });

          if (result.exceptionDetails) {
            throw new Error(`API test failed: ${result.exceptionDetails.exception?.description}`);
          }

          const value = result.result.value;
          if (value && value.__error) {
            throw new Error(`API fetch error: ${value.__error}`);
          }

          return {
            success: true,
            endpoint: url,
            method: method,
            response: value,
            message: `API test completed: ${value.status} ${value.statusText}`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            endpoint: url,
            method: method
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL: Simulate User Journey
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'simulate_user_journey',
      description: 'Execute a sequence of user actions (click, type, wait, navigate, screenshot) automatically.',
      inputSchema: z.object({
        steps: z.array(z.object({
          action: z.enum(['click', 'type', 'wait', 'navigate', 'screenshot']).describe('Action type'),
          selector: z.string().optional().describe('CSS selector (for click/type)'),
          text: z.string().optional().describe('Text to type'),
          url: z.string().optional().describe('URL to navigate'),
          waitMs: z.number().optional().describe('Milliseconds to wait')
        })).describe('Sequence of steps to execute'),
        captureScreenshots: z.boolean().default(false).describe('Capture screenshot after each step'),
        stopOnError: z.boolean().default(true).describe('Stop execution if a step fails'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ steps, captureScreenshots, stopOnError, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime, Input, Page } = client;

          await Runtime.enable();
          if (captureScreenshots) await Page.enable();

          const results = [];

          for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            try {
              let stepResult: any = { step: i + 1, action: step.action };

              switch (step.action) {
                case 'click':
                  await Runtime.evaluate({
                    expression: `document.querySelector('${escJS(step.selector || '')}')?.click()`,
                    userGesture: true
                  });
                  stepResult.success = true;
                  break;

                case 'type':
                  await Runtime.evaluate({
                    expression: `document.querySelector('${escJS(step.selector || '')}')?.focus()`,
                    userGesture: true
                  });
                  for (const char of step.text || '') {
                    await Input.dispatchKeyEvent({ type: 'keyDown', text: char });
                    await Input.dispatchKeyEvent({ type: 'keyUp', text: char });
                  }
                  stepResult.success = true;
                  stepResult.typedText = step.text;
                  break;

                case 'wait':
                  await new Promise(resolve => setTimeout(resolve, step.waitMs || 1000));
                  stepResult.success = true;
                  stepResult.waitedMs = step.waitMs;
                  break;

                case 'navigate':
                  await Page.navigate({ url: step.url || '' });
                  await Page.loadEventFired();
                  stepResult.success = true;
                  stepResult.url = step.url;
                  break;

                case 'screenshot':
                  const screenshot = await Page.captureScreenshot({ format: 'png' });
                  stepResult.success = true;
                  stepResult.screenshotSize = screenshot.data.length;
                  break;
              }

              if (captureScreenshots && step.action !== 'screenshot') {
                const screenshot = await Page.captureScreenshot({ format: 'png' });
                stepResult.screenshot = screenshot.data.substring(0, 100) + '...';
              }

              results.push(stepResult);
            } catch (error: any) {
              results.push({
                step: i + 1,
                action: step.action,
                success: false,
                error: error.message
              });
              if (stopOnError) break;
            }
          }

          return {
            success: true,
            totalSteps: steps.length,
            completedSteps: results.filter(r => r.success).length,
            results: results,
            message: `Completed ${results.filter(r => r.success).length}/${steps.length} steps`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 7: Extract Structured API Data
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'extract_api_data',
      description: 'Navigate to URL and capture all API/XHR responses. Returns parsed JSON data.',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        apiPattern: z.string().default('*').describe('Filter API calls by URL pattern (e.g., "*api*", "*.json")'),
        waitForSelector: z.string().optional().describe('Wait for element before capturing'),
        extractFields: z.array(z.string()).optional().describe('Specific JSON fields to extract (dot notation: "user.name")'),
        timeout: z.number().default(30000).describe('Timeout in ms'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, apiPattern, waitForSelector, extractFields, timeout, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Page, Runtime, Network } = client;

          await Page.enable();
          // Use Network domain (not Fetch) to avoid having to call continueResponse/continueRequest
          await Network.enable();

          const apiResponses: any[] = [];
          // Store response bodies by requestId
          const pendingResponses: Map<string, any> = new Map();

          // Build a simple glob matcher
          const matchesPattern = (u: string) => {
            if (apiPattern === '*') return true;
            const regex = new RegExp('^' + apiPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return regex.test(u);
          };

          // Capture response metadata when it arrives
          Network.responseReceived((params: any) => {
            if (matchesPattern(params.response.url)) {
              pendingResponses.set(params.requestId, {
                url: params.response.url,
                method: params.response.requestHeaders?.[':method'] || 'GET',
                statusCode: params.response.status,
                requestId: params.requestId
              });
            }
          });

          // After fully loaded, retrieve body
          Network.loadingFinished(async (params: any) => {
            const meta = pendingResponses.get(params.requestId);
            if (!meta) return;
            pendingResponses.delete(params.requestId);
            try {
              const bodyResult = await Network.getResponseBody({ requestId: params.requestId });
              let parsedBody: any;
              try { parsedBody = JSON.parse(bodyResult.body); } catch { parsedBody = bodyResult.body; }
              apiResponses.push({ ...meta, body: parsedBody });
            } catch { /* body may not be available */ }
          });

          // Navigate
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Wait for selector if provided
          if (waitForSelector) {
            const waitScript = `
              new Promise((resolve, reject) => {
                const to = setTimeout(() => reject('Timeout'), ${timeout});
                const check = () => {
                  if (document.querySelector('${escJS(waitForSelector)}')) { clearTimeout(to); resolve(true); }
                  else setTimeout(check, 100);
                };
                check();
              })
            `;
            await Runtime.evaluate({ expression: waitScript, awaitPromise: true });
          }

          // Wait a bit for remaining async API calls
          await new Promise(resolve => setTimeout(resolve, 2000));
          await Network.disable();

          // Extract specific fields if requested
          let extractedData = apiResponses;
          if (extractFields && extractFields.length > 0) {
            extractedData = apiResponses.map(resp => {
              const extracted: any = { url: resp.url };
              extractFields.forEach((field: string) => {
                const value = field.split('.').reduce((obj: any, key: string) => obj?.[key], resp.body);
                extracted[field] = value;
              });
              return extracted;
            });
          }

          return {
            success: true,
            url: url,
            apiCallsFound: apiResponses.length,
            data: extractedData,
            message: `Extracted ${apiResponses.length} API response(s)`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL 8: Manage Browser Session
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'manage_browser_session',
      description: 'Save, load, clear, or export browser session (cookies + storage) in one call.',
      inputSchema: z.object({
        operation: z.enum(['save', 'load', 'clear', 'export']).describe('Operation: save (backup), load (restore), clear (logout), export (get JSON)'),
        sessionName: z.string().optional().describe('Session name for save/load operations'),
        sessionData: z.string().optional().describe('Session JSON data (for load operation)'),
        includeLocalStorage: z.boolean().default(true).describe('Include localStorage'),
        includeSessionStorage: z.boolean().default(true).describe('Include sessionStorage'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ operation, sessionName, sessionData, includeLocalStorage, includeSessionStorage, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Runtime } = client;

          await Network.enable();
          await Runtime.enable();

          switch (operation) {
            case 'save':
            case 'export':
              // Get cookies
              const cookies = await Network.getCookies({});

              // Get storage
              let localStorage, sessionStorage;
              if (includeLocalStorage) {
                const localResult = await Runtime.evaluate({
                  expression: 'JSON.stringify(localStorage)',
                  returnByValue: true
                });
                localStorage = JSON.parse(localResult.result.value || '{}');
              }
              if (includeSessionStorage) {
                const sessionResult = await Runtime.evaluate({
                  expression: 'JSON.stringify(sessionStorage)',
                  returnByValue: true
                });
                sessionStorage = JSON.parse(sessionResult.result.value || '{}');
              }

              const session = {
                name: sessionName,
                timestamp: Date.now(),
                cookies: cookies.cookies,
                localStorage,
                sessionStorage
              };

              return {
                success: true,
                operation: operation,
                sessionName: sessionName,
                sessionData: session,
                cookieCount: cookies.cookies.length,
                message: `Session ${operation === 'save' ? 'saved' : 'exported'} successfully`
              };

            case 'load':
              if (!sessionData) {
                throw new Error('sessionData is required for load operation');
              }

              const loadedSession = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;

              // Set cookies
              for (const cookie of loadedSession.cookies || []) {
                await Network.setCookie(cookie);
              }

              // Set storage
              if (includeLocalStorage && loadedSession.localStorage) {
                await Runtime.evaluate({
                  expression: `
                    const data = ${JSON.stringify(loadedSession.localStorage)};
                    Object.keys(data).forEach(key => localStorage.setItem(key, data[key]));
                  `
                });
              }
              if (includeSessionStorage && loadedSession.sessionStorage) {
                await Runtime.evaluate({
                  expression: `
                    const data = ${JSON.stringify(loadedSession.sessionStorage)};
                    Object.keys(data).forEach(key => sessionStorage.setItem(key, data[key]));
                  `
                });
              }

              return {
                success: true,
                operation: 'load',
                sessionName: loadedSession.name,
                cookiesRestored: (loadedSession.cookies || []).length,
                message: 'Session loaded successfully'
              };

            case 'clear':
              // Clear cookies
              const allCookies = await Network.getCookies({});
              for (const cookie of allCookies.cookies) {
                await Network.deleteCookies({ name: cookie.name, domain: cookie.domain });
              }

              // Clear storage
              if (includeLocalStorage) {
                await Runtime.evaluate({ expression: 'localStorage.clear()' });
              }
              if (includeSessionStorage) {
                await Runtime.evaluate({ expression: 'sessionStorage.clear()' });
              }

              return {
                success: true,
                operation: 'clear',
                cookiesCleared: allCookies.cookies.length,
                message: 'Session cleared successfully'
              };

            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            operation: operation
          };
        }
      }
    },

    // ═══════════════════════════════════════════════════════════════════
    // SMART TOOL: Test with Different Cookies
    // ═══════════════════════════════════════════════════════════════════
    {
      name: 'test_with_different_cookies',
      description: 'Test a page with modified cookies. Saves original cookies, applies test cookies, optionally restores.',
      inputSchema: z.object({
        url: z.string().describe('URL to test'),
        cookies: z.array(z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional()
        })).describe('Cookies to set for testing'),
        restoreOriginal: z.boolean().default(true).describe('Restore original cookies after test'),
        extractContent: z.boolean().default(true).describe('Extract page content with new cookies'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ url, cookies, restoreOriginal, extractContent, tabId }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Network, Page, Runtime } = client;

          await Network.enable();
          await Page.enable();
          await Runtime.enable();

          // Step 1: Save original cookies
          let originalCookies: any[] = [];
          if (restoreOriginal) {
            const result = await Network.getCookies({});
            originalCookies = result.cookies;
          }

          // Step 2: Set new cookies
          for (const cookie of cookies) {
            await Network.setCookie({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain || new URL(url).hostname,
              path: cookie.path || '/'
            });
          }

          // Step 3: Navigate with new cookies
          await Page.navigate({ url });
          await Page.loadEventFired();

          // Step 4: Extract content if requested
          let content;
          if (extractContent) {
            const result = await Runtime.evaluate({
              expression: 'document.body.innerText',
              returnByValue: true
            });
            content = result.result.value;
          }

          // Step 5: Restore original cookies
          if (restoreOriginal) {
            // Clear current cookies
            const currentCookies = await Network.getCookies({});
            for (const cookie of currentCookies.cookies) {
              await Network.deleteCookies({ name: cookie.name, domain: cookie.domain });
            }
            // Restore original
            for (const cookie of originalCookies) {
              await Network.setCookie(cookie);
            }
          }

          return {
            success: true,
            url: url,
            cookiesSet: cookies.length,
            originalCookiesRestored: restoreOriginal,
            content: extractContent ? content : undefined,
            message: `Tested with ${cookies.length} modified cookie(s)`
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message,
            url: url
          };
        }
      }
    }
  ];
}

