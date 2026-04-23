// Library grid panel — generic "title + lead + card grid" shape used by
// /platform/components and /platform/macros. Both pages render N cards
// with name + description + meta caption; some cards are links (components),
// some fire an apply action (macros). One composer, two registrations.
//
// Built on Phase 4.5 helpers so sizing + spacing is uniform.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture } from '../engine/types';
import {
  buildPanel, buildSection, buildGrid, buildText,
  solidFill, solidStroke, intent, PANEL_COLORS,
} from './helpers';

export interface LibraryEntry {
  name: string;
  description?: string;
  meta?: string;
  /** Link URL (components cards) OR onClick gesture (macros). At most one. */
  href?: string;
  onClick?: AgentGesture;
}

export interface LibraryGridOptions {
  title: string;
  lead?: string;
  emptyText?: string;
  entries: LibraryEntry[];
  width?: number;
  /** Role namespace prefix — 'components' or 'macros'. */
  role?: string;
}

export function composeLibraryGridPanel(opts: LibraryGridOptions): SceneGraph {
  const width = opts.width ?? 1280;
  const roleNs = opts.role ?? 'library';
  const graph = new SceneGraph();
  const root = buildPanel(graph, {
    name: roleNs,
    width,
    role: `${roleNs}/root`,
    background: { r: 0.98, g: 0.965, b: 0.94 },
    padding: 40,
    itemSpacing: 24,
  });

  // Header
  const header = buildSection(graph, {
    parent: root,
    name: 'header',
    width: width - 80,
    role: `${roleNs}/header`,
    itemSpacing: 8,
  });
  buildText(graph, {
    parent: header, name: 'title', text: opts.title, style: 'title',
    width: width - 80, role: `${roleNs}/title`, color: 'SURFACE_BG',
  });
  if (opts.lead) {
    buildText(graph, {
      parent: header, name: 'lead', text: opts.lead, style: 'body',
      width: width - 80, role: `${roleNs}/lead`,
    });
  }

  // Empty state
  if (opts.entries.length === 0) {
    buildText(graph, {
      parent: root,
      name: 'empty',
      text: opts.emptyText ?? 'Nothing here yet.',
      style: 'caption',
      width: width - 80,
      role: `${roleNs}/empty`,
    });
    return graph;
  }

  // Card grid
  const grid = buildGrid(graph, {
    parent: root,
    name: 'grid',
    width: width - 80,
    role: `${roleNs}/grid`,
  });
  for (const entry of opts.entries) {
    composeLibraryCard(graph, grid, entry, roleNs);
  }

  return graph;
}

function composeLibraryCard(graph: SceneGraph, parent: any, entry: LibraryEntry, roleNs: string): void {
  const cardWidth = 280;
  const cardProps: any = {
    name: entry.name,
    width: cardWidth,
    cornerRadius: 10,
    fills: solidFill({ r: 1, g: 1, b: 1, a: 1 }),
    ...solidStroke({ r: 0.89, g: 0.88, b: 0.84 }, 1),
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: 16, paddingBottom: 16, paddingLeft: 18, paddingRight: 18,
    itemSpacing: 8,
    semanticRole: 'link',
    focusable: true,
    intent: intent(`${roleNs}/card`, `Library card ${entry.name}`, 'both'),
  };
  if (entry.href) {
    cardProps.href = entry.href;
    cardProps.onClick = { tool: 'browser.navigate', args: { url: entry.href }, fastPath: 'local-state' };
  } else if (entry.onClick) {
    cardProps.onClick = entry.onClick;
  }
  const card = graph.createNode('FRAME' as any, parent.id, cardProps);

  buildText(graph, {
    parent: card, name: 'name', text: entry.name, style: 'body-strong',
    width: cardWidth - 36, role: `${roleNs}/card-name`, color: 'SURFACE_BG',
  });
  if (entry.description) {
    buildText(graph, {
      parent: card, name: 'description', text: entry.description, style: 'caption',
      width: cardWidth - 36, role: `${roleNs}/card-desc`,
    });
  }
  if (entry.meta) {
    buildText(graph, {
      parent: card, name: 'meta', text: entry.meta, style: 'mono-small',
      width: cardWidth - 36, role: `${roleNs}/card-meta`,
    });
  }
}
