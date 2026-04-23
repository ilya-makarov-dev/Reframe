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
  type PaletteEntry,
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

type PanelComposer = (config: PanelConfig) => SceneGraph;

// ─── Composers registry ──────────────────────────────────────────
// Each entry is name → composer that accepts loosely-typed config and
// returns a SceneGraph. Validation happens inside the composer — the
// registry is type-erased so new panels can register without touching
// the central type.

const COMPOSERS: Map<string, PanelComposer> = new Map();

// brand-palette — edits active brand's color tokens with live SSE patching.
COMPOSERS.set('brand-palette', (config) => {
  const brandSlug = String(config.brandSlug ?? 'default');
  const entries = Array.isArray(config.entries)
    ? (config.entries as PaletteEntry[])
    : defaultPaletteEntries();
  return composeBrandPalettePanel({ brandSlug, entries });
});

// ─── Render API ──────────────────────────────────────────────────

export function renderPanel(name: string, config: PanelConfig): PanelRenderResult {
  const composer = COMPOSERS.get(name);
  if (!composer) {
    throw new Error(
      `Unknown panel: ${name}. Registered: ${Array.from(COMPOSERS.keys()).join(', ') || '(none)'}`,
    );
  }
  const graph = composer(config);
  ensureSceneLayout(graph, graph.rootId);
  const html = exportToHtml(graph, graph.rootId, {
    fullDocument: false,
    dataAttributes: true,
  });
  return { html, panelName: name, nodeCount: graph.nodes.size };
}

export function listRegisteredPanels(): string[] {
  return Array.from(COMPOSERS.keys());
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
