// Adapter contract — the common shape every reframe operation exposes.
//
// Inspired by bbx's adapter model (bbx-main, 2025): every primitive
// operation is a discoverable unit with typed inputs, typed outputs,
// a capability declaration, and a synchronous-ish handler. The bbx
// insight is that when you formalize EVERY operation as an adapter —
// compile, audit, vary, export, even panel-mount — workflows become
// composable and packs become standard-interfaced.
//
// In reframe, adapters are the unified abstraction behind:
//   - MCP tools (reframe_compile, reframe_edit, reframe_export, ...)
//   - Panel composers (brand-palette, inspector, scene-card, ...)
//   - Hooks (audit, autofix, accessibility-check, ...)
//   - External MCP calls (agent delegates to another MCP server)
//
// A workflow `.rfx.yml` is a DAG of adapter invocations.

export type AdapterKind =
  | 'tool'        // reframe_compile, reframe_edit, reframe_export — does work
  | 'panel'       // brand-palette, scene-card, inspector — renders UI
  | 'hook'        // audit, autofix — pre/post injection
  | 'source'      // brands, scenes — enumerates content
  | 'mcp'         // external MCP server proxied through this registry
  | 'browser';    // browser.navigate, browser.download — client-side pseudo

/**
 * Semver-like compat band. "^1.0" means "works with kernel 1.x".
 */
export type KernelCompat = string;

export interface AdapterSchemaField {
  /** JSON-Schema type. Kept minimal on purpose. */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Short description for docs + agent-discovery tools. */
  description?: string;
  /** Default when omitted. */
  default?: unknown;
  /** When true the runner must have this field or refuse to start. */
  required?: boolean;
  /** For array types, the item schema. */
  items?: AdapterSchemaField;
  /** For object types, a shallow field map. */
  properties?: Record<string, AdapterSchemaField>;
}

export interface AdapterSchema {
  /** Identifier: `<namespace>.<verb>` — e.g. `reframe.compile`, `brand.apply`. */
  id: string;
  /** Human-readable label for UI discovery. */
  title: string;
  /** Long description — text the agent reads when deciding whether to call. */
  description: string;
  /** Classification — how the runtime treats the adapter (queue, render, etc). */
  kind: AdapterKind;
  /** Kernel compatibility. Mismatched adapters warn at registration. */
  kernel?: KernelCompat;
  /** Input schema. */
  inputs?: Record<string, AdapterSchemaField>;
  /** Output schema (best-effort — documents what the handler returns). */
  outputs?: Record<string, AdapterSchemaField>;
  /**
   * Declared capabilities — other adapters the handler may call. Used
   * for dependency resolution + permissions (pack can declare it only
   * needs `reframe.compile`, nothing else).
   */
  capabilities?: string[];
  /** Which pack shipped this adapter (filled at registration time). */
  packId?: string;
}

/**
 * Handler signature. `ctx` carries runtime state (projectDir, store,
 * event bus, etc) so adapter code doesn't have to reach out to
 * globals. `inputs` is the validated-against-schema payload.
 */
export interface AdapterContext {
  projectDir?: string;
  /** Named outputs from prior workflow steps. */
  outputs?: Record<string, unknown>;
  /** Free-form runtime data bag (store, events, sidecar refs). */
  runtime?: Record<string, unknown>;
}

export type AdapterHandler = (
  inputs: Record<string, unknown>,
  ctx: AdapterContext,
) => Promise<AdapterResult> | AdapterResult;

export interface AdapterResult {
  ok: boolean;
  /** Present when ok=true. Shape matches `schema.outputs`. */
  output?: Record<string, unknown>;
  /** Present when ok=false. Human-readable cause. */
  error?: string;
  /** Telemetry: how long the handler took (ms). */
  elapsedMs?: number;
  /** Telemetry: what secondary adapters were called (for DAG tracing). */
  calls?: string[];
}

export interface AdapterRegistration {
  schema: AdapterSchema;
  handler: AdapterHandler;
}
