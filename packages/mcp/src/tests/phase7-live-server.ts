/**
 * Live demo runner — boots sidecar on :4100 with 2 scenes, 1 component,
 * 1 macro + a couple of pre-seeded intents so every Platform page has real
 * content to render. Keeps running until Ctrl+C.
 *
 * Run: npx tsx packages/mcp/src/tests/phase7-live-server.ts
 */

process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startHttpSidecar } from '../http-server.js';
import { setProjectDir } from '../tools/project.js';
import { storeScene, setProjectDir as setStoreProjectDir, listScenes as listStoreScenes } from '../store.js';
import { initProject, compileHtmlIntoProject, saveComponentMaster, saveMacro } from '../../../core/src/project/index.js';
import { importFromHtml } from '../../../core/src/importers/html.js';
import { createDraft, commitDraft } from '../../../core/src/project/intents/index.js';
import type { Operation } from '../../../core/src/ops/types.js';

const PORT = 4100;

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-live-'));
  initProject(dir, 'Live Demo');
  setProjectDir(dir);
  setStoreProjectDir(dir);

  const heroCompiled = await compileHtmlIntoProject(dir, `
    <div style="width:1440px;background:#0b0d10;color:#ffffff;padding:96px;font-family:Inter,sans-serif">
      <h1 style="font-size:72px;font-weight:800;margin:0 0 24px">Reframe Platform</h1>
      <p style="font-size:20px;color:#98a2b3;margin:0 0 48px">Intent-first design surface</p>
      <div style="display:flex;gap:16px">
        <button style="height:48px;padding:0 32px;background:#635bff;color:#ffffff;border:0;border-radius:8px;font-size:16px">Get started</button>
        <button style="height:48px;padding:0 32px;background:#0b0d10;color:#ffffff;border:1px solid #344054;border-radius:8px;font-size:16px">Docs</button>
      </div>
    </div>
  `, { name: 'hero' });
  storeScene(heroCompiled.graph, heroCompiled.rootId, undefined, { name: 'hero', slug: 'hero' });

  const pricingCompiled = await compileHtmlIntoProject(dir, `
    <div style="width:1440px;background:#ffffff;color:#0b0d10;padding:96px;font-family:Inter,sans-serif">
      <h1 style="font-size:64px;font-weight:700;margin:0 0 32px">Pricing</h1>
      <div style="display:flex;gap:24px">
        <div style="flex:1;background:#f9fafb;color:#0b0d10;padding:32px;border:1px solid #eaecf0;border-radius:12px">
          <div style="font-size:14px;color:#667085">Starter</div>
          <div style="font-size:48px;font-weight:700;margin:8px 0">$0</div>
        </div>
        <div style="flex:1;background:#0b0d10;color:#ffffff;padding:32px;border-radius:12px">
          <div style="font-size:14px;color:#98a2b3">Pro</div>
          <div style="font-size:48px;font-weight:700;margin:8px 0">$29</div>
        </div>
      </div>
    </div>
  `, { name: 'pricing' });
  storeScene(pricingCompiled.graph, pricingCompiled.rootId, undefined, { name: 'pricing', slug: 'pricing' });

  const cardImport = await importFromHtml(`
    <div style="width:320px;background:#ffffff;color:#0b0d10;border:1px solid #eaecf0;border-radius:12px;padding:24px">
      <div data-reframe-slot="title" style="font-size:20px;font-weight:700">Title</div>
      <div data-reframe-slot="body" style="font-size:14px;color:#667085;margin-top:8px">Body text</div>
    </div>
  `, { stableIds: true });
  saveComponentMaster(dir, 'Card', cardImport.graph, cardImport.rootId, {
    description: 'Reusable card with title + body slots',
  });

  saveMacro(dir, 'brutalize', [
    { id: '1', timestamp: 't', type: 'setProps', nodeId: '$role:button', props: { name: 'BRUTAL' } },
  ] as Operation[], 'Make all CTAs brutal');

  const sessionList = listStoreScenes();
  const heroSlug = sessionList.find(s => s.name === 'hero')?.slug ?? 'hero';

  const draft = createDraft(dir, [
    { kind: 'text', value: 'Make the hero feel more premium' },
    { kind: 'direction', value: 'subtler' },
  ], { author: { kind: 'human', id: 'live-demo' }, label: 'Hero polish', sceneSlug: heroSlug });
  commitDraft(dir, draft.id);

  createDraft(dir, [
    { kind: 'text', value: 'Swap the dark card to a gradient' },
    { kind: 'select', nodes: ['pricing-pro'] },
  ], { author: { kind: 'human', id: 'live-demo' }, label: 'Pricing gradient', sceneSlug: 'pricing' });

  delete process.env.REFRAME_SKIP_HTTP_SIDECAR;
  startHttpSidecar(PORT);
  await new Promise(r => setTimeout(r, 300));

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  REFRAME PLATFORM — LIVE');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('  Dashboard:     http://localhost:' + PORT + '/platform');
  console.log('  Scene hero:    http://localhost:' + PORT + '/platform/scene/' + heroSlug);
  console.log('  Scene pricing: http://localhost:' + PORT + '/platform/scene/pricing');
  console.log('  Components:    http://localhost:' + PORT + '/platform/components');
  console.log('  Design system: http://localhost:' + PORT + '/platform/design-system');
  console.log('  Macros:        http://localhost:' + PORT + '/platform/macros');
  console.log('');
  console.log('  API example:   http://localhost:' + PORT + '/platform/api/intent/list');
  console.log('');
  console.log('  Project dir:   ' + dir);
  console.log('  Ctrl+C to stop');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
