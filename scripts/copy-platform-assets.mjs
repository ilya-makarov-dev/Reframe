// Post-build step for @reframe/mcp: assemble the Platform UI assets
// into dist/ next to the compiled scripts.js / style.js shims.
//
//  - platform-ui.js is CONCATENATED from ui/*.js in lexical order.
//    Splitting the 7831-line file into feature sections makes it
//    navigable; concatenating at build time keeps the browser
//    asset a single file (one request, one cache entry).
//  - platform-ui.css is copied verbatim.
//
// The thin shims in scripts.ts and style.ts do readFileSync at module
// load using __dirname-relative paths, so both assets need to sit
// next to the compiled shim in dist/ both during dev and when the
// package is installed via npm.  tsc does not copy non-.ts files,
// hence this script.  Invoked from packages/mcp/package.json "build".

import { cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const platformSrc = resolve(repoRoot, 'packages/mcp/src/platform');
const uiSrc = resolve(platformSrc, 'ui');
const platformDist = resolve(repoRoot, 'packages/mcp/dist/mcp/src/platform');

if (!existsSync(platformDist)) {
  mkdirSync(platformDist, { recursive: true });
}

// Concatenate ui/*.js in lexical order.  File names are prefixed with
// a numeric sort key (010-, 020-, ..., 160-) precisely so sort order
// matches execution order inside the IIFE.  Gaps in numbering leave
// room for inserts without renaming everything.
const uiFiles = readdirSync(uiSrc)
  .filter((f) => f.endsWith('.js'))
  .sort();

if (uiFiles.length === 0) {
  throw new Error(`no ui/*.js files found in ${uiSrc}`);
}

const parts = [];
for (const name of uiFiles) {
  const full = resolve(uiSrc, name);
  parts.push(readFileSync(full, 'utf-8'));
}

// Detect line ending from the first chunk so the join matches the
// source convention (CRLF on Windows when git autocrlf is on, LF on
// Unix).  Fall back to LF.
const eol = parts[0].includes('\r\n') ? '\r\n' : '\n';
const bundled = parts.join(eol) + eol;
writeFileSync(resolve(platformDist, 'platform-ui.js'), bundled);
console.log(`bundled ${uiFiles.length} ui/*.js files -> platform-ui.js (${bundled.length} chars)`);

cpSync(resolve(platformSrc, 'platform-ui.css'), resolve(platformDist, 'platform-ui.css'));
console.log(`copied platform-ui.css`);
