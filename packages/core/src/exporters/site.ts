/**
 * Site Exporter — multiple scenes → single-page app with routing + transitions.
 *
 * Takes an array of pages (each a SceneGraph + rootId), produces a self-contained
 * HTML document with hash-based routing, page transitions, and auto-active nav state.
 * No framework required — vanilla JS router (~40 lines).
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import { exportToHtml, isPlausibleWebFontName } from './html.js';

// ─── Types ───────────────────────────────────────────────────

export interface SitePage {
  /** Page slug — used in URL hash (e.g. 'features' → #features) */
  slug: string;
  /** Display name (e.g. 'Features') */
  name: string;
  /** Scene graph containing this page's design */
  graph: SceneGraph;
  /** Root node ID in the graph */
  rootId: string;
  /** Entry animation preset name (default: 'fadeIn') */
  transition?: string;
  /** Transition duration in ms (default: 400) */
  transitionDuration?: number;
}

export interface SiteExportOptions {
  /** Site title (shown in browser tab) */
  title?: string;
  /** Default page transition (default: 'fadeIn') */
  transition?: 'fadeIn' | 'slideInUp' | 'slideInLeft' | 'fadeSlideUp' | 'none';
  /** Transition duration in ms (default: 400) */
  transitionDuration?: number;
  /** Include responsive viewport meta (default: true) */
  responsive?: boolean;
  /** Custom Google Fonts to load */
  fonts?: string[];
}

// ─── CSS Animations ──────────────────────────────────────────

const TRANSITION_KEYFRAMES: Record<string, string> = {
  fadeIn: `
    @keyframes rf-page-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes rf-page-out { from { opacity: 1; } to { opacity: 0; } }`,
  slideInUp: `
    @keyframes rf-page-in { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes rf-page-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-20px); } }`,
  slideInLeft: `
    @keyframes rf-page-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes rf-page-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-40px); } }`,
  fadeSlideUp: `
    @keyframes rf-page-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes rf-page-out { from { opacity: 1; } to { opacity: 0; } }`,
  none: `
    @keyframes rf-page-in { from { opacity: 1; } to { opacity: 1; } }
    @keyframes rf-page-out { from { opacity: 1; } to { opacity: 0; } }`,
};

// ─── Main Export ─────────────────────────────────────────────

