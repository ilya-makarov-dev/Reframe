/**
 * Phase 1 stress test — semantic HTML import, stable ids, meta, @media.
 *
 * Run: npx tsx packages/core/src/tests/phase1-semantic-import.test.ts
 *
 * Covers:
 *   1. Tag-based semanticRole inference (button, nav, h1-h6, section, ...)
 *   2. Class-name hints (hero, cta, card, badge, logo)
 *   3. data-reframe-role/variant/slot overrides
 *   4. meta.source preserves tag, class, id, data-*
 *   5. Stable ids: same HTML → same ids, twice
 *   6. Stable ids survive serialize → deserialize round-trip
 *   7. @media (max-width:...) blocks become responsive[] entries
 *   8. @media with supported + unsupported props drops the unsupported
 *   9. Adversarial HTML: nested @media, duplicate subtrees, exotic selectors
 *  10. Legacy mode (stableIds off) still produces counter ids
 */

import { importFromHtml } from '../importers/html';
import { serializeGraph, deserializeScene } from '../serialize';
import type { SceneNode } from '../engine/types';
import { SceneGraph } from '../engine/scene-graph';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function findByMetaPath(graph: SceneGraph, path: string): SceneNode | undefined {
  for (const node of graph.getAllNodes()) {
    if (node.meta?.sourcePath === path) return node;
  }
  return undefined;
}

function findByTag(graph: SceneGraph, tag: string): SceneNode[] {
  const out: SceneNode[] = [];
  for (const node of graph.getAllNodes()) {
    if (node.meta?.sourceTag === tag) out.push(node);
  }
  return out;
}

