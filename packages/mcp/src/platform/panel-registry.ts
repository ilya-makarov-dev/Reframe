// Disk-backed panel registry (Phase 6.2).
//
// Panel artifacts live in <projectDir>/.reframe/ui/*.panel.html. Each file
// is a panel whose source of truth is HTML + data-bind-* markup; they are
// compiled on mount via `compilePanel` (from @reframe/core/ui-artifacts).
//
// This module:
//   1. Scans the UI directory on startup and caches name → html source.
//   2. Exposes renderPanelFromArtifact() which composes + exports to HTML.
//   3. Exposes renderPanelAsync() — the unified entry point: checks the
//      artifact cache first, falls back to the sync in-code registry.
//   4. Watches the directory (chokidar) for add / change / unlink events
//      and emits panel:catalog-changed SSE so connected clients remount
//      any open mounts of affected panels.
//
// Artifact panels intentionally re-use every piece of the user-scene
// pipeline: same linkedom parser, same Tailwind preprocessor, same Block A
// exporter. That is the whole point of Phase 6 — the UI and the scenes
// run through one compiler, and the agent writes either kind the same way.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Import compilePanel from source — @reframe/core is the dist build and
// won't carry Phase 6 exports until a rebuild. Other mcp modules use the
// same pattern (see agent-runtime's findNodeByPath import).
import { compilePanel } from '../../../core/src/ui-artifacts/compile-panel.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { renderPanel, type PanelConfig, type PanelContext, type PanelRenderResult, listRegisteredPanels } from './panels.js';

const ARTIFACT_SUFFIX = '.panel.html';

interface ArtifactEntry {
  name: string;
  path: string;
  html: string;
}

/** name → raw HTML source cache, keyed per projectDir. */
const ARTIFACT_CACHE: Map<string, Map<string, ArtifactEntry>> = new Map();

function uiDir(projectDir: string): string {
  return join(projectDir, '.reframe', 'ui');
}

function artifactNameFromFile(file: string): string | null {
  if (!file.endsWith(ARTIFACT_SUFFIX)) return null;
  return file.slice(0, -ARTIFACT_SUFFIX.length);
}

/**
 * Load every .panel.html from:
 *   1. `.reframe/packs/panel/<name>/*.panel.html`   — first-class packs
 *   2. `.reframe/ui/*.panel.html`                   — legacy loose artifacts
 *
 * Packs WIN on name clash with loose artifacts, which in turn win on
 * name clash with ship-in-core panel composers. Safe to call repeatedly.
 */
export function loadPanelArtifacts(projectDir: string): string[] {
  const entries = new Map<string, ArtifactEntry>();

  // 1. Pack panels — `.reframe/packs/panel/<name>/*.panel.html`
  const packsPanelDir = join(projectDir, '.reframe', 'packs', 'panel');
  if (existsSync(packsPanelDir)) {
    for (const packName of readdirSync(packsPanelDir)) {
      const packDir = join(packsPanelDir, packName);
      try {
        for (const file of readdirSync(packDir)) {
          const name = artifactNameFromFile(file);
          if (!name) continue;
          const full = join(packDir, file);
          try {
            const html = readFileSync(full, 'utf-8');
            entries.set(name, { name, path: full, html });
          } catch { /* skip */ }
        }
      } catch { /* not a dir */ }
    }
  }

  // 2. Loose artifacts — legacy-friendly. Only filled where pack version absent.
  const looseDir = uiDir(projectDir);
  if (existsSync(looseDir)) {
    for (const file of readdirSync(looseDir)) {
      const name = artifactNameFromFile(file);
      if (!name) continue;
      if (entries.has(name)) continue; // pack wins
      const full = join(looseDir, file);
      try {
        const html = readFileSync(full, 'utf-8');
        entries.set(name, { name, path: full, html });
      } catch { /* skip */ }
    }
  }

  ARTIFACT_CACHE.set(projectDir, entries);
  return Array.from(entries.keys());
}

