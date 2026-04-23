// Post-build fixer: add `.js` extensions to relative imports in compiled dist.
//
// Why: root tsconfig uses `module: ESNext` + `moduleResolution: bundler`
// which compiles TS → ES modules but preserves extensionless import
// specifiers (bundlers resolve them at bundle time). Node's strict ESM
// resolver rejects extensionless relative imports with ERR_MODULE_NOT_FOUND.
//
// This script walks every .js file under dist/ and rewrites relative
// `import/export from './foo'` → `from './foo.js'` (with directory-index
// expansion: `./foo` → `./foo/index.js` when foo is a directory).
//
// Idempotent: re-running does nothing if extensions are already present.
// Must run AFTER `tsc` in the build pipeline for any package intended to
// run under plain `node`.

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Targets — pass via argv, default to all known dist dirs.
const DEFAULT_TARGETS = [
  'packages/core/dist',
  'packages/mcp/dist',
  'packages/cli/dist',
  'packages/editor/dist',
];

const targets = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TARGETS)
  .map(t => resolve(repoRoot, t))
  .filter(existsSync);

if (targets.length === 0) {
  console.error('no existing dist/ dirs found to fix');
  process.exit(1);
}

// Pattern: `from '<path>'` or `from "<path>"` where <path> starts with ./ or ../
// and doesn't already end in .js / .mjs / .json / .cjs. Captures the quoted literal.
const IMPORT_RE = /(from\s+)(['"])(\.\.?\/[^'"]+?)(\2)/g;
const DYN_IMPORT_RE = /(import\s*\(\s*)(['"])(\.\.?\/[^'"]+?)(\2)(\s*\))/g;

// JSON imports also need `with { type: 'json' }` under strict Node ESM.
// Match `from './foo.json'` (any trailing attribute stripped first, so we
// don't double-append) — excludes `from '...json' with` which already has it.
const JSON_IMPORT_RE = /(from\s+)(['"])(\.\.?\/[^'"]+?\.json)(\2)(?!\s*with\b)/g;
const DYN_JSON_IMPORT_RE = /(import\s*\(\s*)(['"])(\.\.?\/[^'"]+?\.json)(\2)(\s*\))/g;

function needsFix(spec) {
  return !/\.(?:js|mjs|cjs|json)$/.test(spec);
}

/**
 * Resolve `./foo` from within `fromFile` into the fully-qualified extension
 * to append: `.js` when `<foo>.js` exists, `/index.js` when `<foo>/` is a
 * directory with index.js, else `.js` (best guess — tsc output is consistent).
 */
function pickSuffix(spec, fromFile) {
  const baseDir = dirname(fromFile);
  const absCandidate = resolve(baseDir, spec);
  if (existsSync(absCandidate + '.js')) return '.js';
  if (existsSync(join(absCandidate, 'index.js'))) return '/index.js';
  // Fallback — default to .js. tsc would have errored earlier if target missing.
  return '.js';
}

let filesTouched = 0;
let specsFixed = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }
    if (!entry.endsWith('.js')) continue;
    fixFile(full);
  }
}

function fixFile(file) {
  const src = readFileSync(file, 'utf-8');
  let out = src;
  let changed = false;

  out = out.replace(IMPORT_RE, (m, from, q1, spec, q2) => {
    if (!needsFix(spec)) return m;
    const suffix = pickSuffix(spec, file);
    changed = true;
    specsFixed++;
    return `${from}${q1}${spec}${suffix}${q2}`;
  });

  out = out.replace(DYN_IMPORT_RE, (m, lead, q1, spec, q2, tail) => {
    if (!needsFix(spec)) return m;
    const suffix = pickSuffix(spec, file);
    changed = true;
    specsFixed++;
    return `${lead}${q1}${spec}${suffix}${q2}${tail}`;
  });

  // Static JSON imports — append `with { type: 'json' }` attribute.
  out = out.replace(JSON_IMPORT_RE, (_m, from, q1, spec, q2) => {
    changed = true;
    specsFixed++;
    return `${from}${q1}${spec}${q2} with { type: 'json' }`;
  });

  // Dynamic JSON imports: `import('./x.json')` → `import('./x.json', { with: { type: 'json' } })`
  out = out.replace(DYN_JSON_IMPORT_RE, (m, lead, q1, spec, q2, close) => {
    // Avoid double-appending — if pre-call second arg already specifies type:json, skip.
    if (/type\s*:\s*['"]json['"]/.test(m)) return m;
    changed = true;
    specsFixed++;
    return `${lead}${q1}${spec}${q2}, { with: { type: 'json' } }${close}`;
  });

  if (changed) {
    writeFileSync(file, out, 'utf-8');
    filesTouched++;
  }
}

for (const t of targets) {
  console.log(`fix-dist: scanning ${t}`);
  walk(t);
}

console.log(`fix-dist: touched ${filesTouched} files, rewrote ${specsFixed} import specifiers`);
