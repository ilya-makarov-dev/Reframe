// Adapter bindings — wrap existing reframe tools / panels / hooks as
// first-class adapters registered with @reframe/core/adapter.
//
// This is the seam between the legacy imperative API (`reframe_compile`,
// `reframe_edit op=vary`, panel composers) and the unified adapter
// contract. Workflows (`.rfx.yml`) call adapters; MCP tools CAN also
// call adapters via `reframe_workflow.invokeAdapter` (future). For
// now the legacy MCP tools stay as-is and we mirror them here.
//
// Naming convention:
//   reframe.compile        — wraps reframe_compile (HTML → scene + audit)
//   reframe.audit          — scene → audit report
//   reframe.edit.<op>      — wraps reframe_edit ops (vary, applyVariant, ...)
//   reframe.export.<fmt>   — wraps reframe_export (html, react, svg, pdf, video)
//   reframe.project.load   — project load
//   panel.<name>           — wraps renderPanelAsync for a registered panel
//   brand.setToken         — wraps the SSE-broadcasting token setter
//   browser.navigate       — already a client-side tool
//
// Every adapter is registered once at runtime boot. The registry is
// idempotent (last registration wins), so packs can override.

import { registerAdapter } from '../../../core/src/adapter/registry.js';
import type { AdapterHandler } from '../../../core/src/adapter/types.js';

/**
 * Lazy-loading handler — wraps a module function that's heavy to import.
 * Keeps registration cheap at boot; only pays the import cost on first call.
 */
function lazyHandler(loader: () => Promise<AdapterHandler>): AdapterHandler {
  let cached: AdapterHandler | null = null;
  return async (inputs, ctx) => {
    if (!cached) cached = await loader();
    return cached(inputs, ctx);
  };
}

