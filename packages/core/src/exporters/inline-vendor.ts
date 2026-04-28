/**
 * Vendor script inliner — read pinned vendor JS files from node_modules
 * and return raw bytes ready to embed in a single-file HTML artifact.
 *
 * Scope: Babel-standalone (browser-side JSX transform), React +
 * ReactDOM (UMD production builds, expose `window.React` /
 * `window.ReactDOM`). Same files served by /platform/vendor/ in the
 * sidecar; this helper bundles them inline for portable artifacts
 * (#20 stateful prototype, future #26 always-on tweaks).
 *
 * Defensive `</script>` escape: if any vendor source ever contains a
 * literal `</script>` substring, the HTML parser would terminate the
 * surrounding inline <script> early, breaking everything after. We
 * verified at write time none do, but escape regardless — vendor versions
 * change, and the cost is one regex per inline.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type VendorName = 'babel' | 'react' | 'react-dom';

const VENDOR_PATHS: Record<VendorName, string[]> = {
  // Each entry is a sequence of node_modules path segments.
  'babel':     ['@babel', 'standalone', 'babel.min.js'],
  'react':     ['react', 'umd', 'react.production.min.js'],
  'react-dom': ['react-dom', 'umd', 'react-dom.production.min.js'],
};

function resolveVendorPath(name: VendorName): string {
  // Same lookup convention as router.ts /platform/vendor/ handler — relative
  // to process.cwd()'s node_modules. Workspace consumers (any package) hit
  // the hoisted node_modules at the repo root.
  return path.join(process.cwd(), 'node_modules', ...VENDOR_PATHS[name]);
}

/**
 * Escape any `</script>` substrings in JS source so they don't terminate
 * a surrounding inline <script> tag. The standard HTML5-safe escape is
 * `<\/script>` — JS treats the backslash as a no-op inside a string,
 * but the parser stops looking for the closing tag.
 */
export function escapeForInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

/**
 * Read a vendor script's raw bytes ready for inline embedding. Throws when
 * the file is missing — callers should ensure the vendor packages are
 * installed (deps in packages/mcp/package.json: @babel/standalone, react,
 * react-dom).
 */
export function readVendorScript(name: VendorName): string {
  const filePath = resolveVendorPath(name);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Vendor script "${name}" not found at ${filePath}. ` +
      `Run \`npm install\` to fetch @babel/standalone, react, and react-dom.`,
    );
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return escapeForInlineScript(raw);
}

/** Test/diagnostic helper. */
export function getVendorPath(name: VendorName): string {
  return resolveVendorPath(name);
}
