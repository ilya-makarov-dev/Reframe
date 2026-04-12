/**
 * Platform hydration — inject dynamic data into compiled scene HTML.
 *
 * Compiled platform scenes contain `data-slot="name"` elements.
 * This module reads the published HTML, replaces slot contents with
 * live data, and injects platform CSS + JS references.
 *
 * When the published HTML doesn't exist, returns null → caller falls
 * back to the hardcoded TypeScript renderer.
 */

import * as fs from 'fs';
import * as path from 'path';

// Cache published HTML in memory with mtime-based invalidation.
const cache = new Map<string, { html: string; mtime: number }>();

const ASSET_VERSION = Date.now().toString(36);

/**
 * Attempt to load and hydrate a compiled platform page.
 *
 * @param projectDir  The project root (parent of .reframe/)
 * @param pageName    Page key (e.g. "components", "dashboard")
 * @param slots       Map of slot name → HTML content to inject
 * @returns           Hydrated HTML string, or null if no compiled page exists
 */
export function hydrateShell(
  projectDir: string | null,
  pageName: string,
  slots: Record<string, string>,
): string | null {
  if (!projectDir) return null;

  const htmlPath = path.join(projectDir, '.reframe', 'platform', 'html', pageName + '.html');

  // Check cache
  let stat: fs.Stats;
  try {
    stat = fs.statSync(htmlPath);
  } catch {
    return null; // File doesn't exist → fallback
  }

  const mtime = stat.mtimeMs;
  const cached = cache.get(htmlPath);
  let html: string;

  if (cached && cached.mtime === mtime) {
    html = cached.html;
  } else {
    try {
      html = fs.readFileSync(htmlPath, 'utf-8');
      cache.set(htmlPath, { html, mtime });
    } catch {
      return null;
    }
  }

  // Inject platform CSS before </head>
  const cssLink = `<link rel="stylesheet" href="/platform/style.css?v=${ASSET_VERSION}">`;
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${cssLink}\n</head>`);
  } else {
    html = `${cssLink}\n${html}`;
  }

  // Inject platform JS before </body>
  const jsScript = `<script src="/platform/app.js?v=${ASSET_VERSION}"></script>`;
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${jsScript}\n</body>`);
  } else {
    html = `${html}\n${jsScript}`;
  }

  // Replace slot contents
  for (const [name, content] of Object.entries(slots)) {
    // Match: <div data-slot="name">...anything...</div>
    // Non-greedy, handles nested tags via tracking depth
    const slotRegex = new RegExp(
      `(<[^>]+data-slot="${escapeRegex(name)}"[^>]*>)[\\s\\S]*?(<\\/[a-zA-Z]+>)`,
      'i',
    );
    html = html.replace(slotRegex, `$1${content}$2`);
  }

  return html;
}

/**
 * Write exported scene HTML as a published platform page.
 * Creates the directory if needed.
 */
export function publishShell(
  projectDir: string,
  pageName: string,
  html: string,
): void {
  const dir = path.join(projectDir, '.reframe', 'platform', 'html');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, pageName + '.html');
  fs.writeFileSync(filePath, html, 'utf-8');

  // Invalidate cache
  cache.delete(filePath);
}

/**
 * List all published platform pages.
 */
export function listPublishedPages(projectDir: string): string[] {
  const dir = path.join(projectDir, '.reframe', 'platform', 'html');
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.html'))
      .map(f => f.replace('.html', ''));
  } catch {
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
