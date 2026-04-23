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
  type PaletteEntry,
  type VariantEntry,
  type DesignSystem,
} from '@reframe/core';

export interface PanelConfig {
  [key: string]: unknown;
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

type PanelComposerExt = (config: PanelConfig) => ComposedPanel;
const COMPOSERS_EXT: Map<string, PanelComposerExt> = new Map();

// brand-palette — edits active brand's color tokens with live SSE patching.
COMPOSERS_EXT.set('brand-palette', (config) => {
  const brandSlug = String(config.brandSlug ?? 'default');
  const entries = Array.isArray(config.entries)
    ? (config.entries as PaletteEntry[])
    : defaultPaletteEntries();
  const graph = composeBrandPalettePanel({ brandSlug, entries });
  const designSystem = buildMinimalDesignSystem(brandSlug, entries);
  return { graph, designSystem };
});

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

export function renderPanel(name: string, config: PanelConfig): PanelRenderResult {
  const composer = COMPOSERS_EXT.get(name);
  if (!composer) {
    throw new Error(
      `Unknown panel: ${name}. Registered: ${Array.from(COMPOSERS_EXT.keys()).join(', ') || '(none)'}`,
    );
  }
  const { graph, designSystem } = composer(config);
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