async function main() {
  console.log('═══ PHASE 1: Semantic HTML Import Stress Test ═══\n');

  // ── 1. Tag-based semanticRole ──────────────────────────────────
  console.log('  1. Tag-based semanticRole');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <nav style="padding:16px"><a href="/pricing" style="color:#000">Pricing</a></nav>
        <header style="padding:24px">
          <h1 style="font-size:48px;color:#000">Welcome</h1>
          <p style="font-size:16px;color:#333">Subtitle line</p>
        </header>
        <section style="padding:24px">
          <article style="padding:16px">
            <h2 style="font-size:28px;color:#000">Article</h2>
            <button style="padding:12px 24px;background:#635BFF;color:#fff">Click me</button>
          </article>
        </section>
        <footer style="padding:16px">
          <small style="font-size:12px;color:#666">© 2026</small>
        </footer>
      </div>`;
    const { graph } = await importFromHtml(html);
    const nav = findByTag(graph, 'nav')[0];
    assert(nav?.semanticRole === 'nav', 'nav → role=nav');
    const header = findByTag(graph, 'header')[0];
    assert(header?.semanticRole === 'header', 'header → role=header');
    const footer = findByTag(graph, 'footer')[0];
    assert(footer?.semanticRole === 'footer', 'footer → role=footer');
    const h1 = findByTag(graph, 'h1')[0];
    assert(h1?.semanticRole === 'heading', 'h1 → role=heading');
    const h2 = findByTag(graph, 'h2')[0];
    assert(h2?.semanticRole === 'heading', 'h2 → role=heading');
    const section = findByTag(graph, 'section')[0];
    assert(section?.semanticRole === 'section', 'section → role=section');
    const article = findByTag(graph, 'article')[0];
    assert(article?.semanticRole === 'section', 'article → role=section');
    const button = findByTag(graph, 'button')[0];
    assert(button?.semanticRole === 'button', 'button → role=button');
    const link = findByTag(graph, 'a')[0];
    assert(link?.semanticRole === 'link', 'a → role=link');
    assert(link?.href === '/pricing', 'a href captured');
    const p = findByTag(graph, 'p')[0];
    assert(p?.semanticRole === 'paragraph', 'p → role=paragraph');
    const small = findByTag(graph, 'small')[0];
    assert(small?.semanticRole === 'caption', 'small → role=caption');
  }

  // ── 2. Class-name hints ────────────────────────────────────────
  console.log('  2. Class-name role hints');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <div class="hero" style="padding:48px;background:#111;color:#fff">
          <h1 style="font-size:56px">Big</h1>
          <div class="cta-primary btn" style="padding:16px 32px;background:#635BFF">Get started</div>
        </div>
        <div class="feature-card card" style="padding:24px;background:#fff;border:1px solid #eee">
          <div class="badge" style="padding:4px 8px;background:#eee">NEW</div>
          <div class="logo" style="width:120px;height:40px">LOGO</div>
        </div>
      </div>`;
    const { graph } = await importFromHtml(html);
    let foundHero = false, foundCta = false, foundCard = false, foundBadge = false, foundLogo = false;
    for (const n of graph.getAllNodes()) {
      if (n.semanticRole === 'hero') foundHero = true;
      if (n.semanticRole === 'cta') foundCta = true;
      if (n.semanticRole === 'card') foundCard = true;
      if (n.semanticRole === 'badge') foundBadge = true;
      if (n.semanticRole === 'logo') foundLogo = true;
    }
    assert(foundHero, 'class="hero" → role=hero');
    assert(foundCta, 'class="cta-primary" → role=cta');
    assert(foundCard, 'class="card" → role=card');
    assert(foundBadge, 'class="badge" → role=badge');
    assert(foundLogo, 'class="logo" → role=logo');
  }

  // ── 3. data-reframe-* overrides ────────────────────────────────
  console.log('  3. data-reframe-role/variant/slot');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <div data-reframe-role="dropdown" data-reframe-variant="outline"
             data-reframe-slot="nav-menu"
             style="padding:12px;background:#fff;border:1px solid #000">
          Menu
        </div>
      </div>`;
    const { graph } = await importFromHtml(html);
    let found: SceneNode | undefined;
    for (const n of graph.getAllNodes()) {
      if (n.meta?.sourceData?.['data-reframe-role'] === 'dropdown') { found = n; break; }
    }
    assert(!!found, 'data-reframe-* element located');
    assert(found?.semanticRole === 'dropdown', 'data-reframe-role=dropdown honored');
    assert(found?.meta?.variant === 'outline', 'data-reframe-variant captured');
    assert(found?.slot === 'nav-menu', 'data-reframe-slot → node.slot');
  }

  // ── 4. meta.source provenance ──────────────────────────────────
  console.log('  4. meta.source provenance');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <button id="primary-cta" class="btn btn-primary" data-testid="hero-cta"
                style="padding:12px 24px;background:#635BFF;color:#fff">
          Sign up
        </button>
      </div>`;
    const { graph } = await importFromHtml(html);
    const btn = findByTag(graph, 'button')[0];
    assert(!!btn, 'button element captured');
    assert(btn.meta.sourceTag === 'button', 'meta.sourceTag=button');
    assert(btn.meta.sourceClass === 'btn btn-primary', 'meta.sourceClass preserved');
    assert(btn.meta.sourceId === 'primary-cta', 'meta.sourceId preserved');
    assert(btn.meta.sourceData?.['data-testid'] === 'hero-cta', 'meta.sourceData preserves custom data-*');
    assert(btn.meta.variant === 'primary', 'variant hint from class=btn-primary');
    assert(typeof btn.meta.sourcePath === 'string' && btn.meta.sourcePath.includes('button'), 'sourcePath set');
  }

  // ── 5. Stable ids: same HTML twice → identical ids ─────────────
  console.log('  5. Stable ids determinism');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <section style="padding:24px"><h1 style="font-size:48px;color:#000">Title</h1></section>
        <section style="padding:24px"><h2 style="font-size:32px;color:#000">Subtitle</h2></section>
      </div>`;
    const a = await importFromHtml(html, { stableIds: true });
    const b = await importFromHtml(html, { stableIds: true });

    const idsA: string[] = [];
    const idsB: string[] = [];
    for (const n of a.graph.getAllNodes()) if (n.id.startsWith('h:')) idsA.push(n.id);
    for (const n of b.graph.getAllNodes()) if (n.id.startsWith('h:')) idsB.push(n.id);
    idsA.sort(); idsB.sort();

    assert(idsA.length > 0, 'stable ids produced (not empty)');
    assert(idsA.length === idsB.length, `both runs produced same count: ${idsA.length} vs ${idsB.length}`);
    assert(JSON.stringify(idsA) === JSON.stringify(idsB), 'stable ids bit-for-bit identical across runs');
    assert(a.rootId === b.rootId, `stable rootId matches: ${a.rootId} === ${b.rootId}`);
  }

  // ── 6. Legacy (counter) id mode still works ────────────────────
  console.log('  6. Legacy counter ids (opt-out)');
  {
    const html = `<div style="width:600px;height:400px;background:#fff"><h1>Hi</h1></div>`;
    const result = await importFromHtml(html); // stableIds defaults to false
    let hasStable = false;
    for (const n of result.graph.getAllNodes()) {
      if (n.id.startsWith('h:')) hasStable = true;
    }
    assert(!hasStable, 'no stable ids when opt-out');
    assert(result.rootId.startsWith('0:'), 'root uses counter id format');
  }

  // ── 7. Round-trip serialize → deserialize preserves stable ids ─
  console.log('  7. Stable ids survive serialize/deserialize');
  {
    const html = `
      <div style="width:1200px;height:800px;background:#fff">
        <nav style="padding:16px"><a href="/x" style="color:#000">Link</a></nav>
        <main style="padding:24px">
          <button style="padding:12px;background:#000;color:#fff">Hit</button>
        </main>
      </div>`;
    const { graph, rootId } = await importFromHtml(html, { stableIds: true });
    const envelope = serializeGraph(graph, rootId);
    const { graph: g2, rootId: r2 } = deserializeScene(envelope);

    assert(r2 === rootId, `root id preserved: ${r2} === ${rootId}`);

    const idsBefore = [...graph.getAllNodes()].map(n => n.id).filter(id => id.startsWith('h:')).sort();
    const idsAfter = [...g2.getAllNodes()].map(n => n.id).filter(id => id.startsWith('h:')).sort();
    assert(idsBefore.length > 0 && idsBefore.length === idsAfter.length,
           `stable id count preserved: ${idsBefore.length} / ${idsAfter.length}`);
    assert(JSON.stringify(idsBefore) === JSON.stringify(idsAfter), 'every stable id round-tripped');

    // meta must round-trip too
    let metaPreserved = 0;
    for (const n of g2.getAllNodes()) {
      if (n.meta?.sourceTag) metaPreserved++;
    }
    assert(metaPreserved > 0, `meta.sourceTag preserved on ${metaPreserved} nodes after deserialize`);
  }

  // ── 8. @media queries → responsive[] ───────────────────────────
  console.log('  8. @media queries → responsive rules');
  {
    const html = `
      <style>
        .hero { padding: 48px; font-size: 56px; }
        @media (max-width: 768px) {
          .hero { padding: 16px; font-size: 32px; }
          .hero h1 { font-weight: 600; }
        }
        @media (max-width: 375px) {
          .hero { padding: 8px; font-size: 24px; gap: 4px; display: none; }
        }
      </style>
      <div style="width:1200px;height:800px;background:#fff">
        <section class="hero" style="background:#111;color:#fff">
          <h1 style="color:#fff">Huge title</h1>
        </section>
      </div>`;
    const { graph } = await importFromHtml(html);
    let hero: SceneNode | undefined;
    for (const n of graph.getAllNodes()) {
      if (n.meta?.sourceClass?.includes('hero') && n.meta.sourceTag === 'section') { hero = n; break; }
    }
    assert(!!hero, 'hero section found');
    assert(hero!.responsive.length === 2, `two breakpoints (got ${hero!.responsive.length})`);

    // Descending sort: 768 first, 375 second
    assert(hero!.responsive[0].maxWidth === 768, 'first rule maxWidth=768');
    assert(hero!.responsive[1].maxWidth === 375, 'second rule maxWidth=375');

    const rule768 = hero!.responsive[0].props as any;
    assert(rule768.fontSize === 32, `rule@768 fontSize=32 (got ${rule768.fontSize})`);
    assert(rule768.paddingTop === 16 && rule768.paddingLeft === 16, 'rule@768 padding=16 all sides');

    const rule375 = hero!.responsive[1].props as any;
    assert(rule375.fontSize === 24, 'rule@375 fontSize=24');
    assert(rule375.paddingTop === 8, 'rule@375 padding=8');
    assert(rule375.itemSpacing === 4, 'rule@375 gap → itemSpacing');
    assert(rule375.visible === false, 'rule@375 display:none → visible=false');
  }

  // ── 9. Nested / adversarial @media ─────────────────────────────
  console.log('  9. Adversarial @media');
  {
    const html = `
      <style>
        @media (min-width: 1024px) { .nope { color: red; } }
        @media screen and (max-width: 640px) { .grid { padding: 12px; } }
        @media (max-width: 20em) { .grid { font-size: 14px; } }
      </style>
      <div style="width:1200px;height:600px;background:#fff">
        <div class="nope grid" style="padding:24px;font-size:18px">hello</div>
      </div>`;
    const { graph } = await importFromHtml(html);
    let grid: SceneNode | undefined;
    for (const n of graph.getAllNodes()) {
      if (n.meta?.sourceClass?.includes('grid')) { grid = n; break; }
    }
    assert(!!grid, 'grid element found');
    // Expect 2 rules: (max-width:640px) and (max-width:320px ≈ 20em)
    assert(grid!.responsive.length === 2, `two max-width rules accepted (got ${grid!.responsive.length})`);
    const mws = grid!.responsive.map(r => r.maxWidth).sort((a, b) => a - b);
    assert(mws[0] === 320 && mws[1] === 640, `breakpoints parsed: ${mws.join(',')}`);
    // min-width rule must be ignored
    assert(!grid!.responsive.some(r => (r.props as any).color === 'red'),
      'min-width rule ignored');
  }

  // ── 10. Duplicate subtree → unique ids via collision suffix ────
  console.log('  10. Stable id collision guard');
  {
    const html = `
      <div style="width:1200px;height:600px;background:#fff">
        <section style="padding:24px">
          <div style="padding:12px;background:#eee"><span style="font-size:16px">Same</span></div>
          <div style="padding:12px;background:#eee"><span style="font-size:16px">Same</span></div>
        </section>
      </div>`;
    const { graph } = await importFromHtml(html, { stableIds: true });
    const ids = [...graph.getAllNodes()].map(n => n.id).filter(id => id.startsWith('h:'));
    const uniq = new Set(ids);
    assert(ids.length === uniq.size, `all stable ids unique (${ids.length} nodes)`);
    assert(ids.length >= 5, `enough nodes produced (${ids.length})`);

    // Re-run — must still be stable despite duplicates
    const b = await importFromHtml(html, { stableIds: true });
    const idsB = [...b.graph.getAllNodes()].map(n => n.id).filter(id => id.startsWith('h:')).sort();
    const idsA = ids.sort();
    assert(JSON.stringify(idsA) === JSON.stringify(idsB), 'duplicate-subtree ids still deterministic');
  }

  // ── 11. Interactive tag beats class hint ───────────────────────
  console.log('  11. Interactive tag precedence');
  {
    const html = `
      <div style="width:600px;height:400px;background:#fff">
        <button class="hero-cta" style="padding:12px;background:#000;color:#fff">Go</button>
      </div>`;
    const { graph } = await importFromHtml(html);
    const btn = findByTag(graph, 'button')[0];
    assert(btn?.semanticRole === 'button', 'button tag beats .hero-cta class hint');
  }

  // ── 12. Empty HTML + malformed input don't throw ───────────────
  console.log('  12. Robustness: empty / malformed');
  {
    const r1 = await importFromHtml('<div style="width:100px;height:100px">x</div>', { stableIds: true });
    assert(r1.rootId.length > 0, 'single div stable import');

    const r2 = await importFromHtml(
      `<style>@media { .broken { color } }</style><div style="width:100px;height:100px">x</div>`,
    );
    assert(r2.rootId.length > 0, 'malformed @media does not throw');
  }

  console.log(`\n═══ PHASE 1: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error('CRASH', e);
  process.exit(1);
});
