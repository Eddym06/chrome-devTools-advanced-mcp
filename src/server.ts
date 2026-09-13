/**
 * Server assembly: wires the tool registry into an McpServer instance.
 * Split out from index.ts so it can be integration-tested (via
 * InMemoryTransport) without touching stdio or process lifecycle.
 */

import { McpServer, type RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ChromeConnector } from './chrome-connector.js';
import { buildToolRegistry, findDuplicateToolNames, type ToolDefinition } from './registry.js';
import { deriveAnnotations } from './tool-annotations.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { withTimeout } from './utils/helpers.js';
import { EXTRA_OUTPUT_SCHEMAS } from './schemas.js';
import { clearActiveProgress, protocolLog, setActiveProgress, setLogSink } from './utils/log.js';

// Backstop so a hung CDP call can never leave an MCP request pending forever.
const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

// ── Optional user-confirmation gate for destructive tools ────────────────
// Full MCP elicitation (spec 2025-11-25) requires client support that most
// current hosts do not announce yet, so this ships a conservative, protocol-
// safe gate instead: when CHROME_MCP_CONFIRM=on, sensitive tools refuse to run
// unless the caller passes `_confirm: true` (the calling agent must have
// asked the user first). Default off = current behavior unchanged.
const CONFIRM_MODE = (process.env.CHROME_MCP_CONFIRM || 'off').toLowerCase();
const REQUIRES_CONFIRM = new Set<string>([
  'close_browser',
  'clear_cookies',
  'delete_cookie',
  'clear_local_storage',
  'import_session',
  'unregister_service_worker',
  'clear_all_mocks',
  'clear_all_injections',
  'remove_injection',
  // Writes into / deletes profile data on disk.
  'sync_chrome_profile_to_real',
  'remove_chrome_profile_clone',
]);

function confirmationRequired(toolName: string, args: any): boolean {
  if (CONFIRM_MODE !== 'on') return false;
  if (!REQUIRES_CONFIRM.has(toolName)) return false;
  if (args && typeof args === 'object' && (args as { _confirm?: boolean })._confirm === true) return false;
  return true;
}

export interface PackageInfo {
  name: string;
  version: string;
}

export function createServer(connector: ChromeConnector, pkg: PackageInfo): McpServer {
  const server = new McpServer(
    { name: pkg.name, version: pkg.version },
    { capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } } }
  );

  // Standardized MCP logging (server → client logging/message notifications).
  setLogSink((params) => {
    void server.sendLoggingMessage(params).catch(() => { /* client gone / not negotiated */ });
  });

  const registry = buildToolRegistry(connector);

  // Regression guard for the "two tools registered under the same name"
  // class of bug (one silently shadows the other). Fail fast at startup
  // instead of at first ambiguous tool call.
  const duplicates = findDuplicateToolNames(registry);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate tool name(s) registered: ${duplicates.join(', ')}`);
  }

  function registerTool(tool: ToolDefinition): RegisteredTool {
    const { title, ...annotations } = deriveAnnotations(tool.name);

    // Per-tool declarations (next to the handler) win; the shared map covers
    // the rest of the high-traffic tools.
    const outputSchema = tool.outputSchema?.shape ?? EXTRA_OUTPUT_SCHEMAS[tool.name];

    return server.registerTool(
      tool.name,
      {
        title,
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        ...(outputSchema ? { outputSchema: outputSchema as any } : {}),
        annotations,
      },
      async (toolArgs: any) => {
        // Optional destructive-tool confirmation gate (CHROME_MCP_CONFIRM=on).
        if (confirmationRequired(tool.name, toolArgs)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: 'Confirmation required',
                    tool: tool.name,
                    instruction:
                      `"${tool.name}" changes or removes browser/user state. Ask the user for explicit ` +
                      `confirmation first; if they agree, re-invoke with the extra argument "_confirm": true.`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Progress: if the client asked for out-of-band progress on this call
        // (spec `_meta.progressToken`), long-running handlers can call
        // reportProgress() and the client sees live updates.
        const progressToken =
          toolArgs && typeof toolArgs === 'object' ? (toolArgs._meta as { progressToken?: string | number } | undefined)?.progressToken : undefined;
        const reporter =
          progressToken === undefined
            ? null
            : (progress: number, total?: number, message?: string) =>
                (server.server.notification as any)({
                  method: 'notifications/progress',
                  params: { progressToken, progress, total, message },
                });
        setActiveProgress(progressToken, reporter);
        try {
          await reporter?.(0, 100, `${tool.name} started`);
          const result = await withTimeout(
            tool.handler(toolArgs),
            DEFAULT_TOOL_TIMEOUT_MS,
            `Tool "${tool.name}" timed out after ${DEFAULT_TOOL_TIMEOUT_MS / 1000}s`
          );
          await reporter?.(100, 100, `${tool.name} finished`);
          protocolLog('debug', 'tool', { tool: tool.name, ok: true });

          // Pass through structured content whenever the handler returned a
          // plain object, so clients that understand it can skip re-parsing
          // the JSON text block. No outputSchema is declared per-tool (would
          // mean hand-writing ~90 schemas), so this is best-effort/unvalidated.
          const structuredContent =
            result && typeof result === 'object' && !Array.isArray(result) ? result : undefined;

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            ...(structuredContent ? { structuredContent } : {}),
          };
        } catch (error) {
          const err = error as Error;
          protocolLog('error', 'tool', { tool: tool.name, error: err.message });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: err.message, tool: tool.name }, null, 2),
              },
            ],
            isError: true,
          };
        } finally {
          clearActiveProgress();
        }
      }
    );
  }

  // Core tools: always visible.
  for (const tool of registry.coreTools) {
    registerTool(tool);
  }

  // Advanced tools: registered up front but disabled, so `show_advanced_tools`
  // only has to flip `.enabled` (the SDK emits `notifications/tools/list_changed`
  // for us) instead of us re-deriving the tool list from a boolean flag.
  const advancedRegistered: RegisteredTool[] = registry.advancedTools.map(registerTool);
  for (const t of advancedRegistered) t.disable();

  server.registerTool(
    'show_advanced_tools',
    {
      title: 'Show Advanced Tools',
      description:
        'Unlock advanced tools: network interception, request replay, API mocking, WebSocket monitoring, ' +
        'HAR recording, accessibility, anti-detection, service workers, and more.',
      inputSchema: {},
      annotations: stripTitle(deriveAnnotations('show_advanced_tools')),
    },
    async () => {
      for (const t of advancedRegistered) t.enable();
      const payload = {
        success: true,
        message: 'Advanced tools unlocked',
        newToolsCount: advancedRegistered.length,
        categories: [
          'Network Request/Response Interception',
          'API Mocking & WebSocket Monitoring',
          'HAR Recording & Replay',
          'Accessibility Tree Inspection',
          'Anti-Detection & Stealth Mode',
          'Service Worker Control',
          'Global Script/CSS Injection',
        ],
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    'hide_advanced_tools',
    {
      title: 'Hide Advanced Tools',
      description: 'Hide advanced tools to simplify the tool list. Call show_advanced_tools to unlock them again.',
      inputSchema: {},
      annotations: stripTitle(deriveAnnotations('hide_advanced_tools')),
    },
    async () => {
      for (const t of advancedRegistered) t.disable();
      const payload = {
        success: true,
        message: 'Advanced tools hidden',
        visibleToolsCount: registry.coreTools.length + 2,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  registerResources(server, connector);
  registerPrompts(server);

  return server;
}

function stripTitle<T extends { title: string }>(annotations: T): Omit<T, 'title'> {
  const { title: _title, ...rest } = annotations;
  return rest;
}
