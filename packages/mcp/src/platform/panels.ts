/**
 * Panel registry — server-side lookup from panel name to INode composer.
 *
 * A panel is a reusable, agent-operable UI surface rendered through the
 * reframe engine (NOT hand-written HTML). Same exporter as user scenes,
 * same Block A primitives. The registry lets HTTP / MCP callers mount
 * a panel by name + config; the composer returns a SceneGraph that's
 * compiled and shipped to the browser as HTML with `data-gesture-*`
 * attrs wired up.
 *
 * Add a panel:
 *   1. Write a composer that returns SceneGraph — see
 *      `@reframe/core/src/panels/brand-palette.ts` for the pattern.
 *   2. Register it here under a kebab-case name.
 *   3. Agents can now mount it via /platform/api/panel-mount
 *      or `reframe_ui action=mount panel=<name>`.
 *
 * This registry is the seam between knowledge layer (skills that know
 * what panel fits a task) and render layer (engine that composes).
 */

import {
  SceneGraph,
  ensureSceneLayout,
  exportToHtml,
  composeBrandPalettePanel,
  composeVariantPickerPanel,
  composeBrandGalleryPanel,
  composeInspectorPanel,
  parseDesignMd,
  type PaletteEntry,
  type VariantEntry,
  type GalleryColorEntry,
  type GalleryTypographyEntry,
  type InspectorTarget,
  type DesignSystem,
} from '@reframe/core';
import { loadBrandFromProject, loadProject } from '../../../core/src/project/io.js';

export interface PanelConfig {
  [key: string]: unknown;
}

export interface PanelContext {
  /** Active project dir — lets composers load real brand DESIGN.md from disk. */
  projectDir?: string;
}

export interface PanelRenderResult {
  /** Compiled HTML ready to inject into a mount-slot container. */
  html: string;
  /** Panel name — echoed so the client can de-dupe / track mounts. */
  panelName: string;
  /** Node count in the composed graph — useful for perf telemetry. */
  nodeCount: number;
}

// ─── Composers registry ──────────────────────────────────────────
// Each entry is name → composer that accepts loosely-typed config and
// returns a composed panel (SceneGraph + optional DesignSystem for token
// binding). Validation happens inside the composer — the registry is
// type-erased so new panels can register without touching the central type.

interface ComposedPanel {
  graph: SceneGraph;
  /** Optional DesignSystem passed to the exporter so nodes with
   *  `meta.tokenBindings` emit `var(--color-<role>)` + a :root var block.
   *  Required for the Phase 1 token:changed SSE fast-path to visibly repaint. */
  designSystem?: DesignSystem;
}

type PanelComposerExt = (config: PanelConfig, ctx: PanelContext) => ComposedPanel;
const COMPOSERS_EXT: Map<string, PanelComposerExt> = new Map();

// brand-palette — edits active brand's color tokens with live SSE patching.
// Resolution order for entries (first hit wins):
//   1. config.entries — explicit PaletteEntry[] (agent pre-populated)
//   2. (ctx.projectDir + config.brandSlug) — load real DESIGN.md from disk
//   3. demo defaults — when no project / unknown slug / parse error
COMPOSERS_EXT.set('brand-palette', (config, ctx) => {
  const brandSlug = String(config.brandSlug ?? 'default');
  const entries = resolvePaletteEntries(config, ctx, brandSlug);
  const graph = composeBrandPalettePanel({ brandSlug, entries });
  const designSystem = buildMinimalDesignSystem(brandSlug, entries);
  return { graph, designSystem };
});

