/**
 * Screenshot and Page Capture Tools
 */

import { z } from 'zod';
import type { ChromeConnector } from '../chrome-connector.js';

export function createCaptureTools(connector: ChromeConnector) {
  return [
    // Take screenshot
    {
      name: 'screenshot',
      description: '📸 Visual page analysis tool - captures PNG/JPEG screenshots. WHEN TO USE: 1️⃣ BEFORE interactions - analyze page layout visually to find buttons/forms. 2️⃣ AFTER actions - verify results visually. 3️⃣ When HTML is too complex to parse. 4️⃣ Visual debugging of UI issues. WORKFLOW: navigate → screenshot → analyze visually → identify elements → interact. Use for: visual testing, documentation, monitoring UI, capturing proof, creating thumbnails.',
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
        
        const options: any = {
          format,
          quality: format === 'jpeg' ? quality : undefined
        };
        
        // Handle clip area
        if (clipX !== undefined && clipY !== undefined && clipWidth && clipHeight) {
          options.clip = {
            x: clipX,
            y: clipY,
            width: clipWidth,
            height: clipHeight,
            scale: 1
          };
        }
        
        // Capture screenshot
        let screenshot;
        if (fullPage) {
          screenshot = await Page.captureScreenshot({
            ...options,
            captureBeyondViewport: true
          });
        } else {
          screenshot = await Page.captureScreenshot(options);
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
      description: '🔍 CRITICAL ANALYSIS TOOL - extracts complete HTML source code. ⚠️ USE THIS FIRST BEFORE ANY INTERACTION! PROPER WORKFLOW: 1️⃣ navigate → 2️⃣ get_html (analyze structure) → 3️⃣ identify selectors from HTML (buttons: button.submit, inputs: input#email, links: a.nav-link) → 4️⃣ THEN click/type with verified selectors. NEVER guess selectors! Get HTML returns: element IDs, classes, button text, input names, form structure, links. Essential for: web scraping, finding correct selectors, analyzing page structure.',
      inputSchema: z.object({
        tabId: z.string().optional().describe('Tab ID (optional)'),
        outerHTML: z.boolean().default(true).describe('Get outer HTML (includes <html> tag)')
      }),
      handler: async ({ tabId, outerHTML }: any) => {
        await connector.verifyConnection();
        const client = await connector.getTabClient(tabId);
        const { Runtime } = client;
        
        await Runtime.enable();
        
        const expression = outerHTML 
          ? 'document.documentElement.outerHTML'
          : 'document.documentElement.innerHTML';
        
        const result = await Runtime.evaluate({
          expression,
          returnByValue: true
        });
        
        return {
          success: true,
          html: result.result.value,
          size: result.result.value.length
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
