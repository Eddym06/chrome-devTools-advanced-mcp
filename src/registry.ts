/**
 * Tool Registry
 *
 * Pure aggregation of every tool definition the server exposes, split out
 * from index.ts so it can be unit-tested (e.g. asserting there are no
 * duplicate tool names) without booting stdio transport or touching Chrome.
 */

import type { ZodType } from 'zod';
import type { ChromeConnector } from './chrome-connector.js';

import { createSmartWorkflowTools } from './tools/smart-workflows.js';
import { createNavigationTools } from './tools/navigation.js';
import { createInteractionTools } from './tools/interaction.js';
import { createAntiDetectionTools } from './tools/anti-detection.js';
import { createServiceWorkerTools } from './tools/service-worker.js';
import { createCaptureTools } from './tools/capture.js';
import { createSessionTools } from './tools/session.js';
import { createSystemTools } from './tools/system.js';
import { createPlaywrightLauncherTools } from './tools/playwright-launcher.js';
import { createChromeProfileTools } from './tools/chrome-profiles.js';
import { createNetworkAccessibilityTools } from './tools/network-accessibility.js';
import { createAdvancedNetworkTools } from './tools/advanced-network.js';
import { createConsoleTools } from './tools/console.js';
import { createDownloadTools } from './tools/download.js';
import { createPerformanceTools } from './tools/performance.js';

export interface ToolDefinition {
  name: string;
  description: string;
  // Duck-typed to just what index.ts needs (the raw shape for
  // McpServer.registerTool) — avoids pinning to ZodObject's own generics,
  // since the SDK's zod-compat layer accepts either Zod major's schema type.
  inputSchema: { shape: Record<string, ZodType> };
  // Declared for a handful of high-traffic tools only (see server.ts) — the
  // SDK then validates every non-error return against it and forwards
  // structuredContent as typed data instead of just a JSON text blob.
  outputSchema?: { shape: Record<string, ZodType> };
  handler: (args: any) => Promise<any>;
}

export interface ToolRegistry {
  /** Always-visible tools. */
  coreTools: ToolDefinition[];
  /** Hidden until `show_advanced_tools` is called. */
  advancedTools: ToolDefinition[];
  /** The show/hide meta-tools themselves. */
  controlTools: ToolDefinition[];
}

export function buildToolRegistry(connector: ChromeConnector): ToolRegistry {
  const coreTools: ToolDefinition[] = [
    // Smart Workflows - HIGH LEVEL
    ...createSmartWorkflowTools(connector),

    // Essential browser control
    ...createPlaywrightLauncherTools(connector),
    ...createChromeProfileTools(connector),
    ...createNavigationTools(connector),

    // Basic interactions
    ...createInteractionTools(connector),
    ...createSessionTools(connector),
    ...createCaptureTools(connector),
    ...createConsoleTools(connector),
    ...createDownloadTools(connector),
  ];

  const advancedTools: ToolDefinition[] = [
    ...createNetworkAccessibilityTools(connector),
    ...createAdvancedNetworkTools(connector),
    ...createAntiDetectionTools(connector),
    ...createServiceWorkerTools(connector),
    ...createSystemTools(connector),
    ...createPerformanceTools(connector),
  ];

  return { coreTools, advancedTools, controlTools: [] };
}

/** Flattens a registry into a single list, e.g. for duplicate-name checks. */
export function allTools(registry: ToolRegistry): ToolDefinition[] {
  return [...registry.coreTools, ...registry.controlTools, ...registry.advancedTools];
}

/** Returns tool names that appear more than once across the registry. */
export function findDuplicateToolNames(registry: ToolRegistry): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tool of allTools(registry)) {
    if (seen.has(tool.name)) duplicates.add(tool.name);
    seen.add(tool.name);
  }
  return [...duplicates];
}
