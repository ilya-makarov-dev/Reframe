// compilePanel — the bridge from a .panel.html artifact + runtime config
// to a live SceneGraph.
//
// Why this exists: panel composers written in TS are fine for the 9
// ship-in-core defaults, but every new panel after those requires a code
// push. The artifact format flips that — panels become HTML on disk,
// authored by the agent or the user, hot-reloadable.
//
// This file is deliberately tiny. Heavy lifting (Tailwind preprocessing,
// stable-id derivation, audit rules) lives in importFromHtml already —
// we feed it resolved HTML and return the same result shape.

import { importFromHtml, type HtmlImportResult } from '../importers/html.js';
import { resolveBindings, type PanelConfig } from './panel-bindings.js';

export interface CompilePanelOptions {
  /** Panel name — surfaced as the scene name and audit context. */
  name?: string;
  /** Runtime config resolved against data-bind-* attrs + {path} tokens. */
  config?: PanelConfig;
  /** Default viewport width when the artifact's root has no inline width. */
  width?: number;
  /** Default viewport height. */
  height?: number;
  /** Stable id derivation — required for hot-reload so selection/edits survive a remount. */
  stableIds?: boolean;
}

export interface CompilePanelResult extends HtmlImportResult {
  /** Final HTML after bindings resolve — useful for debug / diff / preview. */
  resolvedHtml: string;
}

/**
 * Compile a panel artifact (HTML + config) into a SceneGraph.
 *
 * Pipeline:
 *   1. Resolve data-bind-each / data-bind-text / data-bind-attr + {path}
 *      tokens against the runtime config.
 *   2. Hand the resulting plain HTML to the standard importer.
 *
 * The returned graph carries the same interaction substrate (gestures,
 * intent roles, mount slots, semantic paths) as any other scene, because
 * those attributes pass through verbatim from the artifact source.
 */
export async function compilePanel(
  html: string,
  options: CompilePanelOptions = {},
): Promise<CompilePanelResult> {
  const resolvedHtml = await resolveBindings(html, options.config ?? {});
  const result = await importFromHtml(resolvedHtml, {
    name: options.name ?? 'Panel',
    width: options.width ?? 320,
    height: options.height ?? 600,
    stableIds: options.stableIds ?? true,
  });
  return { ...result, resolvedHtml };
}
