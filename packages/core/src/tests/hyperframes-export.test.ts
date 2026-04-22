/**
 * Hyperframes exporter — reframe scene → hyperframes composition HTML.
 *
 * Verifies that exporting a scene via `exportToHyperframes` produces HTML
 * that matches the shape hyperframes CLI consumes:
 *   - `<div id="stage" data-composition-id data-width data-height data-start>`
 *   - inner scene tree with `data-id` on every element (targets for GSAP)
 *   - GSAP script block when a timeline is provided
 *   - composition duration derived from longest animation
 *
 * Run: `npx tsx src/tests/hyperframes-export.test.ts` from `packages/core`.
 */

import { importFromHtml } from '../importers/html';
import { exportToHyperframes } from '../exporters/hyperframes';
import type { ITimeline } from '../animation/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main(): Promise<void> {
  const html = `
<div id="root" style="width:1440px;height:900px;background:#0a0a0a;padding:40px;display:flex;flex-direction:column;gap:20px;">
  <h1 id="hero" style="width:600px;height:64px;font-size:56px;font-weight:700;color:#ffffff;">Launch faster.</h1>
  <p id="sub" style="width:600px;height:40px;font-size:18px;color:#cccccc;">From prototype to production.</p>
  <button id="cta" style="width:160px;height:44px;background:#3366ff;color:#ffffff;border-radius:8px;">Get started</button>
</div>
  `.trim();

  const { graph, rootId } = await importFromHtml(html);

  // ── Test 1 — Static composition (no timeline) ─────────────
  {
    const res = exportToHyperframes(graph, rootId, { compositionId: 'hero-static' });
    assert(res.html.includes('<div id="stage"'), 'stage root present');
    assert(res.html.includes('data-composition-id="hero-static"'), 'composition id on stage');
    assert(res.html.includes('data-width="1440"'), 'width derived from root');
    assert(res.html.includes('data-height="900"'), 'height derived from root');
    assert(res.html.includes('data-start="0"'), 'composition starts at 0');
    assert(res.html.includes('data-duration='), 'composition carries a duration');
    assert(res.html.includes('data-id='), 'inner nodes have data-id for GSAP targeting');
    assert(!res.html.includes('gsap.timeline'), 'no GSAP calls without a timeline');
    assert(res.html.includes('unpkg.com/gsap'), 'GSAP CDN still injected (author may add anims)');
    assert(res.animationsEmitted === 0, `static export emits 0 anims (got ${res.animationsEmitted})`);
    assert(res.durationSeconds === 3, `static duration defaults to 3s (got ${res.durationSeconds})`);
  }

  // ── Test 2 — Composition with timeline ────────────────────
  {
    // Find the hero node id via the DOM marker.
    const heroId = (() => {
      for (const [id, n] of (graph as any).nodes as Map<string, any>) {
        if (n.meta?.sourceId === 'hero' || n.name === 'hero' || n.text === 'Launch faster.') return id;
      }
      return null;
    })();

    const timeline: ITimeline = {
      name: 'hero-reveal',
      animations: [
        {
          nodeId: heroId ?? 'missing',
          keyframes: [
            { offset: 0, properties: { opacity: 0, y: 20 } },
            { offset: 1, properties: { opacity: 1, y: 0 }, easing: 'ease-out' },
          ],
          duration: 800,
          delay: 200,
        },
      ],
    };

    const res = exportToHyperframes(graph, rootId, {
      compositionId: 'hero-reveal',
      timeline,
    });

    assert(res.html.includes('gsap.timeline'), 'timeline emits GSAP tween');
    assert(res.html.includes(`[data-id=\\"${heroId}\\"]`) || res.html.includes(`[data-id="${heroId}"]`),
      `GSAP selector targets heroId=${heroId}`);
    assert(res.html.includes('duration: 0.8'), 'segment duration converted ms→s (800→0.8)');
    // Delay is applied via `master.add(sub, delaySec)` — NOT as a timeline
    // option — so hyperframes can seek the master timeline frame-by-frame.
    assert(res.html.includes('master.add(sub, 0.2)'), 'start delay via master.add(sub, 0.2) [ms→s]');
    assert(res.html.includes('window.__timelines'), 'master registered on window.__timelines for hyperframes scrub');
    assert(res.animationsEmitted === 1, `1 animation emitted (got ${res.animationsEmitted})`);
    assert(res.durationSeconds === 1, `duration ceil((200+800)/1000)=1 (got ${res.durationSeconds})`);
  }

  // ── Test 3 — gsapUrl override ─────────────────────────────
  {
    const res = exportToHyperframes(graph, rootId, { gsapUrl: null });
    assert(!res.html.includes('unpkg.com/gsap'), 'gsapUrl:null skips GSAP script');
  }

  // ── Test 4 — custom composition dims ──────────────────────
  {
    const res = exportToHyperframes(graph, rootId, {
      width: 1080, height: 1920, compositionId: 'story',
    });
    assert(res.html.includes('data-width="1080"') && res.html.includes('data-height="1920"'),
      'custom dims override root');
    assert(res.width === 1080 && res.height === 1920, 'result mirrors dims');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
