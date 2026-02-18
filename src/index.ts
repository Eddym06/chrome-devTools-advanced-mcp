#!/usr/bin/env node

/**
 * Custom Chrome MCP Server
 * Main entry point for the MCP server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ChromeConnector } from './chrome-connector.js';
import { createSmartWorkflowTools } from './tools/smart-workflows.js';
import { createNavigationTools } from './tools/navigation.js';
import { createInteractionTools } from './tools/interaction.js';
import { createAntiDetectionTools } from './tools/anti-detection.js';
import { createServiceWorkerTools } from './tools/service-worker.js';
import { createCaptureTools } from './tools/capture.js';
import { createSessionTools } from './tools/session.js';
import { createSystemTools } from './tools/system.js';
import { createPlaywrightLauncherTools } from './tools/playwright-launcher.js';
import { createNetworkAccessibilityTools } from './tools/network-accessibility.js';
import { createAdvancedNetworkTools } from './tools/advanced-network.js';

// Parse command line arguments
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.split('=')[1]) : 9222;

// Initialize Chrome connector
const connector = new ChromeConnector(PORT);

// Create MCP server
const server = new Server(
  {
    name: 'custom-chrome-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
  }
);

// Category-based tool activation system
let advancedToolsEnabled = false;

// Core tools (always visible)
const coreTools = [
  // Smart Workflows - HIGH LEVEL
  ...createSmartWorkflowTools(connector),
  
  // Essential browser control
  ...createPlaywrightLauncherTools(connector),
  ...createNavigationTools(connector),
  
  // Basic interactions
  ...createInteractionTools(connector),
  ...createSessionTools(connector),
  ...createCaptureTools(connector),
];

// Advanced tools (hidden by default, activated on demand)
const advancedTools = [
  ...createNetworkAccessibilityTools(connector),
  ...createAdvancedNetworkTools(connector),
  ...createAntiDetectionTools(connector),
  ...createServiceWorkerTools(connector),
  ...createSystemTools(connector),
];

// Tool to enable advanced features
const controlTools: any[] = [
  {
    name: 'show_advanced_tools',
    description: 'Unlock advanced tools: network interception, request replay, API mocking, WebSocket monitoring, HAR recording, accessibility, anti-detection, service workers, and more.',
    inputSchema: z.object({}),
    handler: async (): Promise<any> => {
      advancedToolsEnabled = true;
      
      // Send notification to update tool list
      try {
        await server.notification({
          method: 'notifications/tools/list_changed',
          params: {}
        });
        console.error('[MCP] Tool list update notification sent');
      } catch (e) {
        console.error('[MCP] Could not send notification:', (e as Error).message);
      }
      
      return {
        success: true,
        message: 'Advanced tools unlocked',
        newToolsCount: advancedTools.length,
        categories: [
          'Network Request/Response Interception',
          'API Mocking & WebSocket Monitoring', 
          'HAR Recording & Replay',
          'Accessibility Tree Inspection',
          'Anti-Detection & Stealth Mode',
          'Service Worker Control',
          'Global Script/CSS Injection'
        ]
      };
    }
  },
  {
    name: 'hide_advanced_tools',
    description: 'Hide advanced tools to simplify the tool list. Call show_advanced_tools to unlock them again.',
    inputSchema: z.object({}),
    handler: async () => {
      advancedToolsEnabled = false;
      
      try {
        await server.notification({
          method: 'notifications/tools/list_changed',
          params: {}
        });
      } catch (e) {
        console.error('[MCP] Could not send notification:', (e as Error).message);
      }
      
      return {
        success: true,
        message: 'Advanced tools hidden',
        visibleToolsCount: coreTools.length + controlTools.length
      };
    }
  }
];

// Dynamic tool list based on activation state
function getActiveTools() {
  if (advancedToolsEnabled) {
    return [...coreTools, ...controlTools, ...advancedTools];
  }
  return [...coreTools, ...controlTools];
}

// Create tool map for quick lookup (includes ALL tools)
const allToolsMap = new Map([
  ...coreTools,
  ...controlTools,
  ...advancedTools
].map(tool => [tool.name, tool]));

// Helper to convert Zod schema to JSON Schema property
function zodTypeToJsonSchema(schema: any): any {
  if (!schema) return { type: 'string' };
  
  let current = schema;
  let description = current.description;
  let defaultValue: any = undefined;

  // Unwrap Optional/Default/Effects wrappers and collect metadata
  while (
    current._def.typeName === 'ZodOptional' || 
    current._def.typeName === 'ZodDefault' ||
    current._def.typeName === 'ZodEffects'
  ) {
    if (current.description) description = current.description;
    
    if (current._def.typeName === 'ZodDefault') {
        defaultValue = current._def.defaultValue();
    }
    
    if (current._def.typeName === 'ZodEffects') {
      current = current._def.schema;
    } else {
      current = current._def.innerType;
    }
  }
  
  // If we still haven't found a description on the wrappers, check the inner type
  if (!description && current.description) {
    description = current.description;
  }
  
  const def = current._def;
  let type = 'string'; // Default fallback
  const jsonSchema: any = {};
  
  if (description) {
    jsonSchema.description = description;
  }
  
  if (defaultValue !== undefined) {
      jsonSchema.default = defaultValue;
  }
  
  switch (def.typeName) {
    case 'ZodString':
      type = 'string';
      break;
    case 'ZodNumber':
      type = 'number';
      break;
    case 'ZodBoolean':
      type = 'boolean';
      break;
    case 'ZodEnum':
      type = 'string';
      jsonSchema.enum = def.values;
      break;
    case 'ZodArray':
      type = 'array';
      jsonSchema.items = zodTypeToJsonSchema(def.type);
      break;
    case 'ZodNativeEnum':
      type = 'string';
      // Basic support for numeric enums or string enums
      jsonSchema.enum = Object.values(def.values);
      break;
  }
  
  jsonSchema.type = type;
  return jsonSchema;
}

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const activeTools = getActiveTools();
  return {
    tools: activeTools.map(tool => {
      // Cast to any to access Zod shape
      const shape: any = (tool.inputSchema as any).shape;
      const properties: any = {};
      const required: string[] = [];
      
      if (shape) {
        for (const key in shape) {
          const zodSchema = shape[key];
          properties[key] = zodTypeToJsonSchema(zodSchema);
          
          // Check if required
          let isOptional = false;
          let current = zodSchema;
          
          // Unwrap to check strict optionality
          while (
            current._def.typeName === 'ZodOptional' || 
            current._def.typeName === 'ZodDefault' ||
            current._def.typeName === 'ZodEffects'
          ) {
             if (current._def.typeName === 'ZodOptional' || current._def.typeName === 'ZodDefault') {
               isOptional = true;
             }
             
             if (current._def.typeName === 'ZodEffects') {
               current = current._def.schema;
             } else {
               current = current._def.innerType;
             }
          }
          
          if (!isOptional) {
            required.push(key);
          }
        }
      }
      
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
      };
    }),
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  console.error(`[Tool] ${name}`);
  
  const tool = allToolsMap.get(name);
  
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  
  try {
    // Auto-connect: ensure Chrome is available before tool execution
    // Some tools don't need Chrome to be running
    const noConnectionNeeded = [
      'show_advanced_tools', 
      'hide_advanced_tools',
      'get_browser_status',
      'close_browser'
    ];
    
    if (!noConnectionNeeded.includes(name)) {
      try {
        await connector.ensureConnected();
      } catch (e) {
        const err = e as Error;
        console.error('[Auto-connect] Failed:', err.message);
        
        // Return error to user instead of proceeding
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Chrome connection failed',
                details: err.message,
                tool: name,
                hint: 'Chrome will auto-launch on tool use. If you see this error, Chrome may have failed to launch. Try: 1) Close all Chrome windows and retry, 2) Check if port 9222 is available, 3) Use launch_edge_with_profile as alternative'
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    }

    // Validate arguments with Zod
    const validatedArgs = tool.inputSchema.parse(args || {});
    
    // Execute tool handler
    const result = await tool.handler(validatedArgs);
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const err = error as Error;
    
    // Return error in a structured format
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: err.message,
            tool: name,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  console.error('[MCP] Custom Chrome MCP Server starting...');
  console.error(`[MCP] CDP Port: ${PORT}`);
  console.error(`[MCP] ${coreTools.length + controlTools.length} core tools | ${advancedTools.length} advanced (hidden)`);
  console.error('[MCP] Chrome will auto-launch on first tool use');
  
  try {
    
    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
  } catch (error) {
    const err = error as Error;
    console.error('[MCP] Failed to start server:', err.message);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.error('\n[MCP] Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n[MCP] Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

// Run server
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
