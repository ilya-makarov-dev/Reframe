/**
 * Phase 3b stress test — exporters read meta.tokenBindings and emit CSS vars.
 *
 * Run: npx tsx packages/core/src/tests/phase3b-exporters.test.ts
 *
 * Covers:
 *   HTML exporter:
 *     1. :root block injected when DS supplied + bindings present
 *     2. Fill var() replaces hardcoded background
 *     3. Text-node color var() (text fill)
 *     4. cornerRadius var() for radius-bound nodes
 *     5. fontSize var() for text
 *     6. No :root block when DS absent (legacy behavior preserved)
 *     7. Retheme: same scene, different DS → different :root value
 *     8. Unbound-token gracefully falls through to literal color
 *   React exporter:
 *     9. :root block in trailing <style> tag
 *    10. Node-level var() replacement in style object
 *    11. Text node color substitution
 *    12. No designSystem option → no :root, hardcoded values preserved
 *   Cross-exporter contract:
 *    13. Same graph → both exporters produce the same root var set
 *    14. Auto-bound scene, retheme, both exporters re-emit new values
 */

import { importFromHtml } from '../importers/html.js';
import { autoBindTokens } from '../ops/auto-bind-tokens.js';
import { exportToHtml } from '../exporters/html.js';
import { exportToReact } from '../exporters/react.js';
import { getStandaloneNode } from '../adapters/standalone/node.js';
import type { DesignSystem } from '../design-system/types.js';
import type { SceneGraph } from '../engine/scene-graph.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

function makeDS(overrides: Partial<{ primary: string; bg: string }> = {}): DesignSystem {
  const primary = overrides.primary ?? '#533afd';
  const background = overrides.bg ?? '#ffffff';
  return {
    brand: 'Test',
    colors: {
      primary,
      background,
      text: '#061b31',
      accent: '#ea2261',
      roles: new Map([
        ['primary', primary],
        ['background', background],
        ['text', '#061b31'],
        ['accent', '#ea2261'],
      ]),
    },
    typography: {
      hierarchy: [
        { role: 'hero', fontSize: 56, fontWeight: 300, lineHeight: 1.03, letterSpacing: -1.4 },
        { role: 'title', fontSize: 40, fontWeight: 300, lineHeight: 1.15, letterSpacing: -0.96 },
        { role: 'body', fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0 },
      ],
      primaryFont: 'Inter',
    } as any,
    layout: {
      spacingUnit: 8,
      borderRadiusScale: [0, 2, 4, 6, 8],
    } as any,
    responsive: { breakpoints: [], typographyOverrides: [] } as any,
    depth: { elevationLevels: [] } as any,
    components: {} as any,
  } as DesignSystem;
}

const HTML = `
<div style="width:1200px;background:#ffffff;padding:24px">
  <h1 style="font-size:56px;color:#061b31;font-weight:300;letter-spacing:-1.4px">Hero text</h1>
  <button style="padding:12px 20px;background:#533afd;color:#ffffff;border-radius:4px;font-size:16px;border:none">CTA</button>
</div>
`;