/** Raw HTML source for an artifact — used by reframe_ui_author diff/list. */
export function getArtifactSource(projectDir: string, name: string): string | undefined {
  return ARTIFACT_CACHE.get(projectDir)?.get(name)?.html;
}

/** All artifact names currently cached for a project. */
export function listArtifactPanels(projectDir: string): string[] {
  const bucket = ARTIFACT_CACHE.get(projectDir);
  return bucket ? Array.from(bucket.keys()) : [];
}

/**
 * Compose an artifact panel → compiled HTML ready for injection.
 *
 * Mirrors the shape of renderPanel() from panels.ts so the transport
 * layer (panel-mount HTTP handler, MCP tool) doesn't branch on "is it
 * code or artifact".
 *
 * When `raw: true` is passed in config, the INode compile + export
 * roundtrip is skipped — only the bindings (data-bind-each / text /
 * attr + {path}) are resolved. Use raw mode for FULL-VIEWPORT shells
 * whose CSS flex layout is best-understood by the browser natively;
 * Yoga's auto-sizing treats "width:100%; height:100vh" as ambiguous
 * and collapses the root to the first child's width.
 */
export async function renderPanelFromArtifact(
  projectDir: string,
  name: string,
  config: PanelConfig,
): Promise<PanelRenderResult> {
  const entry = ARTIFACT_CACHE.get(projectDir)?.get(name);
  if (!entry) throw new Error(`Unknown artifact panel: ${name}`);

  if ((config as any).__raw === true) {
    const { resolveBindings } = await import('@reframe/core');
    const html = await resolveBindings(entry.html, config);
    // Rough node count — same order of magnitude as INode export.
    const nodeCount = (html.match(/<(?!\/)/g) ?? []).length;
    return { html, panelName: name, nodeCount };
  }

  const { graph, rootId } = await compilePanel(entry.html, {
    name,
    config,
    stableIds: true,
    // Artifacts typically self-size via inline styles on their root;
    // pass a generous default so the importer doesn't clamp invisibly.
    width: 320,
    height: 600,
  });
  ensureSceneLayout(graph, rootId);
  const html = exportToHtml(graph, rootId, {
    fullDocument: false,
    dataAttributes: true,
  });
  return { html, panelName: name, nodeCount: graph.nodes.size };
}

export interface RenderPanelAsyncCtx extends PanelContext {
  /** When set, artifact cache is consulted in addition to the in-code registry. */
  projectDir?: string;
}

/**
 * Unified render entry. Try artifact first (panel wins on name clash —
 * lets authors override a shipped core panel with a disk variant), then
 * fall back to the sync in-code composer.
 */
export async function renderPanelAsync(
  name: string,
  config: PanelConfig,
  ctx: RenderPanelAsyncCtx = {},
): Promise<PanelRenderResult> {
  if (ctx.projectDir) {
    const bucket = ARTIFACT_CACHE.get(ctx.projectDir);
    if (bucket?.has(name)) {
      return renderPanelFromArtifact(ctx.projectDir, name, config);
    }
  }
  return renderPanel(name, config, ctx);
}

/** All registered panel names — code + artifacts for the given project. */
export function listAllPanels(projectDir?: string): { code: string[]; artifact: string[] } {
  return {
    code: listRegisteredPanels(),
    artifact: projectDir ? listArtifactPanels(projectDir) : [],
  };
}

// ─── Watcher ─────────────────────────────────────────────────────

export interface WatchHandlers {
  onCatalogChanged: (payload: {
    kind: 'add' | 'change' | 'unlink';
    name: string;
    projectDir: string;
  }) => void;
}

/**
 * Watch <projectDir>/.reframe/ui for artifact changes. Returns a close
 * handle. Silently skips watching if chokidar isn't installed — the
 * sidecar still works, just without hot-reload.
 */
