/**
 * Phase 7.1 Platform HTTP stress test.
 *
 * Boots the sidecar on an ephemeral port, hits every platform route + API
 * endpoint, verifies response codes and key content fragments. No browser,
 * no vitest — plain tsx runner with manual asserts, same style as all the
 * other phase tests.
 *
 * Run: npx tsx packages/mcp/src/tests/phase7-platform-http.test.ts
 */

// Disable the sidecar auto-start that happens as a side-effect of storeScene
// so our explicit start on a specific port wins.
process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startHttpSidecar } from '../http-server.js';
import { setProjectDir } from '../tools/project.js';
import { storeScene, setProjectDir as setStoreProjectDir } from '../store.js';
import { initProject, compileHtmlIntoProject, saveComponentMaster, saveMacro } from '../../../core/src/project/index.js';
import { importFromHtml } from '../../../core/src/importers/html.js';
import type { Operation } from '../../../core/src/ops/types.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}

const PORT = 4200 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PORT}`;

async function fetchText(path: string, init?: RequestInit): Promise<{ status: number; body: string; contentType?: string }> {
  const res = await fetch(BASE + path, init);
  const body = await res.text();
  return {
    status: res.status,
    body,
    contentType: res.headers.get('content-type') ?? undefined,
  };
}

async function fetchJson(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* leave as null */ }
  return { status: res.status, json };
}

async function main() {
  console.log('═══ PHASE 7.1: Platform HTTP Stress Test ═══\n');

  // ── Setup: tmp project with a scene, a component, a macro ──
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-p71-'));
  try {
    initProject(dir, 'Phase 7.1 Test');
    setProjectDir(dir);
    setStoreProjectDir(dir);

    // Compile a scene so sessionScenes is non-empty
    const compiled = await compileHtmlIntoProject(dir, `
      <div style="width:1200px;background:#ffffff;padding:32px">
        <h1 style="font-size:48px;color:#061b31">Platform test</h1>
        <button style="padding:12px;background:#533afd;color:#fff;border-radius:4px">CTA</button>
      </div>
    `, { name: 'hero' });
    // storeScene may disambiguate the slug when the on-disk project already
    // has a "hero" scene from the compile step above — read the real slug
    // back from the session list so the test URL matches.
    storeScene(compiled.graph, compiled.rootId, undefined, { name: 'hero', slug: 'hero' });
    const { listScenes: listStoreScenes } = await import('../store.js');
    const sessionList = listStoreScenes();
    const heroSession = sessionList.find(s => s.name === 'hero' || s.slug === 'hero' || s.slug?.startsWith('hero'));
    const heroSlug = heroSession?.slug ?? 'hero';
    console.log(`  (hero session slug resolved to: ${heroSlug})`);

    // Save a component master
    const cardImport = await importFromHtml(`
      <div style="width:280px;background:#fff;border:1px solid #eee;border-radius:8px;padding:20px">
        <div data-reframe-slot="title" style="font-size:20px;color:#061b31">Title</div>
        <div data-reframe-slot="price" style="font-size:32px;color:#533afd">$0</div>
      </div>
    `, { stableIds: true });
    saveComponentMaster(dir, 'TestCard', cardImport.graph, cardImport.rootId, {
      description: 'Reusable card',
    });

    // Save a macro
    saveMacro(dir, 'brutalize', [
      { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:button', props: { name: 'BRUTAL' } },
    ] as Operation[], 'Make everything brutal');

    // Start sidecar NOW with our explicit port — auto-start was suppressed
    // at the top of the file so we control binding timing.
    delete process.env.REFRAME_SKIP_HTTP_SIDECAR;
    startHttpSidecar(PORT);
    // Give the server a moment to bind
    await new Promise(r => setTimeout(r, 300));

    // ── 1. Static assets ────────────────────────────────
    console.log('  1. Static assets (css, js)');
    {
      const css = await fetchText('/platform/style.css');
      assert(css.status === 200, 'style.css 200');
      assert(!!css.contentType && css.contentType.includes('text/css'), 'css content-type');
      assert(css.body.includes('.app'), 'css contains .app class');
      assert(css.body.includes('--accent'), 'css has design tokens');

      const js = await fetchText('/platform/app.js');
      assert(js.status === 200, 'app.js 200');
      assert(!!js.contentType && js.contentType.includes('javascript'), 'js content-type');
      assert(js.body.includes('EventSource'), 'js subscribes to SSE');
    }

    // ── 2. Dashboard with scenes ────────────────────────
    console.log('  2. Dashboard renders with scenes');
    {
      const r = await fetchText('/platform');
      assert(r.status === 200, 'dashboard 200');
      assert(r.body.includes('<!DOCTYPE html>'), 'full HTML document');
      assert(r.body.includes('reframe'), 'brand in header');
      assert(r.body.includes('overview-card'), 'scene cards rendered');
      assert(r.body.includes('hero'), 'scene name present');
      assert(r.body.includes('/platform/app.js'), 'js script referenced');
      assert(r.body.includes('/platform/style.css'), 'css link referenced');
    }

    // ── 3. Dashboard trailing slash ─────────────────────
    console.log('  3. Dashboard with trailing slash');
    {
      const r = await fetchText('/platform/');
      assert(r.status === 200, '/platform/ 200');
    }

    // ── 4. Scene page ──────────────────────────────────
    console.log('  4. Scene page route');
    {
      const r = await fetchText(`/platform/scene/${heroSlug}`);
      assert(r.status === 200, `/platform/scene/${heroSlug} 200`);
      assert(r.body.includes('viewport-area'), 'viewport area present');
      assert(r.body.includes('viewport-frame'), 'viewport frame present');
      assert(r.body.includes('data-vp="desktop"'), 'desktop switcher button');
      assert(r.body.includes('data-vp="tablet"'), 'tablet switcher button');
      assert(r.body.includes('data-vp="mobile"'), 'mobile switcher button');
      assert(r.body.includes('right-tab'), 'right panel tabs present');
      assert(r.body.includes('data-tab="ai"'), 'activity tab present');
      assert(r.body.includes('data-tab="design"'), 'design tab present');
      assert(r.body.includes('annotations'), 'annotation SVG overlay');
      assert(r.body.includes('bottom-bar'), 'bottom bar present');
      assert(r.body.includes('audit-summary'), 'audit summary present');
      assert(r.body.includes(`data-scene="${heroSlug}"`), 'scene slug in data attribute');
    }

    // ── 5. Scene inspector 404 ──────────────────────────
    console.log('  5. Missing scene 404');
    {
      const r = await fetchText('/platform/scene/nonexistent');
      assert(r.status === 404, '404 for missing scene');
      assert(r.body.includes('not found'), 'user-friendly message');
    }

    // ── 6. Components gallery ───────────────────────────
    console.log('  6. Components gallery');
    {
      const r = await fetchText('/platform/components');
      assert(r.status === 200, 'components 200');
      assert(r.body.includes('TestCard'), 'component name rendered');
      assert(r.body.includes('Reusable card'), 'description rendered');
    }

    // ── 7. Design system page ───────────────────────────
    console.log('  7. Design system page');
    {
      const r = await fetchText('/platform/design-system');
      assert(r.status === 200, 'design-system 200');
      assert(r.body.includes('Design system'), 'heading rendered');
      // No design md loaded → "no brand" message
      assert(r.body.includes('No brand loaded') || r.body.includes('Active brand'), 'brand state rendered');
    }

    // ── 8. Macros gallery ───────────────────────────────
    console.log('  8. Macros gallery');
    {
      const r = await fetchText('/platform/macros');
      assert(r.status === 200, 'macros 200');
      assert(r.body.includes('brutalize'), 'macro name rendered');
      assert(r.body.includes('Make everything brutal'), 'macro description rendered');
    }

    // ── 9. API: list intents (empty) ────────────────────
    console.log('  9. API: intent/list (initially empty)');
    {
      const r = await fetchJson('/platform/api/intent/list');
      assert(r.status === 200, 'list 200');
      assert(r.json?.ok === true, 'ok=true');
      assert(Array.isArray(r.json?.intents), 'intents is array');
      assert(r.json.intents.length === 0, 'initially empty');
    }

    // ── 10. API: add intent ─────────────────────────────
    console.log('  10. API: intent/add');
    let createdId: string | null = null;
    {
      const r = await fetchJson('/platform/api/intent/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [
            { kind: 'text', value: 'make hero bigger' },
            { kind: 'select', nodes: ['h:abc'] },
          ],
          sceneSlug: 'hero',
          label: 'test intent',
        }),
      });
      assert(r.status === 200, 'add 200');
      assert(r.json?.ok === true, 'ok=true');
      assert(!!r.json?.intent?.id, 'intent has id');
      assert(r.json.intent.status === 'draft', 'status=draft');
      assert(r.json.intent.parts.length === 2, '2 parts');
      createdId = r.json.intent.id;
    }

    // ── 11. API: add-part ───────────────────────────────
    console.log('  11. API: intent/add-part');
    {
      const r = await fetchJson('/platform/api/intent/add-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId: createdId,
          part: { kind: 'priority', value: 'must' },
        }),
      });
      assert(r.status === 200, 'add-part 200');
      assert(r.json?.ok === true, 'ok=true');

      // Verify via get
      const g = await fetchJson(`/platform/api/intent/get?id=${createdId}`);
      assert(g.json?.intent?.parts?.length === 3, '3 parts after add');
    }

    // ── 12. API: remove-part ────────────────────────────
    console.log('  12. API: intent/remove-part');
    {
      const r = await fetchJson('/platform/api/intent/remove-part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intentId: createdId,
          partIndex: 0,
        }),
      });
      assert(r.status === 200, 'remove-part 200');
      const g = await fetchJson(`/platform/api/intent/get?id=${createdId}`);
      assert(g.json?.intent?.parts?.length === 2, '2 parts after remove');
    }

    // ── 13. API: commit ─────────────────────────────────
    console.log('  13. API: intent/commit');
    {
      const r = await fetchJson('/platform/api/intent/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: createdId }),
      });
      assert(r.status === 200, 'commit 200');
      assert(r.json?.ok === true, 'ok=true');

      const g = await fetchJson(`/platform/api/intent/get?id=${createdId}`);
      assert(g.json?.intent?.status === 'queued', 'status=queued after commit');
    }

    // ── 14. API: list after commit ──────────────────────
    console.log('  14. API: list shows the queued intent');
    {
      const r = await fetchJson('/platform/api/intent/list');
      assert(r.json.intents.length === 1, '1 intent in list');
      assert(r.json.intents[0].status === 'queued', 'status=queued');
    }

    // ── 15. API: mark-processing → accept flow ──────────
    console.log('  15. API: mark-processing → accept');
    {
      const mp = await fetchJson('/platform/api/intent/mark-processing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: createdId, processorId: 'platform-test' }),
      });
      assert(mp.status === 200, 'mark-processing 200');

      // simulate agent having proposed ops via direct engine call
      const { proposeOps } = await import('../../../core/src/project/intents/index.js');
      proposeOps(dir, createdId!, ['op-a', 'op-b']);

      const acc = await fetchJson('/platform/api/intent/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: createdId }),
      });
      assert(acc.status === 200, 'accept 200');

      const g = await fetchJson(`/platform/api/intent/get?id=${createdId}`);
      assert(g.json?.intent?.status === 'accepted', 'status=accepted');
      assert(g.json?.intent?.acceptedOpIds?.length === 2, '2 op ids recorded');
    }

    // ── 16. API: reject flow ────────────────────────────
    console.log('  16. API: reject flow');
    {
      // Create + commit a new intent
      const add = await fetchJson('/platform/api/intent/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [{ kind: 'text', value: 'reject me' }],
        }),
      });
      const id2 = add.json.intent.id;
      await fetchJson('/platform/api/intent/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: id2 }),
      });
      await fetchJson('/platform/api/intent/mark-processing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: id2 }),
      });

      const r = await fetchJson('/platform/api/intent/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId: id2, reason: 'not what I wanted' }),
      });
      assert(r.status === 200, 'reject 200');

      const g = await fetchJson(`/platform/api/intent/get?id=${id2}`);
      assert(g.json?.intent?.status === 'rejected', 'status=rejected');
      assert(g.json?.intent?.rejectedReason === 'not what I wanted', 'reason recorded');
    }

    // ── 17. API: bad inputs ─────────────────────────────
    console.log('  17. API: error handling');
    {
      const r1 = await fetchJson('/platform/api/intent/get?id=nonexistent');
      assert(r1.status === 404, 'get missing → 404');
      assert(r1.json?.ok === false, 'ok=false');

      const r2 = await fetchJson('/platform/api/intent/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert(r2.status === 400, 'commit without id → 400');

      const r3 = await fetchJson('/platform/api/intent/unknown-action');
      assert(r3.status === 404, 'unknown route → 404');
    }

    // ── 18. Platform URL doesn't break existing routes ─
    console.log('  18. Legacy /health still works');
    {
      const h = await fetchText('/health');
      assert(h.status === 200, '/health still 200');
      assert(h.body.includes('version'), 'health returns version');
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`\n═══ PHASE 7.1 PLATFORM HTTP: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
  // Force exit because http-server keeps event loop alive
  setTimeout(() => process.exit(0), 100);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
