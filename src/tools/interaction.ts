/**
 * Page Interaction Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { humanDelay, waitFor, withTimeout } from '../utils/helpers.js';
import { truncateOutput } from '../utils/truncate.js';

export function createInteractionTools(connector: ChromeConnector) {
  return [
    // Consolidated Interaction Tool
    {
      name: 'perform_interaction',
      description: '🖱️ Performs actions on page elements. ACTIONS: "click" (buttons/links), "type" (inputs/forms), "select" (dropdowns), "scroll" (page/element), "wait" (for element). COMBINES: click, type, select_option, scroll, wait_for_selector. PREREQUISITE: ALWAYS use get_html/screenshot first to verify selectors.',
      inputSchema: z.object({
        action: z.enum(['click', 'type', 'select', 'scroll', 'wait']).describe('Action to perform'),
        selector: z.string().describe('CSS selector (Required for click, type, select, wait. Optional for scroll)'),
        text: z.string().optional().describe('Text to type (Required for action="type")'),
        value: z.string().optional().describe('Value to select (Required for action="select")'),
        coordinateX: z.number().default(0).describe('X coordinate for scroll'),
        coordinateY: z.number().default(0).describe('Y coordinate for scroll'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        timeoutMs: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ action, selector, text, value, coordinateX, coordinateY, tabId, timeoutMs = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime, DOM } = client;
        
        await Runtime.enable();
        await DOM.enable();

        // 1. CLICK
        if (action === 'click') {
            if (!selector) throw new Error('Selector required for click');
            
            // Wait for selector first
            const found = await waitFor(async () => {
                const result = await Runtime.evaluate({
                    expression: `document.querySelector('${selector}') !== null`
                });
                return result.result.value === true;
            }, timeoutMs);
            if (!found) throw new Error(`Selector not found: ${selector}`);

            await humanDelay(100, 300);

            const result: any = await withTimeout(Runtime.evaluate({
                expression: `
                    (function() {
                        const el = document.querySelector('${selector}');
                        if (!el) throw new Error('Element not found');
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.click();
                        return true;
                    })()
                `,
                awaitPromise: true
            }), timeoutMs, 'Click action timed out');

            if (result.exceptionDetails) {
                 throw new Error(`Click failed: ${result.exceptionDetails.exception?.description}`);
            }
            await humanDelay();
            return { success: true, message: `Clicked ${selector}` };
        }

        // 2. TYPE
        if (action === 'type') {
            if (!selector) throw new Error('Selector required for type');
            if (text === undefined) throw new Error('Text required for type');

            const script = `
                (async function() {
                    const el = document.querySelector('${selector}');
                    if (!el) throw new Error('Element not found');
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.focus();
                    el.value = "";
                    const text = ${JSON.stringify(text)};
                    for (let char of text) {
                        el.value += char;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        await new Promise(r => setTimeout(r, Math.random() * 50 + 30));
                    }
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    return true;
                })()
            `;
            
            const result: any = await withTimeout(Runtime.evaluate({ expression: script, awaitPromise: true }), timeoutMs, 'Type action timed out');
            if (result.exceptionDetails) throw new Error(`Type failed: ${result.exceptionDetails.exception?.description}`);
            
            await humanDelay();
            return { success: true, message: `Typed "${text}" into ${selector}` };
        }

        // 3. SELECT
        if (action === 'select') {
             if (!selector) throw new Error('Selector required for select');
             if (value === undefined) throw new Error('Value required for select');

             await Runtime.evaluate({
                expression: `
                    (function() {
                        const select = document.querySelector('${selector}');
                        if (!select) throw new Error('Select element not found');
                        select.value = '${value}';
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    })()
                `
             });
             await humanDelay();
             return { success: true, message: `Selected "${value}" in ${selector}` };
        }

        // 4. SCROLL
        if (action === 'scroll') {
            const scrollScript = selector
                ? `document.querySelector('${selector}').scrollTo(${coordinateX}, ${coordinateY})`
                : `window.scrollTo(${coordinateX}, ${coordinateY})`;
            await Runtime.evaluate({ expression: scrollScript });
            await humanDelay();
            return { success: true, message: `Scrolled to ${coordinateX},${coordinateY}` };
        }

        // 5. WAIT
        if (action === 'wait') {
            if (!selector) throw new Error('Selector required for wait');
            const found = await waitFor(async () => {
                const result = await Runtime.evaluate({
                    expression: `document.querySelector('${selector}') !== null`
                });
                return result.result.value === true;
            }, timeoutMs);
            if (!found) throw new Error(`Timeout waiting for ${selector}`);
            return { success: true, message: `Element found: ${selector}` };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },

    // Consolidated Extraction Tool
    {
      name: 'extract_element_data',
      description: '📝 Extracts data from specific elements. ACTIONS: "text" (get text content), "attribute" (get html attribute like href/src). USE THIS for: scraping text, getting links, verifying content. COMBINES: get_text, get_attribute.',
      inputSchema: z.object({
        action: z.enum(['text', 'attribute']).describe('Extraction type'),
        selector: z.string().describe('CSS selector'),
        attributeName: z.string().optional().describe('Attribute name (Required for action="attribute")'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ action, selector, attributeName, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        await Runtime.enable();

        if (action === 'text') {
            const result: any = await Runtime.evaluate({
                expression: `(function() { const el = document.querySelector('${selector}'); return el ? el.textContent.trim() : null; })()`
            });
            if (result.result.value === null) throw new Error(`Element not found: ${selector}`);
            return { success: true, text: result.result.value, selector };
        }

        if (action === 'attribute') {
            if (!attributeName) throw new Error('Attribute name required');
            const result: any = await Runtime.evaluate({
                expression: `(function() { const el = document.querySelector('${selector}'); return el ? el.getAttribute('${attributeName}') : {__error: 'not found'}; })()`,
                returnByValue: true
            });
            const val = result.result.value;
            if (val && val.__error) throw new Error(`Element not found: ${selector}`);
            return { success: true, value: val, selector, attribute: attributeName };
        }

        throw new Error(`Unknown action: ${action}`);
      }
    },

    // Execute JavaScript (Kept separate as it's a "Catch-all" for advanced usage)
    {
      name: 'execute_script',
      description: '⚠️ Execute JavaScript in page. IMPORTANT: You MUST use "return" to get results. FOR ASYNC: Set awaitPromise=true. WARNING: Do NOT use fetch() for traffic replay (use resend_network_request). BEST PRACTICES: Use for complex DOM/events only.',
      inputSchema: z.object({
        script: z.string().describe('JavaScript code to execute. MUST include "return" statement.'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        awaitPromise: z.boolean().default(false).describe('Wait for promise to resolve'),
        timeoutMs: z.number().default(30000).optional().describe('Timeout in milliseconds')
      }),
      handler: async ({ script, tabId, awaitPromise, timeoutMs = 30000 }: any) => {
        try {
          // Check if script is trying to replay network requests
          if (script.includes('fetch(') && (script.includes('POST') || script.includes('method:'))) {
            return {
              success: false,
              error: 'Use resend_network_request to replay captured packets, not execute_script+fetch()',
              suggestion: 'Workflow: capture_network_on_action → copy requestId → resend_network_request({ requestId })',
              hint: 'execute_script+fetch() breaks authentication and CORS. Use the official replay tools.'
            };
          }

          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime } = client;
          await Runtime.enable();
          
          const wrappedScript = `
            (function() {
              try {
                const result = (function() { ${script} })();
                if (result === undefined || result === null) return null;
                if (typeof result === 'function') return '[Function]';
                if (result instanceof Node || result instanceof Element) return '[DOM Node]';
                return result;
              } catch (e) { return { __error: true, message: e.message }; }
            })()
          `;
          
          const result = await withTimeout(Runtime.evaluate({
            expression: wrappedScript,
            awaitPromise,
            returnByValue: true,
            userGesture: true
          }), timeoutMs, `Script execution timed out`) as any;
          
          if (result.exceptionDetails) {
            return { success: false, error: result.exceptionDetails.exception?.description || 'Error' };
          }
          
          let resultValue = result.result.value;
          if (resultValue && resultValue.__error) {
            return { success: false, error: resultValue.message };
          }

          // Handle potentially large output
          let truncatedInfo = {};
          
          if (typeof resultValue === 'string' && resultValue.length > 50000) {
            const truncated = truncateOutput(resultValue, 50000, 'text');
            resultValue = truncated.data;
            truncatedInfo = {
              truncated: true,
              originalSize: truncated.totalSize,
              warning: 'Output truncated. Use get_html for large content or specific selectors.'
            };
          }
          
          return {
            success: true,
            result: resultValue,
            type: result.result.type,
            className: result.result.className,
            ...truncatedInfo
          };
        } catch (error: any) {
          return { success: false, error: error.message };
        }
      }
    }
  ];
}