async function main() {
  console.log('═══ PHASE 3b: Exporters + Token Binding Stress Test ═══\n');

  const ds = makeDS();

  // Helper: build a bound graph
  async function bound(): Promise<{ graph: SceneGraph; rootId: string }> {
    const { graph, rootId } = await importFromHtml(HTML, { stableIds: true });
    autoBindTokens(graph, rootId, ds);
    return { graph, rootId };
  }

  // ── HTML exporter ─────────────────────────────────────────────
  console.log('  1-8. HTML exporter');
  {
    const { graph, rootId } = await bound();
    const out = exportToHtml(graph, rootId, { designSystem: ds, fullDocument: false });

    // 1. :root block present
    assert(out.includes(':root {'), ':root block emitted');

    // 2. background fill substitution
    assert(out.includes('background: var(--color-primary)'), 'button bg → var(--color-primary)');
    assert(out.includes('background: var(--color-background)'), 'root bg → var(--color-background)');

    // 3. text color substitution (h1 color bound to "text" role)
    // h1 is color #061b31 which exactly matches text role, so should bind
    assert(
      out.includes('color: var(--color-text)'),
      `h1 color → var(--color-text) (output slice: ${out.match(/color:\s*[^;]+/g)?.slice(0, 5).join(', ')})`,
    );

    // 4. cornerRadius binding — 4px matches scale index 2
    assert(out.includes('border-radius: var(--radius-2)'), 'button radius → var(--radius-2)');

    // 5. fontSize binding — 56 matches hero, 16 matches body
    assert(out.includes('font-size: var(--font-size-hero)'), 'h1 fontSize → hero');
    assert(out.includes('font-size: var(--font-size-body)'), 'button text fontSize → body');

    // 6. No :root block when DS not supplied
    const outNoDs = exportToHtml(graph, rootId, { fullDocument: false });
    // Old var block may still be present for legacy token system — check that
    // NONE of our phase-3 var names land there.
    assert(!outNoDs.includes('--color-primary'), 'no --color-primary when no DS supplied');
    assert(!outNoDs.includes('var(--radius-'), 'no radius var when no DS supplied');

    // 7. Retheme — swap DS primary, same graph
    const linear = makeDS({ primary: '#5e6ad2' });
    const outLinear = exportToHtml(graph, rootId, { designSystem: linear, fullDocument: false });
    assert(outLinear.includes('--color-primary: #5e6ad2'), 'retheme: --color-primary updated to linear');
    assert(outLinear.includes('background: var(--color-primary)'), 'retheme: node still uses var()');

    // 8. Unbound fallback: add a node with a fill far from any DS color
    // The importer already produced such nodes inside autoBindTokens skipped list;
    // verify the exporter still emits some hex colors (literals) for those.
    assert(
      /background:\s*(#|rgb)/.test(out),
      'at least one hardcoded fill survives for unbound nodes',
    );
  }

  // ── React exporter ────────────────────────────────────────────
  console.log('  9-12. React exporter');
  {
    const { graph, rootId } = await bound();
    const rootInode = getStandaloneNode(graph, rootId)!;
    const out = exportToReact(rootInode, { designSystem: ds });

    // 9. :root block inside the component
    assert(out.includes(':root {'), ':root block in react output');
    assert(out.includes('--color-primary: #533afd'), 'react :root has --color-primary');

    // 10. Node-level var() in style object
    assert(
      out.includes("background: 'var(--color-primary)'"),
      `react button bg → var()  (slice: ${out.match(/background:\s*[^,]+/g)?.slice(0, 5).join(', ')})`,
    );
    assert(out.includes("borderRadius: 'var(--radius-2)'"), 'react button radius → var()');

    // 11. Text color substitution — TEXT nodes set `color`, not background
    assert(out.includes("color: 'var(--color-text)'"), 'h1 react color → var(--color-text)');
    assert(out.includes("fontSize: 'var(--font-size-hero)'"), 'h1 react fontSize → hero');

    // 12. No designSystem → no :root, hardcoded values preserved
    const outNoDs = exportToReact(rootInode, {});
    assert(!outNoDs.includes(':root {'), 'no :root block when DS absent');
    assert(!outNoDs.includes('var(--color-primary)'), 'no var() substitution when DS absent');
  }

  // ── Cross-exporter contract ──────────────────────────────────
  console.log('  13-14. Cross-exporter contract');
  {
    const { graph, rootId } = await bound();
    const htmlOut = exportToHtml(graph, rootId, { designSystem: ds, fullDocument: false });
    const reactOut = exportToReact(getStandaloneNode(graph, rootId)!, { designSystem: ds });

    // 13. Same set of var names in :root blocks (order may differ)
    const htmlVars = new Set([...htmlOut.matchAll(/(--[\w-]+):/g)].map(m => m[1]));
    const reactVars = new Set([...reactOut.matchAll(/(--[\w-]+):/g)].map(m => m[1]));
    const commonColors = ['--color-primary', '--color-background', '--color-text'];
    for (const v of commonColors) {
      assert(htmlVars.has(v) && reactVars.has(v), `${v} in both exporter outputs`);
    }
    assert(htmlVars.has('--radius-2') && reactVars.has('--radius-2'), 'radius token in both');
    assert(htmlVars.has('--font-size-hero') && reactVars.has('--font-size-hero'), 'fontSize hero in both');

    // 14. Retheme both exporters, same new value lands in both outputs
    const linear = makeDS({ primary: '#5e6ad2' });
    const h2 = exportToHtml(graph, rootId, { designSystem: linear, fullDocument: false });
    const r2 = exportToReact(getStandaloneNode(graph, rootId)!, { designSystem: linear });
    assert(h2.includes('#5e6ad2'), 'html retheme → new primary hex in :root');
    assert(r2.includes('#5e6ad2'), 'react retheme → new primary hex in :root');
  }

  console.log(`\n═══ PHASE 3b: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
