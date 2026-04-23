// Adapter registry — in-memory map of adapter-id → handler.
//
// A single registry per runtime process. Packs/plug-ins register at
// boot time via `registerAdapter`. Workflows resolve adapter ids to
// handlers at execution time.
//
// The registry is deliberately simple: it does NOT persist to disk
// and does NOT coordinate across processes. Boot-time re-registration
// is the source of truth. This mirrors the bbx adapter pattern where
// every runtime starts with a fresh adapter table populated from the
// pack manifest + built-ins.

import type {
  AdapterHandler,
  AdapterRegistration,
  AdapterSchema,
  AdapterSchemaField,
  AdapterContext,
  AdapterResult,
} from './types.js';

const ADAPTERS = new Map<string, AdapterRegistration>();

export function registerAdapter(
  schema: AdapterSchema,
  handler: AdapterHandler,
): void {
  if (ADAPTERS.has(schema.id)) {
    // Duplicate registration — keep the LATEST so packs can override
    // built-ins by registering the same id. Packs install after
    // built-ins at boot so this path is predictable.
    // eslint-disable-next-line no-console
    console.warn(`[reframe] adapter "${schema.id}" re-registered (overriding previous)`);
  }
  ADAPTERS.set(schema.id, { schema, handler });
}

export function getAdapter(id: string): AdapterRegistration | null {
  return ADAPTERS.get(id) ?? null;
}

export function listAdapters(filter?: { kind?: string; packId?: string }): AdapterSchema[] {
  const all = Array.from(ADAPTERS.values()).map(r => r.schema);
  if (!filter) return all;
  return all.filter(s =>
    (!filter.kind || s.kind === filter.kind) &&
    (!filter.packId || s.packId === filter.packId),
  );
}

export function clearAdapters(): void {
  ADAPTERS.clear();
}

/**
 * Invoke an adapter by id. Validates inputs against the declared schema,
 * catches handler errors into AdapterResult, times the call.
 */
export async function invokeAdapter(
  id: string,
  inputs: Record<string, unknown>,
  ctx: AdapterContext = {},
): Promise<AdapterResult> {
  const reg = ADAPTERS.get(id);
  if (!reg) return { ok: false, error: `Unknown adapter: ${id}` };
  const validation = validateInputs(reg.schema, inputs);
  if (!validation.ok) return { ok: false, error: validation.error };
  const t0 = performance.now();
  try {
    const result = await reg.handler(validation.normalized, ctx);
    if (typeof result?.elapsedMs !== 'number') {
      result.elapsedMs = performance.now() - t0;
    }
    return result;
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message ?? String(e),
      elapsedMs: performance.now() - t0,
    };
  }
}

/**
 * Validate and normalize. Fills defaults, checks required fields, rejects
 * wrong types. Intentionally forgiving on extra fields — unknown inputs
 * pass through so adapter handlers can evolve without breaking schema.
 */
export function validateInputs(
  schema: AdapterSchema,
  inputs: Record<string, unknown>,
): { ok: true; normalized: Record<string, unknown> } | { ok: false; error: string } {
  const fields = schema.inputs ?? {};
  const normalized: Record<string, unknown> = { ...inputs };
  for (const [key, field] of Object.entries(fields)) {
    const provided = key in normalized;
    if (!provided) {
      if (field.required) {
        return { ok: false, error: `Missing required input "${key}" for ${schema.id}` };
      }
      if (field.default !== undefined) {
        normalized[key] = field.default;
      }
      continue;
    }
    const v = normalized[key];
    const tv = typeOf(v);
    if (tv !== field.type && !(field.type === 'number' && tv === 'string' && !isNaN(Number(v)))) {
      return {
        ok: false,
        error: `Input "${key}" for ${schema.id}: expected ${field.type}, got ${tv}`,
      };
    }
  }
  return { ok: true, normalized };
}

function typeOf(v: unknown): AdapterSchemaField['type'] | 'null' | 'undefined' {
  if (v === null) return 'null' as any;
  if (v === undefined) return 'undefined' as any;
  if (Array.isArray(v)) return 'array';
  return typeof v as any;
}

/** Pretty-print for `reframe adapters list`. */
export function formatAdapter(s: AdapterSchema): string {
  const tag = `[${s.kind}]`.padEnd(10);
  return `  ${tag} ${s.id.padEnd(32)} ${s.title}`;
}