// inspector — selected-node inspector: identity + intent + geometry +
// token bindings (with swap-role pills) + audit issues + action row.
// Brand-locked: no per-node color/font/spacing pickers — those live in
// brand-palette. Inspector edits STRUCTURE + SEMANTICS, brand stays
// authoritative.
//
// Target resolution (Phase 4.0):
//   1. config.target — explicit InspectorTarget (agent pre-computed)
//   2. (config.sceneId + config.nodeId) — look up node in live scene
//      store, build InspectorTarget from graph state + audit. This is
//      the path the canvas selection listener takes — just send
//      { sceneId, nodeId } and the composer does the resolution.
//   3. Nothing → empty-state panel
COMPOSERS_EXT.set('inspector', (config, ctx) => {
  const sceneId = typeof config.sceneId === 'string' ? config.sceneId : undefined;
  const nodeId = typeof config.nodeId === 'string' ? config.nodeId : undefined;
  const explicitTarget = config.target as InspectorTarget | null | undefined;
  const target = explicitTarget ?? (sceneId && nodeId ? resolveInspectorTarget(sceneId, nodeId) : null);

  const explicitRoles = Array.isArray(config.availableRoles) ? (config.availableRoles as string[]) : undefined;
  const brandSlug = typeof config.brandSlug === 'string' ? config.brandSlug : activeBrandOf(ctx.projectDir);
  // Derive role palette from active brand if caller didn't supply one —
  // makes the inspector work out-of-the-box in the right-panel.
  const availableRoles = explicitRoles ?? inferAvailableRoles(ctx.projectDir, brandSlug);
  const graph = composeInspectorPanel({ target, sceneId, availableRoles });
  // Panel chrome doesn't use tokenBindings (solid hex surfaces); but we
  // still pass DesignSystem so pill colors could extend to var(--color-*)
  // if needed by future iterations.
  const designSystem = loadDesignSystem(ctx.projectDir, brandSlug) ?? undefined;
  return { graph, designSystem };
});

function resolveInspectorTarget(sceneId: string, nodeId: string): InspectorTarget | null {
  try {
    // Lazy import to avoid cyclic init — store imports io, io imports
    // types — keeping this inside the function makes module-load cheap.
    const { getScene } = require('../store.js');
    const stored = getScene(sceneId);
    if (!stored) return null;
    const node = stored.graph.getNode(nodeId);
    if (!node) return null;

    const tokenBindings: Array<{ field: 'fill' | 'stroke' | 'fontSize' | 'fontFamily' | 'cornerRadius'; role: string }> = [];
    const meta = (node as any).meta ?? {};
    const tb = meta.tokenBindings ?? {};
    for (const field of ['fill', 'stroke', 'fontSize', 'fontFamily', 'cornerRadius'] as const) {
      if (typeof tb[field] === 'string' && tb[field]) {
        tokenBindings.push({ field, role: tb[field] });
      }
    }

    return {
      id: node.id,
      name: node.name ?? '(unnamed)',
      type: String(node.type),
      semanticPath: (node as any).semanticPath ?? '',
      semanticRole: (node as any).semanticRole ?? null,
      intent: (node as any).intent ?? null,
      bbox: {
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 0,
        height: node.height ?? 0,
      },
      tokenBindings,
      // Audit issues — left empty for now; Phase 4.0 scope just needs
      // the panel to mount with correct identity. Audit enrichment is
      // Phase 4.0.1 (separate bench — run audit, find issues touching
      // this node, include them). Shape is ready; data supplier isn't.
      auditIssues: [],
    };
  } catch { return null; }
}

function inferAvailableRoles(projectDir: string | undefined, brandSlug: string | undefined): string[] {
  const ds = loadDesignSystem(projectDir, brandSlug);
  if (!ds) return [];
  return Array.from(ds.colors.roles.keys()).slice(0, 12);
}

