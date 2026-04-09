/**
 * reframe_inspect diffStructured — two content blocks, JSON payload in content[1].
 *
 * Run: npx tsx scripts/test-inspect-diff-structured.ts
 *
 * Sets REFRAME_SKIP_HTTP_SIDECAR in main so storeScene() does not start the MCP HTTP sidecar.
 * Other scripts that call storeScene without needing HTTP can do the same (see .env.example).
 */

import { initYoga } from '../packages/core/src/engine/yoga-init.js';
import { build, frame, solid } from '../packages/core/src/builder.js';
import { clearScenes, storeScene } from '../packages/mcp/src/store.js';
import { handleInspect } from '../packages/mcp/src/tools/inspect.js';

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error('[FAIL]', msg);
    process.exit(1);
  }
}

async function main() {
  process.env.REFRAME_SKIP_HTTP_SIDECAR = '1';
  await initYoga();
  clearScenes();

  const { graph: g1, root: r1 } = build(
    frame({ width: 100, height: 50, name: 'SceneA', fills: [solid('#111827')] }),
  );
  const { graph: g2, root: r2 } = build(
    frame({ width: 200, height: 50, name: 'SceneB', fills: [solid('#222222')] }),
  );
  const s1 = storeScene(g1, r1.id, undefined, { name: 'diff-a' });
  const s2 = storeScene(g2, r2.id, undefined, { name: 'diff-b' });

  const out = await handleInspect({
    sceneId: s1,
    diffWith: s2,
    tree: false,
    audit: false,
    diffStructured: true,
  });

  assert(out.content.length === 2, `expected 2 content blocks, got ${out.content.length}`);
  assert(out.content[0].type === 'text', 'content[0] is text');
  assert(out.content[1].type === 'text', 'content[1] is text');

  const payload = JSON.parse(out.content[1].text) as {
    kind?: string;
    version?: number;
    detail?: string;
    sceneA?: string;
    sceneB?: string;
    sceneNames?: { a?: string | null; b?: string | null };
    result?: { entries?: unknown[]; summary?: Record<string, number> };
  };

  assert(payload.kind === 'reframe.structuralDiff', 'payload.kind');
  assert(payload.version === 1, 'payload.version');
  assert(payload.detail === 'full', 'payload.detail full');
  assert(payload.sceneA === s1 && payload.sceneB === s2, 'scene ids');
  assert(payload.sceneNames?.a === 'SceneA' && payload.sceneNames?.b === 'SceneB', 'sceneNames');
  assert(Array.isArray(payload.result?.entries), 'result.entries');
  assert(
    typeof payload.result?.summary?.modified === 'number',
    'result.summary.modified',
  );

  const outSum = await handleInspect({
    sceneId: s1,
    diffWith: s2,
    tree: false,
    audit: false,
    diffStructured: true,
    diffStructuredDetail: 'summary',
  });
  assert(outSum.content.length === 2, 'summary: two blocks');
  const paySum = JSON.parse(outSum.content[1].text) as {
    detail?: string;
    result?: { entries?: unknown[]; summary?: Record<string, number> };
  };
  assert(paySum.detail === 'summary', 'detail summary');
  assert(paySum.result?.entries === undefined, 'summary omits entries');
  assert(typeof paySum.result?.summary?.modified === 'number', 'summary counts');

  const outSingle = await handleInspect({
    sceneId: s1,
    diffWith: s2,
    tree: false,
    audit: false,
    diffStructured: false,
  });
  assert(outSingle.content.length === 1, 'diffStructured false → single block');

  const outShortText = await handleInspect({
    sceneId: s1,
    diffWith: s2,
    tree: false,
    audit: false,
    diffStructured: false,
    diffTextDetail: 'summary',
  });
  const bodyShort = outShortText.content[0]?.text ?? '';
  assert(bodyShort.includes('per-entry lines omitted'), 'diffTextDetail summary hint');
  assert(!bodyShort.includes('~ [FRAME]'), 'diffTextDetail summary skips modified lines');

  console.log('[OK] reframe_inspect diffStructured');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
