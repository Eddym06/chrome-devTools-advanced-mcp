/**
 * Page Interaction Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { humanDelay, waitFor, withTimeout } from '../utils/helpers.js';

export function createInteractionTools(connector: ChromeConnector) {
  return [
    // Click element
    {
      name: 'click',
      description: '⚠️ CRITICAL WORKFLOW: BEFORE clicking, ALWAYS use get_html or screenshot FIRST to analyze page and identify correct selectors. NEVER guess selectors blindly. | Click/press/tap on any element (button, link, checkbox, etc.) using CSS selector. PROPER WORKFLOW: 1️⃣ navigate to page → 2️⃣ get_html to see available elements → 3️⃣ identify correct CSS selector from HTML → 4️⃣ THEN click with verified selector. Use when user says "click button", "press submit", "tap link".',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of element to click'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        waitForSelector: z.boolean().default(true).describe('Wait for selector to be visible'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ selector, tabId, waitForSelector, timeout = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime, DOM } = client;
        
        await Runtime.enable();
        await DOM.enable();
        
        // Wait for selector if requested
        if (waitForSelector) {
          const found = await waitFor(async () => {
            const result = await Runtime.evaluate({
              expression: `document.querySelector('${selector}') !== null`
            });
            return result.result.value === true;
          }, timeout);
          
          if (!found) {
            throw new Error(`Selector not found: ${selector} (timeout ${timeout}ms)`);
          }
        }
        
        // Add human-like delay
        await humanDelay(100, 300);
        
        // Click the element
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
        }), timeout, 'Click action timed out');
        
        if (result.exceptionDetails) {
            console.error('[Click] Runtime error:', result.exceptionDetails);
            throw new Error(`Click failed: ${result.exceptionDetails.exception?.description || 'Unknown runtime error'}`);
        }
        
        await humanDelay();
        
        return {
          success: true,
          message: `Clicked on element: ${selector}`
        };
      }
    },

    // Type text
    {
      name: 'type',
      description: '⚠️ PREREQUISITE: Use get_html FIRST to identify input field selectors. | Type/write/enter text into input fields, textboxes, search boxes, textareas. PROPER WORKFLOW: 1️⃣ get_html to find input elements → 2️⃣ identify selector (input#email, textarea.message) → 3️⃣ type text → 4️⃣ optionally press Enter. Use when user says "type in search box", "enter text", "write in field", "fill form".',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of input element'),
        text: z.string().describe('Text to type'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        clearFirst: z.boolean().default(true).describe('Clear existing text first'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ selector, text, tabId, clearFirst, timeout = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        // Type with human-like delays
        const script = `
          (async function() {
            const el = document.querySelector('${selector}');
            if (!el) throw new Error('Element not found');
            
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.focus();
            
            ${clearFirst ? 'el.value = "";' : ''}
            
            // Simulate typing with delays
            const text = ${JSON.stringify(text)};
            for (let char of text) {
              el.value += char;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              await new Promise(r => setTimeout(r, ${Math.random() * 50 + 30}));
            }
            
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          })()
        `;
        
        const result: any = await withTimeout(Runtime.evaluate({ expression: script, awaitPromise: true }), timeout, 'Type action timed out');
        
        if (result.exceptionDetails) {
            console.error('[Type] Runtime error:', result.exceptionDetails);
            throw new Error(`Type failed: ${result.exceptionDetails.exception?.description || 'Unknown runtime error'}`);
        }

        await humanDelay();
        
        return {
          success: true,
          message: `Typed text into: ${selector}`
        };
      }
    },

    // Get text content
    {
      name: 'get_text',
      description: '📝 Extracts visible text from elements. USE THIS WHEN: 1️⃣ Verifying click/action worked (check if new text appeared). 2️⃣ Scraping content (articles, prices, names). 3️⃣ Reading dynamic text loaded after interaction. 4️⃣ Confirming success/error messages. PREREQUISITE: Run get_html first to identify correct selector. Returns: Rendered text only (no HTML tags). Use for: content verification, web scraping, text analysis.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of element'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ selector, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: `
            (function() {
              const el = document.querySelector('${selector}');
              if (!el) return null;
              return el.textContent.trim();
            })()
          `
        });
        
        if (result.result.value === null) {
          throw new Error(`Element not found: ${selector}`);
        }
        
        return {
          success: true,
          text: result.result.value,
          selector
        };
      }
    },

    // Get attribute
    {
      name: 'get_attribute',
      description: '🔍 Retrieves HTML attribute values from elements. USE THIS WHEN: 1️⃣ Getting link URLs (href from <a> tags). 2️⃣ Getting image sources (src from <img>). 3️⃣ Getting data attributes (data-id, data-value). 4️⃣ Getting element IDs/classes for verification. 5️⃣ Checking disabled/readonly states. WORKFLOW: get_html → identify element → get_attribute(selector, "href"). Common attributes: href, src, id, class, data-*, alt, title, value, disabled.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of element'),
        attribute: z.string().describe('Attribute name to get'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ selector, attribute, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await Runtime.evaluate({
          expression: `
            (function() {
              const el = document.querySelector('${selector}');
              if (!el) return null;
              return el.getAttribute('${attribute}');
            })()
          `
        });
        
        return {
          success: true,
          value: result.result.value,
          selector,
          attribute
        };
      }
    },

    // Execute JavaScript
    {
      name: 'execute_script',
      description: 'Executes JavaScript code in page context. BEST PRACTICES: 1️⃣ Prefer get_html/click/type when possible (simpler & safer). 2️⃣ Use execute_script ONLY for: complex queries (querySelectorAll with map/filter), accessing window variables/functions, triggering custom events, advanced DOM manipulation. 3️⃣ ALWAYS use "return" statement to get results. 4️⃣ Return simple values (strings, numbers, arrays, plain objects) - NOT DOM nodes or Handles. EXAMPLES: return Array.from(document.querySelectorAll(".item")).map(e => e.textContent); | return window.appConfig; | return document.title;',
      inputSchema: z.object({
        script: z.string().describe('JavaScript code to execute. MUST include "return" statement for results. Return serializable values only (no DOM nodes).'),
        tabId: z.string().optional().describe('Tab ID (optional) - MUST be a Page/Tab ID, not a Service Worker ID'),
        awaitPromise: z.boolean().default(false).describe('Wait for promise to resolve'),
        timeoutMs: z.number().default(30000).optional().describe('Timeout in milliseconds (default: 30000). AI should specify based on script complexity: simple queries 5000ms, complex operations 30000ms, heavy computations 60000ms.')
      }),
      handler: async ({ script, tabId, awaitPromise, timeoutMs = 30000 }: any) => {
        try {
          await connector.verifyConnection();
          const client = await connector.getTabClient(tabId);
          const { Runtime } = client;
          
          await Runtime.enable();
          
          // Wrap script to ensure it returns serializable values
          const wrappedScript = `
            (function() {
              try {
                const result = (function() {
                  ${script}
                })();
                
                // Ensure result is serializable
                if (result === undefined) return null;
                if (result === null) return null;
                if (typeof result === 'function') return '[Function]';
                if (result instanceof Node || result instanceof Element) {
                  return '[DOM Node - use get_text or get_attribute instead]';
                }
                
                return result;
              } catch (e) {
                return { __error: true, message: e.message, stack: e.stack };
              }
            })()
          `;
          
          const result = await withTimeout(Runtime.evaluate({
            expression: wrappedScript,
            awaitPromise,
            returnByValue: true,
            userGesture: true
          }), timeoutMs, `Script execution timed out after ${timeoutMs}ms`) as any;
          
          // Check for evaluation exceptions
          if (result.exceptionDetails) {
            const errorMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown error';
            return {
              success: false,
              error: `Script execution failed: ${errorMsg}`,
              exceptionDetails: result.exceptionDetails
            };
          }
          
          // Check for wrapped error
          const resultValue = result.result.value;
          if (resultValue && resultValue.__error) {
            return {
              success: false,
              error: `Script error: ${resultValue.message}`,
              stack: resultValue.stack
            };
          }
          
          return {
            success: true,
            result: resultValue
          };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || 'Script execution failed',
            suggestion: 'Ensure: 1) Script has return statement, 2) Returns serializable values (not DOM nodes), 3) Page is loaded, 4) TabId is correct'
          };
        }
      }
    },

    // Scroll
    {
      name: 'scroll',
      description: '⬇️ Scrolls page/element to position. USE THIS WHEN: 1️⃣ Target element below fold (need to scroll to make visible). 2️⃣ Lazy-loading content (scroll triggers image/content load). 3️⃣ Infinite scroll pages (scroll down loads more items). 4️⃣ Taking full-page screenshot (scroll to bottom first). 5️⃣ Content not visible in viewport. TRIGGERS: "scroll down", "load more content", "see bottom of page". Common: scroll(0, 9999) for bottom, scroll(0, 0) for top.',
      inputSchema: z.object({
        x: z.number().default(0).describe('Horizontal scroll position'),
        y: z.number().optional().describe('Vertical scroll position'),
        selector: z.string().optional().describe('CSS selector to scroll (scrolls window if not provided)'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ x, y, selector, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const scrollScript = selector
          ? `document.querySelector('${selector}').scrollTo(${x}, ${y || 0})`
          : `window.scrollTo(${x}, ${y || 0})`;
        
        await Runtime.evaluate({ expression: scrollScript });
        await humanDelay();
        
        return {
          success: true,
          message: `Scrolled to position (${x}, ${y || 0})`
        };
      }
    },

    // Wait for selector
    {
      name: 'wait_for_selector',
      description: '⏱️ Waits for element to appear in DOM. USE THIS WHEN: 1️⃣ After click, waiting for modal/popup to appear. 2️⃣ After form submit, waiting for success message. 3️⃣ After AJAX load, waiting for new content. 4️⃣ Click triggers animation/transition. WORKFLOW: click → wait_for_selector → THEN interact with new element. TIMEOUT: Set based on expected load time (fast: 5000ms, normal: 15000ms, slow: 30000ms). Prevents "element not found" errors by waiting for dynamic content.',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector to wait for'),
        timeoutMs: z.number().default(30000).optional().describe('Timeout in milliseconds (default: 30000). AI should set: quick animations 5000ms, normal loads 15000ms, slow APIs 30000ms.'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ selector, timeoutMs = 30000, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const found = await waitFor(async () => {
          const result = await Runtime.evaluate({
            expression: `document.querySelector('${selector}') !== null`
          });
          return result.result.value === true;
        }, timeoutMs);
        
        if (!found) {
          throw new Error(`Timeout waiting for selector: ${selector}`);
        }
        
        return {
          success: true,
          message: `Element found: ${selector}`
        };
      }
    },

    // Select option
    {
      name: 'select_option',
      description: 'Select an option from a dropdown',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector of select element'),
        value: z.string().describe('Value to select'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ selector, value, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
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
        
        return {
          success: true,
          message: `Selected option "${value}" in ${selector}`
        };
      }
    }
  ];
}