// brand-gallery — FULL self-host of /platform/design-system. Visualizes
// the active brand's palette + typography + radius scale as one INode
// tree. Zero hand-written HTML remains in the page renderer (Phase 3.1).
// Export-DTCG button uses the client-side `browser.download` pseudo-tool
// — no server roundtrip needed for a pure download trigger.
COMPOSERS_EXT.set('brand-gallery', (config, ctx) => {
  const explicitBrand = typeof config.brandSlug === 'string' ? config.brandSlug : undefined;
  const brandSlug = explicitBrand ?? activeBrandOf(ctx.projectDir);
  const designSystem = loadDesignSystem(ctx.projectDir, brandSlug);
  const colors: GalleryColorEntry[] = designSystem
    ? Array.from(designSystem.colors.roles.entries()).map(([role, hex]) => ({ role, hex }))
    : [];
  const typography: GalleryTypographyEntry[] = designSystem
    ? (designSystem.typography.hierarchy ?? []).map(t => ({
        role: t.role,
        fontSize: t.fontSize,
        fontWeight: t.fontWeight,
        fontFamily: t.fontFamily,
      }))
    : [];
  const graph = composeBrandGalleryPanel({
    brand: designSystem?.brand,
    brandSlug,
    colors,
    typography,
    primaryFont: designSystem?.typography.primaryFont,
    secondaryFont: designSystem?.typography.secondaryFont,
    radiusScale: designSystem?.layout?.borderRadiusScale,
  });
  return { graph, designSystem: designSystem ?? undefined };
});

function activeBrandOf(projectDir: string | undefined): string | undefined {
  if (!projectDir) return undefined;
  try {
    const manifest = loadProject(projectDir);
    return manifest.activeBrand;
  } catch { return undefined; }
}

function loadDesignSystem(projectDir: string | undefined, brandSlug: string | undefined): DesignSystem | null {
  if (!projectDir || !brandSlug) return null;
  try {
    const loaded = loadBrandFromProject(projectDir, brandSlug);
    if (!loaded) return null;
    return parseDesignMd(loaded.content);
  } catch { return null; }
}

// variant-picker — offer N variants of a target section with click-to-apply.
// When `variants` is absent, ships a demo set so the panel is inspectable
// without waiting for a full engine-side variant generator to land.
COMPOSERS_EXT.set('variant-picker', (config) => {
  const sceneId = typeof config.sceneId === 'string' ? config.sceneId : undefined;
  const targetPath = typeof config.targetPath === 'string' ? config.targetPath : undefined;
  const variants = Array.isArray(config.variants)
    ? (config.variants as VariantEntry[])
    : defaultVariants(sceneId, targetPath);
  const graph = composeVariantPickerPanel({ sceneId, targetPath, variants });
  return { graph };
});

function resolvePaletteEntries(config: PanelConfig, ctx: PanelContext, brandSlug: string): PaletteEntry[] {
  if (Array.isArray(config.entries)) return config.entries as PaletteEntry[];
  if (ctx.projectDir && brandSlug && brandSlug !== 'default') {
    try {
      const loaded = loadBrandFromProject(ctx.projectDir, brandSlug);
      if (loaded) {
        const ds = parseDesignMd(loaded.content);
        const entries = designSystemToPaletteEntries(ds);
        if (entries.length > 0) return entries;
      }
    } catch { /* fall through to defaults */ }
  }
  return defaultPaletteEntries();
}

/**
 * DesignSystem → PaletteEntry list. Picks the canonical role set first
 * (primary / background / surface / text / muted / accent) in that order
 * so the most important colors show at the top of the panel, then
 * appends any additional roles the brand defines (for brands with
 * richer palettes like Ferrari's ~12 roles). Caps at 10 entries to keep
 * the panel under the right-panel's height budget.
 */
function designSystemToPaletteEntries(ds: DesignSystem): PaletteEntry[] {
  const CANONICAL_ORDER = ['primary', 'background', 'surface', 'text', 'muted', 'accent'];
  const roles = ds.colors?.roles;
  if (!roles || roles.size === 0) return [];
  const out: PaletteEntry[] = [];
  const seen = new Set<string>();
  for (const role of CANONICAL_ORDER) {
    const hex = roles.get(role);
    if (hex) {
      out.push({ tokenName: `color.${role}`, hex, label: humanizeRole(role) });
      seen.add(role);
    }
  }
  for (const [role, hex] of roles) {
    if (seen.has(role)) continue;
    if (out.length >= 10) break;
    out.push({ tokenName: `color.${role}`, hex, label: humanizeRole(role) });
  }
  return out;
}