export async function watchPanelArtifacts(
  projectDir: string,
  handlers: WatchHandlers,
): Promise<() => void> {
  let chokidar: any;
  try {
    chokidar = (await import('chokidar')).default ?? (await import('chokidar'));
  } catch {
    return () => {}; // chokidar optional — dev ergonomics only
  }
  const dir = uiDir(projectDir);
  // chokidar tolerates non-existent paths and picks them up when created.
  const watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 75, pollInterval: 25 },
  });

  const handle = (kind: 'add' | 'change' | 'unlink') => (fullPath: string) => {
    const base = fullPath.slice(fullPath.lastIndexOf(require('node:path').sep) + 1);
    const name = artifactNameFromFile(base);
    if (!name) return;
    const bucket = ARTIFACT_CACHE.get(projectDir) ?? new Map();
    if (kind === 'unlink') {
      bucket.delete(name);
    } else {
      try {
        const html = readFileSync(fullPath, 'utf-8');
        bucket.set(name, { name, path: fullPath, html });
      } catch {
        return;
      }
    }
    ARTIFACT_CACHE.set(projectDir, bucket);
    handlers.onCatalogChanged({ kind, name, projectDir });
  };

  watcher.on('add', handle('add'));
  watcher.on('change', handle('change'));
  watcher.on('unlink', handle('unlink'));

  return () => watcher.close();
}

// ─── Bootstrap ───────────────────────────────────────────────────

const INITIALIZED: Set<string> = new Set();
const WATCHERS: Map<string, () => void> = new Map();

/**
 * Idempotent: loads artifacts for `projectDir` once, then starts a watcher
 * that refreshes the cache + broadcasts `panel:catalog-changed` SSE on
 * disk changes. Safe to call on every request — subsequent calls are no-ops.
 */
export async function ensurePanelArtifactsInitialized(
  projectDir: string,
  emit: (event: Record<string, unknown>) => void,
): Promise<void> {
  if (INITIALIZED.has(projectDir)) return;
  INITIALIZED.add(projectDir);
  const names = loadPanelArtifacts(projectDir);
  if (names.length > 0) {
    emit({ type: 'panel:catalog-changed', kind: 'initial', names, projectDir });
  }
  try {
    const close = await watchPanelArtifacts(projectDir, {
      onCatalogChanged: (payload) => {
        emit({ type: 'panel:catalog-changed', ...payload });
      },
    });
    WATCHERS.set(projectDir, close);
  } catch {
    // watcher optional — artifacts still load statically at boot
  }
}

/** Teardown — primarily for tests. */
export function resetPanelArtifacts(): void {
  for (const close of WATCHERS.values()) {
    try { close(); } catch {}
  }
  WATCHERS.clear();
  INITIALIZED.clear();
  ARTIFACT_CACHE.clear();
}

// ─── Author helpers ──────────────────────────────────────────────

/**
 * Persist an artifact to disk + refresh the cache immediately. Returns
 * the absolute path written. The chokidar watcher will also fire, but
 * callers usually want the cache hot the moment the write returns.
 */
export function writeArtifact(projectDir: string, name: string, html: string): string {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = uiDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, `${name}${ARTIFACT_SUFFIX}`);
  fs.writeFileSync(full, html, 'utf-8');
  const bucket = ARTIFACT_CACHE.get(projectDir) ?? new Map();
  bucket.set(name, { name, path: full, html });
  ARTIFACT_CACHE.set(projectDir, bucket);
  return full;
}

export function deleteArtifact(projectDir: string, name: string): boolean {
  const fs = require('node:fs');
  const path = require('node:path');
  const full = path.join(uiDir(projectDir), `${name}${ARTIFACT_SUFFIX}`);
  if (!fs.existsSync(full)) return false;
  fs.unlinkSync(full);
  ARTIFACT_CACHE.get(projectDir)?.delete(name);
  return true;
}
