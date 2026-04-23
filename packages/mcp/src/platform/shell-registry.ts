// Shell registry — maps shell name → route handlers.
//
// A shell is a REPLACEABLE surface layer over the kernel. The default
// shell is `studio` (the MJ-shape feed + catalogs + drilldown we built).
// A reframe project can declare a different shell in its manifest;
// the runtime loads that shell's routes instead.
//
// Shells are code-shipped today (lazy-imported route handlers). Phase 2
// of the packaging work will let them live as pack directories
// (`.reframe/packs/shell/<name>/`) with a shell.json + entry module,
// installable via `reframe add shell/<name>`. The registry abstraction
// here is the same either way.
//
// A shell defines:
//   name        identifier used in manifest.shell
//   match       which pathnames (relative to /platform) it claims
//   dispatch    given ctx + pathname + url, return an HTML string
//
// This lets router.ts stay shell-agnostic — no more `if pathname ===
// '/platform' → renderFeedPage` lines bolted into the router.

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from './router.js';

export interface ShellRouteResult {
  html: string;
  status?: number;
}

export interface ShellDispatchArgs {
  ctx: PlatformContext;
  /** Pathname STRIPPED of the `/platform` prefix. '/' for the shell root. */
  subpath: string;
  url: URL;
  req: IncomingMessage;
}

export interface ShellDef {
  name: string;
  /**
   * Decide if this shell claims the subpath. Router will try the active
   * shell first; on false it falls through to the built-in endpoints
   * (api, vendor, legacy editor, etc) defined in router.ts.
   */
  match: (subpath: string) => boolean;
  /** Produce HTML (or throw for 500). */
  dispatch: (args: ShellDispatchArgs) => Promise<ShellRouteResult>;
}

const SHELLS = new Map<string, ShellDef>();

export function registerShell(def: ShellDef): void {
  SHELLS.set(def.name, def);
}

export function getShell(name: string): ShellDef | null {
  return SHELLS.get(name) ?? null;
}

export function listShells(): string[] {
  return Array.from(SHELLS.keys());
}

export const DEFAULT_SHELL = 'studio';

// ─── Studio shell — the MJ-shape surface ────────────────────────
//
// Registered here so every runtime boot has at least one usable shell.
// Lives as lazy imports of the existing page modules so startup stays
// fast and shell code can be swapped without a recompile.

registerShell({
  name: 'studio',
  match: (subpath) => {
    if (subpath === '/' || subpath === '') return true;                 // feed
    if (subpath === '/brands' || subpath === '/brands/') return true;   // brands catalog
    if (subpath === '/components' || subpath === '/components/') return true; // components catalog
    if (subpath.startsWith('/card/')) return true;                      // drilldown
    return false;
  },
  dispatch: async ({ ctx, subpath, url }) => {
    if (subpath === '/' || subpath === '') {
      const filter = url.searchParams.get('filter') || 'all';
      const { renderFeedPage } = await import('./pages/feed.js');
      return { html: await renderFeedPage(ctx, filter) };
    }
    if (subpath === '/brands' || subpath === '/brands/') {
      const { renderBrandsCatalogPage } = await import('./pages/brands-catalog-page.js');
      return { html: await renderBrandsCatalogPage(ctx) };
    }
    if (subpath === '/components' || subpath === '/components/') {
      const { renderComponentsCatalogPage } = await import('./pages/components-catalog-page.js');
      return { html: await renderComponentsCatalogPage(ctx) };
    }
    if (subpath.startsWith('/card/')) {
      const cardId = subpath.slice('/card/'.length).split('/')[0];
      const { renderCardDrilldownPage } = await import('./pages/card-drilldown.js');
      return { html: await renderCardDrilldownPage(ctx, cardId) };
    }
    // Should be unreachable given `match` — but fail loudly, not silently.
    throw new Error(`studio shell: no handler for subpath ${subpath}`);
  },
});
