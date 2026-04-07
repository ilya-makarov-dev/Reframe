/**
 * Pipe — smoke tests
 *
 * Run: npx tsx src/pipe.test.ts
 */

import { NodeType } from '../host/types';
import { build, frame, rect, text, solid } from '../builder';
import { pipe, transform, concat, when, forEach, tap } from '../resize/pipe';
import { dedupeNames, setProp, removeWhere, snapshot, analyze } from '../resize/transforms';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// ── 1. Basic pipeline ──────────────────────────────

async function testBasicPipeline() {
  const { root } = build(
    frame({ width: 500, height: 500, name: 'Test' },
      rect({ width: 500, height: 500, fills: [solid('#FF0000')] }),
      text('Hello', { fontSize: 32 }),
    )
  );

  const noop = transform('noop', () => {});
  const setName = transform('rename', (r) => { r.name = 'Renamed'; });

  const result = await pipe(noop, setName).run(root);

  assert(result.root.name === 'Renamed', 'pipeline mutated root name');
  assert(result.trace.length === 2, 'trace has 2 entries');
  assert(result.trace[0].name === 'noop', 'first trace is noop');
  assert(result.trace[1].name === 'rename', 'second trace is rename');
  assert(result.totalMs >= 0, 'totalMs is non-negative');
}

// ── 2. Context passing ─────────────────────────────

async function testContextPassing() {
  const { root } = build(
    frame({ width: 300, height: 300 },
      text('A', { fontSize: 20 }),
      text('B', { fontSize: 24 }),
    )
  );

  const countTexts = transform('count-texts', (r, ctx) => {
    let count = 0;
    const walk = (n: typeof r) => {
      if (n.type === NodeType.Text) count++;
      if (n.children) for (const c of n.children) walk(c);
    };
    walk(r);
    ctx.state.set('textCount', count);
  });

  const readCount = transform('read-count', (_r, ctx) => {
    const count = ctx.state.get('textCount') as number;
    ctx.state.set('doubled', count * 2);
  });

  const result = await pipe(countTexts, readCount).run(root);

  assert(result.ctx.state.get('textCount') === 2, 'textCount is 2');
  assert(result.ctx.state.get('doubled') === 4, 'doubled is 4');
  assert(result.ctx.rootWidth === 300, 'rootWidth captured');
}

// ── 3. Concat ──────────────────────────────────────

async function testConcat() {
  const { root } = build(rect({ width: 100, height: 100 }));

  const p1 = pipe(transform('a', (_r, ctx) => { ctx.state.set('a', true); }));
  const p2 = pipe(transform('b', (_r, ctx) => { ctx.state.set('b', true); }));
  const merged = concat(p1, p2);

  const result = await merged.run(root);

  assert(merged.steps.length === 2, 'concat has 2 steps');
  assert(result.ctx.state.get('a') === true, 'a was set');
  assert(result.ctx.state.get('b') === true, 'b was set');
}

// ── 4. Conditional (when) ──────────────────────────

async function testWhen() {
  const { root } = build(frame({ width: 200, height: 200 }));

  const alwaysTrue = when(
    () => true,
    transform('runs', (_r, ctx) => { ctx.state.set('ran', true); }),
  );

  const alwaysFalse = when(
    () => false,
    transform('skipped', (_r, ctx) => { ctx.state.set('skipped', true); }),
  );

  const result = await pipe(alwaysTrue, alwaysFalse).run(root);

  assert(result.ctx.state.get('ran') === true, 'when(true) ran');
  assert(result.ctx.state.get('skipped') === undefined, 'when(false) skipped');
}

// ── 5. forEach ─────────────────────────────────────

async function testForEach() {
  const { root } = build(
    frame({ width: 400, height: 400 },
      text('Uno', { fontSize: 16 }),
      rect({ width: 50, height: 50 }),
      text('Dos', { fontSize: 16 }),
    )
  );

  let count = 0;
  const counter = forEach(
    n => n.type === NodeType.Text,
    transform('count', () => { count++; }),
  );

  await pipe(counter).run(root);
  assert(count === 2, 'forEach visited 2 text nodes');
}

// ── 6. tap ─────────────────────────────────────────

