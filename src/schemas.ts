/**
 * Extra output schemas for the high-traffic tools.
 *
 * Most tools return a plain object; without a declared outputSchema the MCP
 * SDK only forwards it as a JSON text block. Declaring an outputSchema makes
 * the SDK validate the (non-error) result and forward typed `structuredContent`
 * to clients that support it (spec 2025-11-25+ structured tool output).
 *
 * The envelope is intentionally loose:
 *   - `success: boolean` is the only required field,
 *   - `.passthrough()` keeps every extra field the handler returns, so adding
 *     a new field to a result can never fail or silently strip data.
 *
 * ToolDefinition.outputSchema (declared next to the handler) takes precedence
 * over this map. Add entries here as tools stabilize; keep the list aligned
 * with docs/TOOLS.md.
 */

import { z } from 'zod';

/** Loose success envelope: every handler returns `success`, keeps all extras. */
function envelope(extra: z.ZodRawShape = {}): z.ZodTypeAny {
  return z.object({ success: z.boolean(), ...extra }).passthrough();
}

const common = { message: z.string().optional() };

/**
 * Tool name → output schema. `success` is required, everything else is
 * optional + passthrough so no returned field is ever lost.
 */
export const EXTRA_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  // ── Browser & session
  launch_chrome_with_profile: envelope({ cdpPort: z.number().optional(), error: z.string().optional(), ...common }),
  close_browser: envelope({ ...common }),
  get_browser_status: envelope({ connected: z.boolean().optional(), port: z.number().optional(), status: z.string().optional() }),

  // ── Profile cloning & session carry-over
  list_chrome_profiles: envelope({
    cloneRoot: z.string().optional(),
    profileCount: z.number().optional(),
    recommendedProfile: z.string().nullable().optional(),
    profiles: z
      .array(
        z
          .object({
            directory: z.string(),
            name: z.string(),
            email: z.string().nullable().optional(),
            hasSessionState: z.boolean().optional(),
            clone: z.unknown().nullable().optional(),
          })
          .passthrough()
      )
      .optional(),
    ...common,
  }),
  clone_chrome_profile: envelope({
    profileDirectory: z.string().optional(),
    cloneName: z.string().optional(),
    userDataDir: z.string().optional(),
    sessionState: z.array(z.string()).optional(),
    copiedFiles: z.number().optional(),
    warnings: z.array(z.string()).optional(),
    launched: z.boolean().optional(),
    error: z.string().optional(),
    ...common,
  }),
  sync_chrome_profile_to_real: envelope({
    copiedFiles: z.number().optional(),
    lockedFiles: z.array(z.string()).optional(),
    wroteInto: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
    ...common,
  }),
  remove_chrome_profile_clone: envelope({ removed: z.string().optional(), cloneName: z.string().optional(), error: z.string().optional(), ...common }),

  // ── Navigation & tabs
  browser_action: envelope(common),
  manage_tabs: envelope({
    count: z.number().optional(),
    tabs: z.array(z.object({ id: z.string(), title: z.string(), url: z.string() })).optional(),
    tab: z.object({ id: z.string(), url: z.string() }).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    ...common,
  }),
  wait_for_load_state: envelope(common),

  // ── Interaction & extraction
  perform_interaction: envelope(common),
  extract_element_data: envelope({ selector: z.string().optional(), text: z.string().optional(), value: z.string().optional() }),
  execute_script: envelope({ result: z.unknown().optional(), type: z.string().optional(), error: z.string().optional() }),
  fill_form: envelope({ filled: z.number().optional(), failed: z.number().optional(), submitted: z.boolean().optional() }),

  // ── Capture
  print_to_pdf: envelope({ filePath: z.string().optional(), format: z.string().optional(), ...common }),
  get_page_metrics: envelope({ metrics: z.unknown().optional() }),

  // ── Cookies & sessions
  get_cookies: envelope({ count: z.number().optional(), valuesHidden: z.boolean().optional(), cookies: z.array(z.unknown()).optional() }),
  set_cookie: envelope({ cookie: z.unknown().optional(), ...common }),
  delete_cookie: envelope({ ...common }),
  clear_cookies: envelope({ count: z.number().optional(), ...common }),
  get_local_storage: envelope({ count: z.number().optional(), storage: z.record(z.string(), z.string()).optional() }),
  export_session: envelope({ cookieCount: z.number().optional(), valuesHidden: z.boolean().optional(), ...common }),
  import_session: envelope({ imported: z.unknown().optional(), skippedCookies: z.number().optional(), ...common }),
  manage_browser_session: envelope({ operation: z.string().optional(), cookieCount: z.number().optional(), valuesHidden: z.boolean().optional(), ...common }),

  // ── Console & downloads
  get_console_logs: envelope({ capturing: z.boolean().optional(), totalBuffered: z.number().optional(), returned: z.number().optional(), logs: z.array(z.unknown()).optional() }),
  clear_console_logs: envelope({ ...common }),
  download_file: envelope({ filePath: z.string().optional(), filename: z.string().optional(), directory: z.string().optional(), ...common }),

  // ── Network (advanced)
  start_capturing_network_requests: envelope({ warning: z.string().optional(), ...common }),
  show_captured_network_traffic: envelope({ interceptedRequests: z.array(z.unknown()).optional(), count: z.number().optional() }),
  stop_capturing_network_requests: envelope({ ...common }),
  enable_response_interception: envelope({ patterns: z.array(z.string()).optional(), warning: z.string().optional(), ...common }),
  disable_response_interception: envelope({ ...common }),
  list_intercepted_responses: envelope({ count: z.number().optional(), interceptedResponses: z.array(z.unknown()).optional() }),
  modify_intercepted_response: envelope({ url: z.string().optional(), ...common }),
  create_mock_endpoint: envelope({ mock: z.unknown().optional(), ...common }),
  list_mock_endpoints: envelope({ count: z.number().optional(), mocks: z.array(z.unknown()).optional() }),
  delete_mock_endpoint: envelope({ remaining: z.number().optional(), ...common }),
  clear_all_mocks: envelope({ ...common }),
  stop_har_recording: envelope({ har: z.unknown().optional(), entriesCount: z.number().optional(), duration: z.number().optional() }),
  export_har_file: envelope({ filepath: z.string().optional(), entriesCount: z.number().optional(), fromActiveRecording: z.boolean().optional(), ...common }),
  resend_network_request: envelope({ requestUrl: z.string().optional(), requestMethod: z.string().optional(), ...common }),

  // ── Anti-detection & environment
  enable_stealth_mode: envelope({ ...common }),
  set_user_agent: envelope({ userAgent: z.string().optional(), ...common }),
  set_viewport: envelope({ viewport: z.unknown().optional(), ...common }),
  set_geolocation: envelope({ location: z.unknown().optional(), ...common }),
  set_timezone: envelope({ timezone: z.string().optional(), ...common }),

  // ── Performance
  emulate_network_conditions: envelope({ preset: z.string().optional(), ...common }),
  run_performance_audit: envelope({ webVitals: z.unknown().optional(), rating: z.unknown().optional() }),

  // ── Accessibility
  get_accessibility_tree: envelope({ totalNodes: z.number().optional(), rootNodes: z.array(z.unknown()).optional(), nodes: z.array(z.unknown()).optional() }),
  get_accessibility_snapshot: envelope({ snapshot: z.string().optional(), nodeCount: z.number().optional(), totalNodes: z.number().optional() }),

  // ── Service workers & system
  list_service_workers: envelope({ count: z.number().optional(), workers: z.array(z.unknown()).optional() }),
  get_service_worker: envelope({ worker: z.unknown().optional() }),
  list_all_targets: envelope({ total: z.number().optional(), breakdown: z.unknown().optional(), targets: z.unknown().optional() }),
};

/** All tools with a declared outputSchema (for tests + docs). */
export const TOOLS_WITH_OUTPUT_SCHEMA = Object.keys(EXTRA_OUTPUT_SCHEMAS);