export function registerBuiltinAdapters(): void {
  // ─── reframe.compile ──────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.compile',
      title: 'Compile HTML → scene',
      description: 'Import HTML into an INode scene graph. Runs audit + auto-fix. Returns sceneId + audit result.',
      kind: 'tool',
      inputs: {
        html: { type: 'string', description: 'HTML source to compile' },
        file: { type: 'string', description: 'Alternatively, path to HTML file on disk' },
        name: { type: 'string', description: 'Scene name / slug' },
        width: { type: 'number', default: 1440 },
        height: { type: 'number', default: 900 },
      },
      outputs: {
        sceneId: { type: 'string' },
        nodeCount: { type: 'number' },
        auditPass: { type: 'boolean' },
      },
    },
    lazyHandler(async () => {
      const { handleCompile } = await import('../tools/compile.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleCompile({
            html: inputs.html,
            file: inputs.file,
            name: inputs.name ?? 'workflow',
            width: inputs.width ?? 1440,
            height: inputs.height ?? 900,
          } as any);
          // MCP tool returns { content: [...] }; adapter output shape normalizes.
          const text = res?.content?.[0]?.text ?? '';
          const sceneMatch = text.match(/scene(?:Id)?[=:]?\s*([a-z0-9_-]+)/i);
          return {
            ok: true,
            output: {
              sceneId: sceneMatch?.[1] ?? '',
              raw: text,
            },
          };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── reframe.inspect ──────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.inspect',
      title: 'Inspect scene — audit + tree + metrics',
      description: 'Run the 37-rule audit + 8 aesthetic metrics against a scene. Returns issues, score, brand fidelity.',
      kind: 'tool',
      inputs: {
        sceneId: { type: 'string', required: true },
        aesthetic: { type: 'boolean', default: false },
      },
      outputs: { raw: { type: 'string' } },
    },
    lazyHandler(async () => {
      const { handleInspect } = await import('../tools/inspect.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleInspect({ sceneId: inputs.sceneId, aesthetic: !!inputs.aesthetic } as any);
          return { ok: true, output: { raw: res?.content?.[0]?.text ?? '' } };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── reframe.edit ─────────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.edit',
      title: 'Mutate scene — update/add/delete/clone/vary/…',
      description: 'Dispatches any reframe_edit op (update, add, delete, clone, resize, move, defineTokens, setMode, scaleSpacing, scaleRadius, rotateColors, typographyPreset, iterate, adapt, vary, addBlock).',
      kind: 'tool',
      inputs: {
        sceneId: { type: 'string', required: true },
        op: { type: 'string', required: true, description: 'Op name (vary, update, defineTokens, …)' },
        // op-specific fields are passed through untyped
      },
      outputs: { raw: { type: 'string' } },
    },
    lazyHandler(async () => {
      const { handleEdit } = await import('../tools/edit.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleEdit(inputs as any);
          return { ok: true, output: { raw: res?.content?.[0]?.text ?? '' } };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── reframe.export ───────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.export',
      title: 'Export scene to html / react / svg / png / pdf / lottie / video',
      description: 'Serializes a compiled scene to one of seven formats. Writes to disk + returns path.',
      kind: 'tool',
      inputs: {
        sceneId: { type: 'string', required: true },
        format: { type: 'string', required: true, description: 'html | react | svg | png | pdf | lottie | video' },
        out: { type: 'string', description: 'Optional output path' },
      },
      outputs: { path: { type: 'string' }, raw: { type: 'string' } },
    },
    lazyHandler(async () => {
      const { handleExport } = await import('../tools/export.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleExport(inputs as any);
          const text = res?.content?.[0]?.text ?? '';
          const pathMatch = text.match(/\b([./\w-]+\.(html|tsx|svg|png|pdf|json|mp4))\b/);
          return {
            ok: true,
            output: { path: pathMatch?.[1] ?? '', raw: text },
          };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── reframe.project ──────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.project',
      title: 'Project lifecycle — init / load / save / list',
      description: 'Wraps reframe_project operations (init, open, save, load, list, status).',
      kind: 'tool',
      inputs: {
        action: { type: 'string', required: true },
      },
      outputs: { raw: { type: 'string' } },
    },
    lazyHandler(async () => {
      const { handleProject } = await import('../tools/project.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleProject(inputs as any);
          return { ok: true, output: { raw: res?.content?.[0]?.text ?? '' } };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── reframe.design ───────────────────────────────────────────
  registerAdapter(
    {
      id: 'reframe.design',
      title: 'Brand / DESIGN.md — list / extract / load',
      description: 'Wraps reframe_design: list brands, extract a brand by slug, or load a DESIGN.md.',
      kind: 'tool',
      inputs: {
        action: { type: 'string', required: true },
        brand: { type: 'string' },
        search: { type: 'string' },
      },
      outputs: { raw: { type: 'string' } },
    },
    lazyHandler(async () => {
      const { handleDesign } = await import('../tools/design.js');
      return async (inputs: any) => {
        try {
          const res: any = await handleDesign(inputs as any);
          return { ok: true, output: { raw: res?.content?.[0]?.text ?? '' } };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── panel.<name> ─────────────────────────────────────────────
  registerAdapter(
    {
      id: 'panel.render',
      title: 'Render a registered panel to HTML',
      description: 'Compose any registered panel (code composer OR disk artifact) against config; returns compiled HTML.',
      kind: 'panel',
      inputs: {
        name: { type: 'string', required: true, description: 'Panel name (brand-palette, inspector, scene-card, …)' },
        config: { type: 'object', default: {} },
        raw: { type: 'boolean', default: false, description: 'Skip INode compile — return resolved HTML only' },
      },
      outputs: { html: { type: 'string' }, nodeCount: { type: 'number' } },
    },
    lazyHandler(async () => {
      const { renderPanelAsync } = await import('./panel-registry.js');
      return async (inputs: any, ctx) => {
        try {
          const cfg: Record<string, unknown> = { ...(inputs.config ?? {}) };
          if (inputs.raw) (cfg as any).__raw = true;
          const r = await renderPanelAsync(inputs.name, cfg, { projectDir: ctx.projectDir });
          return { ok: true, output: { html: r.html, nodeCount: r.nodeCount, panel: r.panelName } };
        } catch (e: any) {
          return { ok: false, error: e?.message ?? String(e) };
        }
      };
    }),
  );

  // ─── browser.<action> ─────────────────────────────────────────
  // Declared for discovery even though they execute client-side.
  registerAdapter(
    {
      id: 'browser.navigate',
      title: 'Navigate the active browser to a path',
      description: 'Client-side navigation. Runs on the dispatcher; no server round-trip.',
      kind: 'browser',
      inputs: { path: { type: 'string', required: true } },
    },
    async () => ({ ok: true, output: { dispatched: true } }),
  );
  registerAdapter(
    {
      id: 'browser.download',
      title: 'Trigger a browser download',
      description: 'Client-side <a download> synthesis. Zero network latency.',
      kind: 'browser',
      inputs: {
        url: { type: 'string', required: true },
        filename: { type: 'string' },
      },
    },
    async () => ({ ok: true, output: { dispatched: true } }),
  );
  registerAdapter(
    {
      id: 'browser.reload',
      title: 'Reload the active browser page',
      description: 'Client-side hard reload; discards in-memory state but keeps the session.',
      kind: 'browser',
    },
    async () => ({ ok: true, output: { dispatched: true } }),
  );
}

// Side-effect registration on import — the runtime calls this once
// during sidecar boot, via http-server.ts (see bootstrap below).
registerBuiltinAdapters();
