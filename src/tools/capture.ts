/**
 * Screenshot and Page Capture Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';
import { truncateOutput } from '../utils/truncate.js';
import { escJS } from '../utils/helpers.js';

export function createCaptureTools(connector: ChromeConnector) {
  return [
    // Take screenshot
    {
      name: 'screenshot',
      description: 'Capture a PNG/JPEG screenshot of the full page or a specific element/area.',
      inputSchema: z.object({
        format: z.enum(['png', 'jpeg']).default('png').describe('Image format'),
        quality: z.number().min(0).max(100).default(90).describe('JPEG quality (0-100)'),
        fullPage: z.boolean().default(false).describe('Capture full page'),
        clipX: z.number().optional().describe('Clip area X coordinate'),
        clipY: z.number().optional().describe('Clip area Y coordinate'),
        clipWidth: z.number().optional().describe('Clip area width'),
        clipHeight: z.number().optional().describe('Clip area height'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ format, quality, fullPage, clipX, clipY, clipWidth, clipHeight, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        // Ensure page is rendered
        await new Promise(r => setTimeout(r, 200));

        const options: any = {
          format,
          quality: format === 'jpeg' ? quality : undefined
        };
        
        // Handle clip area or full page
        if (clipX !== undefined && clipY !== undefined && clipWidth && clipHeight) {
          options.clip = {
            x: clipX,
            y: clipY,
            width: clipWidth,
            height: clipHeight,
            scale: 1
          };
        } else if (fullPage) {
           // For robust full page screenshot, we need layout metrics
           try {
             const metrics = await Page.getLayoutMetrics();
             const cssContentSize = metrics.cssContentSize || metrics.contentSize;
             
             if (cssContentSize) {
                options.clip = {
                  x: 0,
                  y: 0,
                  width: Math.ceil(cssContentSize.width),
                  height: Math.ceil(cssContentSize.height),
                  scale: 1
                };
                options.captureBeyondViewport = true;
                options.fromSurface = true;
             } else {
                console.warn('[Screenshot] Could not get content size for full page, falling back to basic mode');
                options.captureBeyondViewport = true;
             }
           } catch (e) {
             console.error('[Screenshot] Error getting layout metrics:', e);
             options.captureBeyondViewport = true;
           }
        }
        
        // Capture screenshot with timeout
        console.error(`[Screenshot] capturing ${fullPage ? 'full page' : 'viewport'}...`);
        let screenshot;
        
        try {
           // 10 second timeout for screenshots
           const result = await new Promise<any>((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Screenshot timed out after 10s')), 10000);
              Page.captureScreenshot(options)
                .then((res: any) => {
                  clearTimeout(timeout);
                  resolve(res);
                })
                .catch((err: any) => {
                  clearTimeout(timeout);
                  reject(err);
                });
           });
           screenshot = result;
        } catch (error: any) {
           console.error('[Screenshot] Failed:', error);
           throw new Error(`Screenshot failed: ${error.message}`);
        }
        
        return {
          success: true,
          format,
          fullPage,
          data: screenshot.data,
          message: `Screenshot captured (${format}${fullPage ? ', full page' : ''})`
        };
      }
    },

    // Get page HTML
    {
      name: 'get_html',
      description: 'Extract HTML source from the page or a specific CSS selector. Output truncated at 50k chars.',
      inputSchema: z.object({
        selector: z.string().optional().describe('CSS selector to extract HTML from (e.g. "div.main-content", "#login-form"). If omitted, returns full page HTML.'),
        tabId: z.string().optional().describe('Tab ID (optional)'),
        outerHTML: z.boolean().default(true).describe('Get outer HTML (includes the element tag itself)')
      }),
      handler: async ({ selector, tabId, outerHTML }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        let expression;
        
        if (selector) {
          const safeSelector = escJS(selector);
          expression = `(function() {
            const el = document.querySelector('${safeSelector}');
            if (!el) return 'ELEMENT_NOT_FOUND';
            return ${outerHTML ? 'el.outerHTML' : 'el.innerHTML'};
          })()`;
        } else {
          expression = outerHTML 
            ? 'document.documentElement.outerHTML'
            : 'document.documentElement.innerHTML';
        }
        
        const result: any = await Runtime.evaluate({
          expression,
          returnByValue: true
        });

        if (result.exceptionDetails) {
            console.error('[Get HTML] Runtime error:', result.exceptionDetails);
            throw new Error(`Get HTML failed: ${result.exceptionDetails.exception?.description || 'Unknown runtime error'}`);
        }
        
        let htmlContent = result.result.value || '';
        
        if (htmlContent === 'ELEMENT_NOT_FOUND') {
          return {
            success: false,
            error: `Element not found: ${selector}`,
            hint: 'Check your CSS selector. Use get_html without selector to see full page structure.'
          };
        }

        const truncated = truncateOutput(htmlContent, 50000, 'html');
        
        return {
          success: true,
          selector: selector || 'full-page',
          html: truncated.data,
          size: htmlContent.length,
          ...truncated
        };
      }
    },

    // Print to PDF
    {
      name: 'print_to_pdf',
      description: 'Print the current page to PDF',
      inputSchema: z.object({
        landscape: z.boolean().default(false).describe('Landscape orientation'),
        displayHeaderFooter: z.boolean().default(false).describe('Display header/footer'),
        printBackground: z.boolean().default(true).describe('Print background graphics'),
        scale: z.number().min(0.1).max(2).default(1).describe('Scale (0.1-2)'),
        paperWidth: z.number().optional().describe('Paper width in inches'),
        paperHeight: z.number().optional().describe('Paper height in inches'),
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ landscape, displayHeaderFooter, printBackground, scale, paperWidth, paperHeight, tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const options: any = {
          landscape,
          displayHeaderFooter,
          printBackground,
          scale
        };
        
        if (paperWidth) options.paperWidth = paperWidth;
        if (paperHeight) options.paperHeight = paperHeight;
        
        const { data } = await Page.printToPDF(options);
        
        return {
          success: true,
          data,
          format: 'pdf',
          message: 'PDF generated successfully'
        };
      }
    },

    // Get page metrics
    {
      name: 'get_page_metrics',
      description: 'Get layout metrics of the page',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Page } = client;
        
        await Page.enable();
        
        const metrics = await Page.getLayoutMetrics();
        
        return {
          success: true,
          metrics: {
            contentSize: metrics.contentSize,
            layoutViewport: metrics.layoutViewport,
            visualViewport: metrics.visualViewport
          }
        };
      }
    },

    // Get accessibility tree
    {
      name: 'get_accessibility_tree',
      description: 'Get the accessibility tree of the page',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)')
      }),
      handler: async ({ tabId }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Accessibility } = client;
        
        await Accessibility.enable();
        
        const { nodes } = await Accessibility.getFullAXTree();
        
        return {
          success: true,
          nodeCount: nodes.length,
          nodes: nodes.slice(0, 100) // Limit to first 100 nodes
        };
      }
    }
  ];
}