async function testTap() {
  const { root } = build(rect({ width: 50, height: 50 }));

  let tapped = false;
  const result = await pipe(
    tap('check', () => { tapped = true; }),
  ).run(root);

  assert(tapped, 'tap executed');
  assert(result.trace[0].name === 'tap:check', 'tap trace name');
}

// ── 7. Error trace ─────────────────────────────────

async function testErrorTrace() {
  const { root } = build(rect({ width: 50, height: 50 }));

  const bomb = transform('bomb', () => { throw new Error('boom'); });

  let caught = false;
  try {
    await pipe(bomb).run(root);
  } catch (e: any) {
    caught = true;
    assert(e.message === 'boom', 'error propagated');
  }
  assert(caught, 'error was thrown');
}

// ── 8. Built-in: dedupeNames ───────────────────────

async function testDedupeNames() {
  const { root } = build(
    frame({ width: 300, height: 300 },
      rect({ name: 'BG', width: 100, height: 100 }),
      rect({ name: 'BG', width: 100, height: 100 }),
      rect({ name: 'BG', width: 100, height: 100 }),
    )
  );

  await pipe(dedupeNames()).run(root);

  const names = root.children!.map(c => c.name);
  const unique = new Set(names);
  assert(unique.size === 3, `deduped to 3 unique names: ${names.join(', ')}`);
}

// ── 9. Built-in: setProp ───────────────────────────

async function testSetProp() {
  const { root } = build(
    frame({ width: 200, height: 200 },
      text('Hidden', { fontSize: 16 }),
      rect({ width: 50, height: 50 }),
    )
  );

  await pipe(
    setProp(n => n.type === NodeType.Text, { visible: false }),
  ).run(root);

  assert(root.children![0].visible === false, 'text is hidden');
  assert(root.children![1].visible === true, 'rect still visible');
}

// ── 10. Built-in: removeWhere ──────────────────────

async function testRemoveWhere() {
  const { root } = build(
    frame({ width: 200, height: 200 },
      rect({ name: 'keep', width: 50, height: 50 }),
      rect({ name: 'remove-me', width: 50, height: 50 }),
      rect({ name: 'keep2', width: 50, height: 50 }),
    )
  );

  await pipe(
    removeWhere(n => n.name === 'remove-me'),
  ).run(root);

  assert(root.children!.length === 2, 'one child removed');
  assert(root.children!.every(c => c.name !== 'remove-me'), 'correct child removed');
}

// ── 11. Built-in: snapshot ─────────────────────────

async function testSnapshot() {
  const { root } = build(
    frame({ width: 100, height: 100, name: 'Snap' },
      rect({ name: 'Child', width: 50, height: 50 }),
    )
  );

  const result = await pipe(snapshot('before')).run(root);

  const snap = result.ctx.state.get('snapshot:before') as any;
  assert(snap.name === 'Snap', 'snapshot captured root name');
  assert(snap.children?.length === 1, 'snapshot has children');
  assert(snap.children[0].name === 'Child', 'snapshot child name');
}

// ── 12. Built-in: analyze ──────────────────────────

async function testAnalyze() {
  const { root } = build(
    frame({ width: 500, height: 500 },
      text('Title', { fontSize: 32 }),
      rect({ width: 500, height: 500, fills: [solid('#000')] }),
    )
  );

  const result = await pipe(analyze()).run(root);

  const analysis = result.ctx.state.get('analysis') as any;
  assert(analysis !== undefined, 'analysis stored in context');
  assert(analysis.width === 500, 'analysis width');
  assert(analysis.hasTextNodes === true, 'analysis detected text');
}

// ── 13. Initial state ──────────────────────────────

async function testInitialState() {
  const { root } = build(rect({ width: 50, height: 50 }));

  const initial = new Map<string, unknown>([['preset', 42]]);
  const reader = transform('read', (_r, ctx) => {
    ctx.state.set('got', ctx.state.get('preset'));
  });

  const result = await pipe(reader).run(root, initial);
  assert(result.ctx.state.get('got') === 42, 'initial state passed through');
}

// ── Run All ────────────────────────────────────────

async function main() {
  await testBasicPipeline();
  await testContextPassing();
  await testConcat();
  await testWhen();
  await testForEach();
  await testTap();
  await testErrorTrace();
  await testDedupeNames();
  await testSetProp();
  await testRemoveWhere();
  await testSnapshot();
  await testAnalyze();
  await testInitialState();

  console.log(`\n  Pipe tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main();
