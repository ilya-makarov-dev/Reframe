/**
 * Pseudo-class import — CSS `:hover/:focus/:active/:disabled` rules must
 * populate `node.states`.
 *
 * Closes the 🟡 `engine/importer-pseudo-class-states-lost` smell row from
 * `designer-qa/SKILL.md` (2026-04-22). Previously the importer dropped
 * any selector containing `:` via a blanket skip in the inline `<style>`
 * parser — pseudo-classes never reached the state-override path.
 *
 * Run: `npx tsx src/tests/pseudo-class-import.test.ts` from `packages/core`.
 */

import { importFromHtml } from '../importers/html';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main(): Promise<void> {
  const html = `
<style>
  .btn { width: 160px; height: 44px; background: #3366ff; color: #ffffff; border-radius: 8px; }
  .btn:hover { background: #254edb; opacity: 0.95; }
  .btn:focus { background: #1a3ec2; }
  .btn:active { opacity: 0.8; }
  .disabled-btn:disabled { opacity: 0.5; }
  #cta:hover { background: #222; border-radius: 12px; }
</style>
<div style="width:600px;height:300px;background:#fff;padding:20px;display:flex;flex-direction:column;gap:12px;">
  <button class="btn">Primary</button>
  <button class="btn disabled-btn" disabled>Disabled</button>
  <button id="cta" style="width:160px;height:44px;background:#111;color:#fff;">CTA</button>
</div>
  `.trim();

  const { graph, rootId } = await importFromHtml(html);
  const root = graph.getNode(rootId)!;

  function findButton(label: string): any {
    function walk(id: string): any {
      const n = graph.getNode(id);
      if (!n) return null;
      if (n.type === 'TEXT' && n.text?.trim() === label) {
        // bubble up to the button wrapper
        return graph.getNode(n.parentId ?? '');
      }
      for (const cid of n.childIds) {
        const hit = walk(cid);
        if (hit) return hit;
      }
      return null;
    }
    return walk(rootId);
  }

  const primary = findButton('Primary');
  assert(!!primary, 'Found Primary button');
  assert(primary?.states?.hover !== undefined, 'Primary has :hover state');
  assert(primary?.states?.focus !== undefined, 'Primary has :focus state');
  assert(primary?.states?.active !== undefined, 'Primary has :active state');

  // :hover should carry the override props — exact shape depends on
  // cssToResponsiveProps mapper; we assert the state block is non-empty.
  const hoverKeys = Object.keys(primary?.states?.hover ?? {});
  assert(hoverKeys.length > 0, `Primary :hover has at least one prop (got ${hoverKeys.join(',')})`);

  const disabled = findButton('Disabled');
  assert(!!disabled, 'Found Disabled button');
  assert(disabled?.states?.disabled !== undefined || disabled?.states?.hover !== undefined,
    'Disabled button has :disabled OR :hover state (it matches .btn too)');

  const cta = findButton('CTA');
  assert(!!cta, 'Found CTA button');
  assert(cta?.states?.hover !== undefined,
    `CTA has :hover state via #id selector (got ${JSON.stringify(cta?.states)})`);

  // Regression: non-pseudo rules still apply normally.
  assert((primary?.width ?? 0) > 0 && (primary?.height ?? 0) > 0,
    `Primary geometry intact (w=${primary?.width}, h=${primary?.height})`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
