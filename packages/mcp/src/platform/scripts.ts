/**
 * Platform — client JS entry point.
 *
 * This is a thin shim. The actual Platform UI JavaScript lives in
 * ./platform-ui.js (a plain JS file, not a .ts template literal).
 * We read it once at module load and export the string verbatim for
 * the router to serve at /platform/app.js.
 *
 * Why: the previous incarnation of this file was a 7853-line template
 * literal.  Any edit risked template-literal escape bugs ('\n' becoming
 * a real newline, apostrophes inside '' strings, backticks in comments
 * closing the outer literal).  Moving the content to a plain .js file
 * restores real syntax highlighting, linting, and line-accurate
 * browser error messages.
 *
 * The build step (scripts/copy-platform-assets.mjs) copies
 * platform-ui.js into dist/ alongside the compiled scripts.js so the
 * shipped npm package keeps working.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `__dirname` is a CommonJS built-in — the package compiles to CJS, so
// this resolves to the directory containing the compiled scripts.js,
// which is also where copy-platform-assets.mjs drops platform-ui.js.
// When running under tsx (dev / tests), __dirname points at the .ts
// source dir where the bundle hasn't been written yet; fall back to
// the dist-side copy so tests don't need a full npm build first.
function loadPlatformJs(): string {
  const candidates = [
    join(__dirname, 'platform-ui.js'),
    // tsx — from packages/mcp/src/platform/ back to dist/mcp/src/platform/
    resolve(__dirname, '../../dist/mcp/src/platform/platform-ui.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf-8');
  }
  throw new Error(`platform-ui.js not found. Searched: ${candidates.join(', ')}. Run \`npm run build\` in packages/mcp first.`);
}

export const PLATFORM_JS = loadPlatformJs();
