// Phase 5.2 shell boot — wraps the `app-shell` INode panel in the
// minimal HTML document (doctype, fonts, theme-init, platform JS) and
// hydrates the `app-main` mount-slot with the page-specific panel
// HTML.
//
// This is the single entry point for non-editor pages (dashboard,
// design-system, components, macros). Each page computes its own
// page-panel HTML via renderPanel('<name>') and calls
// renderPlatformShellPage — no more renderShell hand-HTML on these
// pages.
//
// Editor shell (/platform/project/:slug) stays on its own page
// (editor-shell-page.ts) — it needs a canvas-viewport hydration path
// the app-shell doesn't have.

import { renderPanel } from '../panels.js';

export function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface ShellPageOptions {
  title: string;
  /** Active sidebar nav item key — matches one of the built-in nav entries. */
  current: 'home' | 'design-system' | 'components' | 'macros';
  activeBrand?: string;
  /** Pre-rendered page panel HTML — injected into app-main slot. */
  pageHtml: string;
  /** Optional shell width / height — default 1440x900. */
  width?: number;
  height?: number;
}

const SIDEBAR_ITEMS = [
  { label: 'Home',          href: '/platform',                key: 'home',          glyph: '⌂' },
  { label: 'Brandbook',     href: '/platform/design-system',  key: 'design-system', glyph: '◎' },
  { label: 'Components',    href: '/platform/components',     key: 'components',    glyph: '▢' },
  { label: 'Recipes',       href: '/platform/macros',         key: 'macros',        glyph: '✎' },
];

function hydrateSlot(html: string, slotName: string, inner: string): string {
  const re = new RegExp(
    `(<div[^>]*data-mount-slot="${slotName}"[^>]*>)([\\s\\S]*?)(</div>)`,
    'i',
  );
  return html.replace(re, `$1${inner}$3`);
}

const SHELL_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; }
  [data-intent-role="app-shell/root"] { height: 100vh; min-height: 100vh; }
  [data-intent-role="app-shell/main"] { overflow-y: auto; }
  .rf-gesture-pressed { opacity: 0.8; transform: scale(0.97); transition: all 120ms; }
`;

export function renderPlatformShellPage(opts: ShellPageOptions): string {
  const sidebarItems = SIDEBAR_ITEMS.map(i => ({
    label: i.label, href: i.href, current: i.key === opts.current, glyph: i.glyph,
  }));

  const shell = renderPanel('app-shell', {
    title: opts.title,
    activeBrand: opts.activeBrand,
    sidebarItems,
    width: opts.width ?? 1440,
    height: opts.height ?? 900,
  }, {});

  // Hydrate main slot with the page's panel HTML.
  const shellHtml = hydrateSlot(shell.html, 'app-main', opts.pageHtml);

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(opts.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${SHELL_CSS}</style>
  <script>try { var t=localStorage.getItem('reframe-theme'); if(t) document.documentElement.setAttribute('data-theme',t); } catch(_){}</script>
</head>
<body>
  ${shellHtml}
  <link rel="stylesheet" href="/platform/style.css?v=${assets}">
  <script src="/platform/theme-init.js?v=${assets}"></script>
  <script src="/platform/app.js?v=${assets}"></script>
</body>
</html>`;
}