export function exportSite(
  pages: SitePage[],
  options: SiteExportOptions = {},
): string {
  if (pages.length === 0) throw new Error('exportSite(): at least one page required');

  const title = options.title ?? 'Site';
  const defaultTransition = options.transition ?? 'fadeSlideUp';
  const defaultDuration = options.transitionDuration ?? 400;

  // Collect all fonts from all pages
  const allFonts = new Set<string>(options.fonts ?? []);
  for (const page of pages) {
    collectFonts(page.graph, page.rootId, allFonts);
  }

  // Inject navigation links at INode level — find text matching page names, set href on parent
  const slugMap = new Map<string, string>();
  for (const p of pages) {
    slugMap.set(p.name.toLowerCase(), p.slug);
  }
  for (const page of pages) {
    injectNavLinks(page.graph, page.rootId, slugMap, page.name);
    // Also fix root width — ensure it stretches to page width
    fixRootLayout(page.graph, page.rootId);
  }

  // Export each page as HTML fragment
  const pageFragments: string[] = [];
  for (const page of pages) {
    const fragment = exportToHtml(page.graph, page.rootId, {
      fullDocument: false,
      dataAttributes: false,
    });
    const duration = page.transitionDuration ?? defaultDuration;
    pageFragments.push(
      `<section class="rf-page" id="page-${esc(page.slug)}" ` +
      `data-transition="${esc(page.transition ?? defaultTransition)}" ` +
      `style="animation-duration: ${duration}ms;">\n${fragment}\n</section>`
    );
  }

  // Build nav data for the router
  const navData = pages.map(p => ({ slug: p.slug, name: p.name }));

  // Font links
  const fontLinks = allFonts.size > 0
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?${[...allFonts].map(f => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800`).join('&')}&display=swap" rel="stylesheet">`
    : '';

  // Keyframes CSS
  const keyframes = TRANSITION_KEYFRAMES[defaultTransition] ?? TRANSITION_KEYFRAMES.fadeSlideUp;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${options.responsive !== false ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
  <title>${esc(title)}</title>
  ${fontLinks}
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; scroll-behavior: smooth; }
    body { min-height: 100vh; overflow-x: hidden; }
    a { color: inherit; text-decoration: none; }
    img, svg { display: block; max-width: 100%; }

    /* Page routing */
    .rf-page { display: none; min-height: 100vh; animation-fill-mode: both; }
    .rf-page.rf-active { display: block; animation-name: rf-page-in; }
    .rf-page.rf-exit { display: block; animation-name: rf-page-out; }

    /* Nav active state */
    [data-nav-link].rf-nav-active { opacity: 1; font-weight: 600; }
    [data-nav-link] { cursor: pointer; }

    /* Transitions */
    ${keyframes}
  </style>
</head>
<body>
  ${pageFragments.join('\n\n  ')}

  <script>
  (function() {
    var pages = ${JSON.stringify(navData)};
    var duration = ${defaultDuration};
    var current = null;

    function navigate(slug) {
      var next = document.getElementById('page-' + slug);
      if (!next || slug === current) return;

      // Exit current page
      var prev = current ? document.getElementById('page-' + current) : null;
      if (prev) {
        prev.classList.add('rf-exit');
        prev.classList.remove('rf-active');
        setTimeout(function() {
          prev.classList.remove('rf-exit');
        }, duration);
      }

      // Enter new page
      setTimeout(function() {
        next.classList.add('rf-active');
        window.scrollTo(0, 0);
      }, prev ? duration / 2 : 0);

      current = slug;

      // Update nav active states
      document.querySelectorAll('[data-nav-link]').forEach(function(el) {
        el.classList.toggle('rf-nav-active', el.getAttribute('data-nav-link') === slug);
      });
    }

    // Hash-based routing
    function onHash() {
      var hash = location.hash.replace('#', '') || pages[0].slug;
      navigate(hash);
    }

    // Intercept clicks on internal links
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a[href^="#"]');
      if (a) {
        e.preventDefault();
        var slug = a.getAttribute('href').replace('#', '');
        location.hash = slug;
      }
    });

    window.addEventListener('hashchange', onHash);

    // Initial route
    onHash();
  })();
  </script>
</body>
</html>`;
}

// ─── Helpers ─────────────────────────────────────────────────

/** Walk INode tree, find text matching page names, set href on parent. */
function injectNavLinks(graph: SceneGraph, rootId: string, slugMap: Map<string, string>, currentPage: string) {
  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    if (node.type === 'TEXT' && node.text) {
      const lower = node.text.trim().toLowerCase();
      const slug = slugMap.get(lower);
      if (slug && lower !== currentPage.toLowerCase()) {
        // Set href on parent frame
        const parent = node.parentId ? graph.getNode(node.parentId) : null;
        if (parent && parent.type !== 'TEXT') {
          (parent as any).href = `#${slug}`;
        }
      }
    }

    for (const childId of node.childIds) {
      walk(childId);
    }
  }
  walk(rootId);
}

/** Fix root and first-level children to stretch full width. */
function fixRootLayout(graph: SceneGraph, rootId: string) {
  const root = graph.getNode(rootId);
  if (!root) return;

  // Ensure root children stretch to root width
  for (const childId of root.childIds) {
    const child = graph.getNode(childId);
    if (!child || child.type === 'TEXT') continue;

    // If child has a fixed width smaller than root, stretch it
    if (child.width > 0 && root.width > 0 && child.width < root.width * 0.8) {
      (child as any).width = root.width;
      (child as any).layoutAlignSelf = 'STRETCH';
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SYSTEM_FONTS = new Set([
  'system-ui', '-apple-system', 'sans-serif', 'serif', 'monospace',
  'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
]);

function collectFonts(graph: SceneGraph, rootId: string, fonts: Set<string>) {
  const node = graph.getNode(rootId);
  if (!node) return;
  if (node.type === 'TEXT' && node.fontFamily) {
    const family = node.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
    if (family && !SYSTEM_FONTS.has(family.toLowerCase()) && isPlausibleWebFontName(family)) {
      fonts.add(family);
    }
  }
  for (const childId of node.childIds) {
    collectFonts(graph, childId, fonts);
  }
}
