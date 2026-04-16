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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `__dirname` is a CommonJS built-in — the package compiles to CJS, so
// this resolves to the directory containing the compiled scripts.js,
// which is also where copy-platform-assets.mjs drops platform-ui.js.
export const PLATFORM_JS = readFileSync(join(__dirname, 'platform-ui.js'), 'utf-8');
