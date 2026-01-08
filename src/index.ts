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

import { ChromeConnector } from './chrome-connector.js';
import { createNavigationTools } from './tools/navigation.js';
import { createInteractionTools } from './tools/interaction.js';
import { createAntiDetectionTools } from './tools/anti-detection.js';
import { createServiceWorkerTools } from './tools/service-worker.js';
import { createCaptureTools } from './tools/capture.js';
import { createSessionTools } from './tools/session.js';
import { createSystemTools } from './tools/system.js';
import { createPlaywrightLauncherTools } from './tools/playwright-launcher.js';

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
      tools: {},
    },
  }
);

// Collect all tools
const allTools = [
  ...createPlaywrightLauncherTools(connector),  // Playwright tools first (recommended)
  ...createNavigationTools(connector),
  ...createInteractionTools(connector),
  ...createAntiDetectionTools(connector),
  ...createServiceWorkerTools(connector),
  ...createCaptureTools(connector),
  ...createSessionTools(connector),
  ...createSystemTools(connector),
];

// Create tool map for quick lookup
const toolMap = new Map(allTools.map(tool => [tool.name, tool]));

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => {
      const shape: any = tool.inputSchema.shape;
      const properties: any = {};
      const required: string[] = [];
      
      for (const key in shape) {
        properties[key] = shape[key];
        if (!shape[key].isOptional || !shape[key].isOptional()) {
          required.push(key);
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
  
  const tool = toolMap.get(name);
  
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  
  try {
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
  console.error('🚀 Custom Chrome MCP Server starting...');
  console.error(`📡 CDP Port: ${PORT}`);
  console.error('');
  console.error('🎭 Playwright Integration Active!');
  console.error('   Use "launch_chrome_with_profile" to start Chrome with your profile');
  console.error('   This keeps all cookies, sessions, and extensions intact');
  console.error('');
  
  try {
    console.error('🔧 Tools available:', allTools.length);
    console.error('');
    console.error('Tool categories:');
    console.error('  - 🎭 Playwright Launcher (4 tools) - NEW!');
    console.error('  - Navigation & Tabs (8 tools)');
    console.error('  - Page Interaction (8 tools)');
    console.error('  - Anti-Detection (5 tools)');
    console.error('  - Service Workers (9 tools)');
    console.error('  - Capture & Export (5 tools)');
    console.error('  - Session & Cookies (9 tools)');
    console.error('  - System & Extensions (4 tools)');
    console.error('');
    console.error('✨ Server ready! Use launch_chrome_with_profile to start...');
    
    // Start MCP server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
  } catch (error) {
    const err = error as Error;
    console.error('❌ Failed to start server:', err.message);
    console.error('');
    console.error('💡 Server started but not connected to Chrome.');
    console.error('   Use "launch_chrome_with_profile" tool to start Chrome with Playwright');
    console.error('');
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.error('\n🛑 Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('\n🛑 Shutting down server...');
  await connector.disconnect();
  process.exit(0);
});

// Run server
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