function humanizeRole(role: string): string {
  return role
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function defaultVariants(sceneId?: string, targetPath?: string): VariantEntry[] {
  // Demo variants — real production use supplies them via config. Each
  // apply gesture routes through the MCP bridge (dispatchAgentGesture)
  // which forwards to reframe_edit with the concrete args.
  const baseArgs = (variantId: string) => ({
    op: 'applyVariant',
    sceneId: sceneId ?? '',
    targetPath: targetPath ?? '',
    variantId,
  });
  return [
    { id: 'default',  label: 'Default',  description: 'Current design',
      colorStrip: ['#0B0B13', '#635BFF', '#FFFFFF', '#9B9BA5'],
      apply: { tool: 'reframe_edit', args: baseArgs('default') } },
    { id: 'editorial', label: 'Editorial', description: 'Serif display · asymmetric grid',
      colorStrip: ['#FBF7F2', '#1A1510', '#C4553A', '#6B7A62'],
      apply: { tool: 'reframe_edit', args: baseArgs('editorial') } },
    { id: 'brutalist', label: 'Brutalist', description: 'Stark type · raw blocks',
      colorStrip: ['#000000', '#FFFFFF', '#FFFF00', '#FF0000'],
      apply: { tool: 'reframe_edit', args: baseArgs('brutalist') } },
    { id: 'nocturne', label: 'Nocturne', description: 'Low-light · cinematic contrast',
      colorStrip: ['#0A0A0F', '#1B1B26', '#A78BFA', '#64748B'],
      apply: { tool: 'reframe_edit', args: baseArgs('nocturne') } },
  ];
}

function buildMinimalDesignSystem(brand: string, entries: PaletteEntry[]): DesignSystem {
  const roles = new Map<string, string>();
  for (const e of entries) {
    const role = e.tokenName.replace(/^color\./, '');
    roles.set(role, e.hex);
  }
  return {
    brand,
    colors: { roles },
    typography: { hierarchy: [] },
    components: {} as any,
    layout: {} as any,
    responsive: {} as any,
  };
}

// ─── Render API ──────────────────────────────────────────────────

export function renderPanel(name: string, config: PanelConfig, ctx: PanelContext = {}): PanelRenderResult {
  const composer = COMPOSERS_EXT.get(name);
  if (!composer) {
    throw new Error(
      `Unknown panel: ${name}. Registered: ${Array.from(COMPOSERS_EXT.keys()).join(', ') || '(none)'}`,
    );
  }
  const { graph, designSystem } = composer(config, ctx);
  ensureSceneLayout(graph, graph.rootId);
  const html = exportToHtml(graph, graph.rootId, {
    fullDocument: false,
    dataAttributes: true,
    // Passing DesignSystem unlocks the Phase 3b token-var codepath — nodes
    // with meta.tokenBindings emit `var(--color-<role>)` + a :root block.
    // Critical for live repaint via the token:changed SSE fast-path.
    designSystem,
  });
  return { html, panelName: name, nodeCount: graph.nodes.size };
}

export function listRegisteredPanels(): string[] {
  return Array.from(COMPOSERS_EXT.keys());
}

// ─── Defaults ────────────────────────────────────────────────────

function defaultPaletteEntries(): PaletteEntry[] {
  return [
    { tokenName: 'color.primary',    hex: '#635BFF', label: 'Primary' },
    { tokenName: 'color.background', hex: '#0B0B13', label: 'Background' },
    { tokenName: 'color.surface',    hex: '#14141C', label: 'Surface' },
    { tokenName: 'color.text',       hex: '#FFFFFF', label: 'Text' },
    { tokenName: 'color.muted',      hex: '#9B9BA5', label: 'Muted' },
    { tokenName: 'color.accent',     hex: '#FF5A1F', label: 'Accent' },
  ];
}
