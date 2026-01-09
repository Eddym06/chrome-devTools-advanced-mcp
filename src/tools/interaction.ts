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
        await withTimeout(Runtime.evaluate({
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
        
        await withTimeout(Runtime.evaluate({ expression: script, awaitPromise: true }), timeout, 'Type action timed out');
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
      description: 'Extracts visible text content from any element - gets rendered text from headings, paragraphs, divs, buttons, etc. Use for web scraping, content extraction, reading page text, analyzing text content, verifying displayed text, or extracting data from pages.',
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
      description: 'Retrieves any HTML attribute value from elements - gets href from links, src from images, data attributes, IDs, classes, etc. Use for extracting URLs, analyzing page structure, getting metadata, scraping attribute data, or inspecting element properties.',
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
      description: 'Executes JavaScript code in page context. BEST PRACTICES: 1️⃣ Prefer get_html/click/type when possible (simpler & safer). 2️⃣ Use execute_script ONLY for: complex queries (querySelectorAll with map/filter), accessing window variables/functions, triggering custom events, advanced DOM manipulation. 3️⃣ ALWAYS use "return" statement to get results. EXAMPLES: return Array.from(document.querySelectorAll(".item")).map(e => e.textContent); | return window.appConfig; | Advanced scraping, data extraction, complex interactions.',
      inputSchema: z.object({
        script: z.string().describe('JavaScript code to execute'),
        tabId: z.string().optional().describe('Tab ID (optional) - MUST be a Page/Tab ID, not a Service Worker ID'),
        awaitPromise: z.boolean().default(false).describe('Wait for promise to resolve'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds')
      }),
      handler: async ({ script, tabId, awaitPromise, timeout = 30000 }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const result = await withTimeout(Runtime.evaluate({
          expression: script,
          awaitPromise,
          returnByValue: true
        }), timeout, 'Script execution timed out') as any;
        
        if (result.exceptionDetails) {
          throw new Error(`Script execution failed: ${result.exceptionDetails.text}`);
        }
        
        return {
          success: true,
          result: result.result.value
        };
      }
    },

    // Scroll
    {
      name: 'scroll',
      description: 'Scrolls webpage or specific element to position - triggers lazy-loading content, reveals hidden elements, loads infinite scroll content. Use for loading dynamic content, capturing full-page screenshots, accessing bottom sections, triggering scroll events, or navigating long pages.',
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
      description: 'Wait for an element to appear on the page',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector to wait for'),
        timeout: z.number().default(30000).describe('Timeout in milliseconds'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ selector, timeout, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const found = await waitFor(async () => {
          const result = await Runtime.evaluate({
            expression: `document.querySelector('${selector}') !== null`
          });
          return result.result.value === true;
        }, timeout);
        
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
