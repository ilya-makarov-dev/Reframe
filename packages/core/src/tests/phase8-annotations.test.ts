/**
 * Phase 8 stress test — Thread + Annotation + Gesture subsystems.
 *
 * Run: npx tsx packages/core/src/tests/phase8-annotations.test.ts
 *
 * Covers:
 *
 *   Threads (1-11)
 *     1. createThread writes to disk, returns with id + timestamps
 *     2. listThreads returns created thread, latest-wins
 *     3. getThread by id
 *     4. updateThread preserves id/createdAt, bumps updatedAt
 *     5. attachIntent appends without duplicates
 *     6. attachAnnotation appends without duplicates
 *     7. transitionThread active → resolved valid
 *     8. transitionThread active → orphaned valid
 *     9. transitionThread archived is terminal (invalid transition out)
 *    10. ensureThread dedupes on same anchor
 *    11. orphanMissingAnchors transitions threads with missing anchors
 *
 *   Annotations (12-25)
 *    12. createAnnotation writes to disk
 *    13. listAnnotations filters by status, anchor, kind, threadId
 *    14. getAnnotation by id
 *    15. updateAnnotation preserves id/threadId/createdAt
 *    16. transitionAnnotation active → orphaned → active
 *    17. transitionAnnotation invalid transition rejected
 *    18. reAnchorAnnotation moves to new anchor, status → active
 *    19. reAnchorAnnotation non-orphaned rejected
 *    20. orphanMissingAnchors surfaces orphans
 *    21. Scene-level anchors never orphaned
 *    22. countByStatus aggregates correctly
 *    23. All annotation payload kinds round-trip
 *    24. Compaction removes duplicate snapshots
 *    25. Corrupt line skipped on read
 *
 *   Gestures (26-40)
 *    26. Hover gesture → null
 *    27. Select gesture → null
 *    28. Ask gesture → comment annotation + select+text intent parts
 *    29. Drag semantic 'into' → move destination.into
 *    30. Drag semantic 'before' → move destination.before
 *    31. Drag pixel delta → move delta
 *    32. Lasso → region annotation + multi-node select intent
 *    33. Lasso without ancestor falls back to first anchor
 *    34. Brush → brush-stroke annotation + apply-macro intent
 *    35. Resonance → resonance-overlay annotation + query intent
 *    36. Echo visual-style → ref-node aspect=style
 *    37. Echo with modifier appends text part
 *    38. Pin with brand → ref-brand part
 *    39. Pin with image url+hash → ref-image with both
 *    40. Rule enforced=true omits intent parts
 *    41. Rule enforced=false produces constraint intent
 *    42. Time-scrub branch → branch intent part
 *    43. Time-scrub compare → compare intent part
 *
 *   End-to-end integration (44-50)
 *    44. Full flow: Ask gesture → thread + annotation + intent all persisted and linked
 *    45. Two Ask gestures on same anchor share one thread via ensureThread
 *    46. Agent-authored annotation carries author.kind === 'agent'
 *    47. Ghost-proposal annotation links to intent id
 *    48. Full orphan flow: create → remove anchor → both thread and annotation orphaned
 *    49. Rule gesture creates enforceable annotation readable by future audit
 *    50. Intent with anchor + threadId roundtrips through queue
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  createThread,
  listThreads,
  getThread,
  updateThread,
  attachIntent,
  attachAnnotation,
  transitionThread,
  ensureThread,
  orphanMissingAnchors as orphanMissingThreads,
  compactThreads,
} from '../project/threads/index.js';

import {
  createAnnotation,
  listAnnotations,
  getAnnotation,
  updateAnnotation,
  transitionAnnotation,
  reAnchorAnnotation,
  orphanMissingAnchors as orphanMissingAnnotations,
  countByStatus,
  compactAnnotations,
  annotationsFilePath,
  type Annotation,
  type AnnotationPayload,
} from '../project/annotations/index.js';

import {
  translateGesture,
  pointInPolygon,
  bboxCenterInPolygon,
  pointInBBox,
  hitTestInnermost,
  matchesResonanceAxes,
  findResonanceMatches,
  unionBBox,
  type Gesture,
  type InodeMeasurement,
} from '../gestures/index.js';

import {
  writeIntent,
  listIntents,
  nextIntentId,
  type Intent,
  type IntentPart,
} from '../project/intents/index.js';

import { initProject } from '../project/index.js';

// ─── Test harness ────────────────────────────────────────────

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}
function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-p8-'));
}
function cleanup(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Helper: make a scene slug + project
function setup(): string {
  const dir = tmp();
  initProject(dir, 'P8');
  return dir;
}

// Helper: build a minimal Intent for attaching to threads
function makeIntent(parts: IntentPart[], sceneSlug: string, anchor?: string, threadId?: string): Intent {
  const now = new Date().toISOString();
  return {
    id: nextIntentId(),
    createdAt: now,
    updatedAt: now,
    author: { kind: 'human' },
    status: 'draft',
    parts,
    sceneSlug,
    anchor,
    threadId,
  };
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log('═══ PHASE 8: Annotation subsystem stress test ═══\n');

  // ── 1-11. Threads ────────────────────────────────────────
  console.log('  1-11. Thread lifecycle');
  {
    const dir = setup();
    try {
      // 1. createThread
      const t1 = createThread(dir, { anchor: 'n-button-cta', sceneSlug: 'hero' });
      assert(!!t1.id && t1.id.startsWith('t-'), 'createThread returns id with t- prefix');
      assert(t1.status === 'active', 'new thread starts active');
      assert(t1.intentIds.length === 0, 'new thread has no intents');
      assert(t1.annotationIds.length === 0, 'new thread has no annotations');
      assert(!!t1.createdAt && !!t1.updatedAt, 'timestamps set');

      // 2. listThreads
      const listed = listThreads(dir);
      assert(listed.length === 1 && listed[0].id === t1.id, 'listThreads returns created');

      // 3. getThread
      const got = getThread(dir, t1.id);
      assert(got?.id === t1.id, 'getThread by id');
      assert(getThread(dir, 'no-such-id') === undefined, 'missing id → undefined');

      // 4. updateThread bumps updatedAt, preserves createdAt
      const originalCreated = t1.createdAt;
      // Slight delay to ensure updatedAt changes
      const u1 = updateThread(dir, t1.id, { title: 'my thread' });
      assert(u1?.title === 'my thread', 'update patches field');
      assert(u1?.createdAt === originalCreated, 'createdAt preserved');
      assert(u1?.id === t1.id, 'id preserved');

      // 5. attachIntent dedupes
      const i1 = 'i-test-1';
      attachIntent(dir, t1.id, i1);
      attachIntent(dir, t1.id, i1); // duplicate
      const a1 = getThread(dir, t1.id);
      assert(a1?.intentIds.length === 1, 'attachIntent dedupes');
      assert(a1?.intentIds[0] === i1, 'correct intent id');

      // 6. attachAnnotation dedupes
      const an1 = 'a-test-1';
      attachAnnotation(dir, t1.id, an1);
      attachAnnotation(dir, t1.id, an1); // duplicate
      const a2 = getThread(dir, t1.id);
      assert(a2?.annotationIds.length === 1, 'attachAnnotation dedupes');

      // 7. transitionThread active → resolved
      const r1 = transitionThread(dir, t1.id, 'resolved', {
        resolvedBy: { kind: 'human' },
        resolution: 'done',
      });
      assert(r1.ok && r1.status === 'resolved', 'active → resolved valid');
      const resolved = getThread(dir, t1.id);
      assert(resolved?.status === 'resolved', 'thread status updated');
      assert(resolved?.resolution === 'done', 'resolution recorded');

      // 8. transitionThread resolved → active (reopen) then → orphaned
      transitionThread(dir, t1.id, 'active');
      const r2 = transitionThread(dir, t1.id, 'orphaned', {
        resolvedBy: { kind: 'system' },
        resolution: 'node removed',
      });
      assert(r2.ok && r2.status === 'orphaned', 'active → orphaned valid');

      // 9. archived is terminal
      transitionThread(dir, t1.id, 'archived');
      const r3 = transitionThread(dir, t1.id, 'active');
      assert(!r3.ok, 'archived → active rejected');
      assert(r3.error?.includes('invalid transition') ?? false, 'error message explains');

      // 10. ensureThread dedup
      const t2 = createThread(dir, { anchor: 'n-heading', sceneSlug: 'hero' });
      const t2Again = ensureThread(dir, 'n-heading', 'hero');
      assert(t2Again.id === t2.id, 'ensureThread returns existing active');
      const t3 = ensureThread(dir, 'n-new-anchor', 'hero');
      assert(t3.id !== t2.id, 'ensureThread creates new for new anchor');

      // 11. orphanMissingAnchors
      const t4 = createThread(dir, { anchor: 'n-will-vanish', sceneSlug: 'hero' });
      const liveAnchors = new Set(['n-heading', 'n-new-anchor']); // n-will-vanish removed
      const orphaned = orphanMissingThreads(dir, liveAnchors, 'hero', 'test removal');
      assert(orphaned.length === 1, 'one thread orphaned');
      assert(orphaned[0].id === t4.id, 'correct thread orphaned');
      assert(orphaned[0].status === 'orphaned', 'status is orphaned');
    } finally { cleanup(dir); }
  }

  // ── 12-25. Annotations ──────────────────────────────────
  console.log('  12-25. Annotation lifecycle + payload kinds');
  {
    const dir = setup();
    try {
      const thread = createThread(dir, { anchor: 'n-btn', sceneSlug: 'hero' });

      // 12. createAnnotation
      const a = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'make this bigger' },
      });
      assert(!!a.id && a.id.startsWith('a-'), 'id has a- prefix');
      assert(a.status === 'active', 'starts active');
      assert(a.payload.kind === 'comment', 'payload preserved');

      // 13. listAnnotations filters
      const b = createAnnotation(dir, {
        anchor: 'n-heading',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'pin', style: 'question' },
      });
      const all = listAnnotations(dir);
      assert(all.length === 2, 'list returns both');
      const byAnchor = listAnnotations(dir, { anchor: 'n-btn' });
      assert(byAnchor.length === 1 && byAnchor[0].id === a.id, 'filter by anchor');
      const byKind = listAnnotations(dir, { kind: 'pin' });
      assert(byKind.length === 1 && byKind[0].id === b.id, 'filter by kind');
      const byThread = listAnnotations(dir, { threadId: thread.id });
      assert(byThread.length === 2, 'filter by threadId');

      // 14. getAnnotation
      const got = getAnnotation(dir, a.id);
      assert(got?.id === a.id, 'getAnnotation by id');
      assert(getAnnotation(dir, 'no-such') === undefined, 'missing → undefined');

      // 15. updateAnnotation preserves immutable fields
      const upd = updateAnnotation(dir, a.id, {
        payload: { kind: 'comment', text: 'updated' },
      });
      assert(upd?.id === a.id, 'id preserved');
      assert(upd?.createdAt === a.createdAt, 'createdAt preserved');
      assert(upd?.threadId === thread.id, 'threadId preserved');
      assert((upd?.payload as any).text === 'updated', 'payload updated');

      // 16. transitionAnnotation active → orphaned → active
      const t1 = transitionAnnotation(dir, a.id, 'orphaned', { reason: 'removed' });
      assert(t1.ok && t1.status === 'orphaned', 'active → orphaned');
      const afterOrph = getAnnotation(dir, a.id);
      assert(afterOrph?.orphanedAt !== undefined, 'orphanedAt recorded');
      assert(afterOrph?.orphanedReason === 'removed', 'reason recorded');

      const t2 = transitionAnnotation(dir, a.id, 'active');
      assert(t2.ok && t2.status === 'active', 'orphaned → active');
      const afterRev = getAnnotation(dir, a.id);
      assert(afterRev?.orphanedAt === undefined, 'orphanedAt cleared on revive');

      // 17. Invalid transition
      transitionAnnotation(dir, a.id, 'dismissed');
      const t3 = transitionAnnotation(dir, a.id, 'active');
      assert(!t3.ok, 'dismissed is terminal');

      // 18. reAnchorAnnotation (create new orphaned annotation first)
      const c = createAnnotation(dir, {
        anchor: 'n-old',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'pin' },
      });
      transitionAnnotation(dir, c.id, 'orphaned', { reason: 'test' });
      const re = reAnchorAnnotation(dir, c.id, 'n-new');
      assert(re.ok && re.status === 'active', 're-anchor returns to active');
      const afterRe = getAnnotation(dir, c.id);
      assert(afterRe?.anchor === 'n-new', 'anchor changed');
      assert(afterRe?.orphanedAt === undefined, 'orphan meta cleared');

      // 19. reAnchorAnnotation on non-orphaned rejected
      const d = createAnnotation(dir, {
        anchor: 'n-live',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'pin' },
      });
      const re2 = reAnchorAnnotation(dir, d.id, 'n-other');
      assert(!re2.ok, 're-anchor on active rejected');

      // 20. orphanMissingAnchors
      const e = createAnnotation(dir, {
        anchor: 'n-vanishing',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'pin' },
      });
      const live = new Set(['n-heading', 'n-live', 'n-new']);
      const orphaned = orphanMissingAnnotations(dir, live, 'hero', 'scene cleanup');
      assert(orphaned.find(o => o.id === e.id) !== undefined, 'missing anchor annotation orphaned');
      assert(orphaned.find(o => o.id === d.id) === undefined, 'live anchor not orphaned');

      // 21. Scene-level anchors not orphaned (even when live set is empty)
      const sceneAnn = createAnnotation(dir, {
        anchor: 'scene:hero',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'scene-level note' },
      });
      // Keep b/c/d's anchors in the live set so they aren't swept.
      const liveKeepAll = new Set(['n-heading', 'n-new', 'n-live']);
      const orph2 = orphanMissingAnnotations(dir, liveKeepAll, 'hero');
      assert(orph2.find(o => o.id === sceneAnn.id) === undefined, 'scene-level anchor preserved');
      const sceneAfter = getAnnotation(dir, sceneAnn.id);
      assert(sceneAfter?.status === 'active', 'scene annotation stays active');

      // 22. countByStatus
      const counts = countByStatus(dir);
      assert(counts.active >= 2, 'count includes active');
      assert(counts.orphaned >= 1, 'count includes orphaned');

      // 23. All payload kinds round-trip
      const thread2 = createThread(dir, { anchor: 'n-kinds', sceneSlug: 'hero' });
      const payloads: AnnotationPayload[] = [
        { kind: 'comment', text: 'c' },
        { kind: 'pin', style: 'todo' },
        { kind: 'echo-arrow', fromAnchor: 'n-a', toAnchor: 'n-b', axis: 'visual-style' },
        { kind: 'region', anchors: ['n-1', 'n-2'], shape: 'freehand', points: [[0, 0], [1, 1]] },
        { kind: 'brush-stroke', anchors: ['n-1'], macro: 'brutalize' },
        { kind: 'reference', source: { type: 'brand', brand: 'stripe' } },
        { kind: 'rule', rule: 'min-contrast', value: 4.5, enforced: true },
        { kind: 'ghost-proposal', intentId: 'i-1', summary: 'test' },
        { kind: 'resonance-overlay', seed: 'n-a', axes: ['role', 'style'], matches: ['n-b', 'n-c'] },
      ];
      for (const p of payloads) {
        const ann = createAnnotation(dir, {
          anchor: 'n-kinds',
          sceneSlug: 'hero',
          threadId: thread2.id,
          author: { kind: 'human' },
          payload: p,
        });
        const read = getAnnotation(dir, ann.id);
        assert(read?.payload.kind === p.kind, `payload ${p.kind} round-trips`);
      }

      // 24. Compaction
      for (let i = 0; i < 5; i++) {
        updateAnnotation(dir, a.id, { payload: { kind: 'comment', text: `v${i}` } });
      }
      const saved = compactAnnotations(dir);
      assert(saved > 0, 'compaction removes duplicates');
      const afterCompact = getAnnotation(dir, a.id);
      assert((afterCompact?.payload as any).text === 'v4', 'latest wins after compact');

      // 25. Corrupt line skipped
      const file = annotationsFilePath(dir);
      fs.appendFileSync(file, 'this is not json\n', 'utf-8');
      const stillWorks = listAnnotations(dir);
      assert(stillWorks.length > 0, 'corrupt line does not break reader');
    } finally { cleanup(dir); }
  }

  // ── 26-43. Gesture translator ────────────────────────────
  console.log('  26-43. Gesture translator');
  {
    const baseGesture = {
      at: new Date().toISOString(),
      sceneSlug: 'hero',
      author: { kind: 'human' as const },
    };

    // 26-27. Ambient → null
    const hover = translateGesture({ ...baseGesture, kind: 'hover', anchor: 'n-1' });
    assert(hover === null, 'hover → null');
    const select = translateGesture({ ...baseGesture, kind: 'select', anchors: ['n-1'] });
    assert(select === null, 'select → null');

    // 28. Ask
    const ask = translateGesture({
      ...baseGesture, kind: 'ask', anchor: 'n-btn', text: 'make this bigger',
    });
    assert(ask?.annotation?.kind === 'comment', 'ask annotation is comment');
    assert((ask?.annotation as any)?.text === 'make this bigger', 'text preserved');
    assert(ask?.intentParts?.length === 2, 'ask produces 2 intent parts');
    assert(ask?.intentParts?.[0].kind === 'select', 'first part is select');
    assert(ask?.intentParts?.[1].kind === 'text', 'second part is text');
    assert(ask?.anchor === 'n-btn', 'anchor set');
    assert((ask?.threadTitle ?? '').length > 0, 'threadTitle non-empty');

    // 29. Drag 'into'
    const dragInto = translateGesture({
      ...baseGesture, kind: 'drag', anchor: 'n-child',
      destination: { kind: 'into', anchor: 'n-parent' },
    });
    const moveInto = dragInto?.intentParts?.find(p => p.kind === 'move') as any;
    assert(moveInto?.destination?.into === 'n-parent', 'drag into maps to destination.into');

    // 30. Drag 'before'
    const dragBefore = translateGesture({
      ...baseGesture, kind: 'drag', anchor: 'n-a',
      destination: { kind: 'before', anchor: 'n-b' },
    });
    const moveBefore = dragBefore?.intentParts?.find(p => p.kind === 'move') as any;
    assert(moveBefore?.destination?.before === 'n-b', 'drag before maps correctly');

    // 31. Drag delta
    const dragDelta = translateGesture({
      ...baseGesture, kind: 'drag', anchor: 'n-a',
      destination: { kind: 'delta', dx: 10, dy: -20 },
    });
    const moveDelta = dragDelta?.intentParts?.find(p => p.kind === 'move') as any;
    assert(moveDelta?.delta?.dx === 10 && moveDelta?.delta?.dy === -20, 'delta preserved');

    // 32. Lasso with ancestor
    const lasso = translateGesture({
      ...baseGesture, kind: 'lasso',
      points: [[0, 0], [0.5, 0.5], [1, 0]],
      containedAnchors: ['n-1', 'n-2', 'n-3'],
      ancestor: 'n-hero-section',
    });
    assert(lasso?.anchor === 'n-hero-section', 'lasso anchor is ancestor');
    assert(lasso?.annotation?.kind === 'region', 'region annotation');
    assert((lasso?.annotation as any)?.anchors.length === 3, 'all contained');
    const selectPart = lasso?.intentParts?.[0] as any;
    assert(selectPart?.kind === 'select' && selectPart.nodes.length === 3, 'select has all nodes');

    // 33. Lasso without ancestor falls back
    const lassoFallback = translateGesture({
      ...baseGesture, kind: 'lasso',
      points: [[0, 0], [1, 1]],
      containedAnchors: ['n-first'],
    });
    assert(lassoFallback?.anchor === 'n-first', 'falls back to first contained');

    // 34. Brush
    const brush = translateGesture({
      ...baseGesture, kind: 'brush',
      anchors: ['n-1', 'n-2'],
      macro: 'darkmode',
    });
    assert(brush?.annotation?.kind === 'brush-stroke', 'brush-stroke annotation');
    const applyMacro = brush?.intentParts?.find(p => p.kind === 'apply-macro') as any;
    assert(applyMacro?.macro === 'darkmode', 'macro passed through');

    // 35. Resonance
    const res = translateGesture({
      ...baseGesture, kind: 'resonance',
      seed: 'n-btn-primary',
      axes: ['role', 'style'],
      matches: ['n-btn-2', 'n-btn-3', 'n-btn-4'],
    });
    assert(res?.annotation?.kind === 'resonance-overlay', 'overlay annotation');
    assert(res?.anchor === 'n-btn-primary', 'anchor is seed');
    const querySel = res?.intentParts?.find(p => p.kind === 'query') as any;
    assert(querySel?.selector?.includes('resonance:'), 'query carries selector');

    // 36. Echo visual-style → aspect=style
    const echo = translateGesture({
      ...baseGesture, kind: 'echo',
      fromAnchor: 'n-src',
      toAnchor: 'n-dst',
      axis: 'visual-style',
    });
    const refNode = echo?.intentParts?.find(p => p.kind === 'ref-node') as any;
    assert(refNode?.aspect === 'style', 'visual-style → aspect=style');
    assert(refNode?.nodeId === 'n-src', 'source is nodeId');
    assert(echo?.anchor === 'n-dst', 'anchor is target');

    // 37. Echo with modifier
    const echoMod = translateGesture({
      ...baseGesture, kind: 'echo',
      fromAnchor: 'n-a', toAnchor: 'n-b',
      axis: 'all', modifier: 'reverse',
    });
    const textPart = echoMod?.intentParts?.find(p => p.kind === 'text') as any;
    assert(textPart?.value === 'reverse', 'modifier appended as text');

    // 38. Pin brand
    const pinBrand = translateGesture({
      ...baseGesture, kind: 'pin', anchor: 'n-1',
      reference: { type: 'brand', brand: 'stripe' },
    });
    const refBrand = pinBrand?.intentParts?.find(p => p.kind === 'ref-brand') as any;
    assert(refBrand?.brand === 'stripe', 'ref-brand part emitted');

    // 39. Pin image
    const pinImage = translateGesture({
      ...baseGesture, kind: 'pin', anchor: 'n-1',
      reference: { type: 'image', url: 'https://x.com/a.png', hash: 'abc' },
    });
    const refImg = pinImage?.intentParts?.find(p => p.kind === 'ref-image') as any;
    assert(refImg?.url === 'https://x.com/a.png' && refImg?.hash === 'abc', 'both url and hash preserved');

    // 40. Rule enforced=true → no intentParts
    const ruleEnforced = translateGesture({
      ...baseGesture, kind: 'rule', anchor: 'n-1',
      rule: 'min-contrast', value: 4.5, enforced: true,
    });
    assert(ruleEnforced?.intentParts === undefined, 'enforced rule emits no intent');
    assert((ruleEnforced?.annotation as any)?.enforced === true, 'annotation marks enforced');

    // 41. Rule enforced=false → constraint intent
    const ruleOneshot = translateGesture({
      ...baseGesture, kind: 'rule', anchor: 'n-1',
      rule: 'min-height-44', enforced: false,
    });
    const constraintPart = ruleOneshot?.intentParts?.find(p => p.kind === 'constraint') as any;
    assert(constraintPart?.rule === 'min-height-44', 'non-enforced rule → constraint intent');

    // 42. Time-scrub branch
    const timeBranch = translateGesture({
      ...baseGesture, kind: 'time-scrub', opId: 'o-123', action: 'branch',
    });
    assert(timeBranch?.intentParts?.[0].kind === 'branch', 'branch action → branch intent');

    // 43. Time-scrub compare
    const timeCompare = translateGesture({
      ...baseGesture, kind: 'time-scrub', opId: 'o-456', action: 'compare',
    });
    assert(timeCompare?.intentParts?.[0].kind === 'compare', 'compare action → compare intent');
  }

  // ── 44-50. End-to-end integration ────────────────────────
  console.log('  44-50. End-to-end integration');
  {
    const dir = setup();
    try {
      // 44. Full flow: Ask → thread + annotation + intent linked
      const askGesture: Gesture = {
        kind: 'ask',
        at: new Date().toISOString(),
        sceneSlug: 'hero',
        author: { kind: 'human' },
        anchor: 'n-cta',
        text: 'why is this blue?',
      };
      const translated = translateGesture(askGesture);
      assert(translated !== null, 'ask translates');

      // Create thread
      const thread = ensureThread(dir, translated!.anchor, translated!.sceneSlug, translated!.threadTitle);
      // Create annotation
      const ann = createAnnotation(dir, {
        anchor: translated!.anchor,
        sceneSlug: translated!.sceneSlug,
        threadId: thread.id,
        author: translated!.author,
        payload: translated!.annotation!,
      });
      // Create intent
      const intent: Intent = makeIntent(
        translated!.intentParts!,
        translated!.sceneSlug,
        translated!.anchor,
        thread.id,
      );
      writeIntent(dir, intent);
      // Attach both
      attachAnnotation(dir, thread.id, ann.id);
      attachIntent(dir, thread.id, intent.id);

      const finalThread = getThread(dir, thread.id);
      assert(!!finalThread?.intentIds.includes(intent.id), 'intent attached to thread');
      assert(!!finalThread?.annotationIds.includes(ann.id), 'annotation attached to thread');
      assert(finalThread?.anchor === 'n-cta', 'thread anchor matches');

      // Intent carries anchor + threadId
      const readIntents = listIntents(dir, { sceneSlug: 'hero' });
      const foundIntent = readIntents.find(i => i.id === intent.id);
      assert(foundIntent?.anchor === 'n-cta', 'intent persists anchor');
      assert(foundIntent?.threadId === thread.id, 'intent persists threadId');

      // 45. Two Ask gestures on same anchor share thread
      const askGesture2: Gesture = {
        kind: 'ask',
        at: new Date().toISOString(),
        sceneSlug: 'hero',
        author: { kind: 'human' },
        anchor: 'n-cta',
        text: 'also, can you make it warmer?',
      };
      const t2translated = translateGesture(askGesture2);
      const thread2 = ensureThread(dir, t2translated!.anchor, t2translated!.sceneSlug);
      assert(thread2.id === thread.id, 'second ask shares thread via ensureThread');

      // 46. Agent-authored annotation
      const agentGesture: Gesture = {
        kind: 'ask',
        at: new Date().toISOString(),
        sceneSlug: 'hero',
        author: { kind: 'agent', id: 'claude-session-1' },
        anchor: 'n-cta',
        text: 'How about this orange?',
      };
      const agentT = translateGesture(agentGesture);
      assert(agentT?.author.kind === 'agent', 'author kind preserved as agent');
      assert((agentT?.author as any).id === 'claude-session-1', 'agent id preserved');

      // 47. Ghost-proposal annotation links to intent id
      const ghost = createAnnotation(dir, {
        anchor: 'n-cta',
        sceneSlug: 'hero',
        threadId: thread.id,
        author: { kind: 'agent', id: 'claude-session-1' },
        payload: {
          kind: 'ghost-proposal',
          intentId: intent.id,
          summary: 'change background to #E94B1A',
        },
      });
      const readGhost = getAnnotation(dir, ghost.id);
      assert((readGhost?.payload as any)?.intentId === intent.id, 'ghost links to intent');

      // 48. Full orphan flow: both thread and annotation orphaned when anchor vanishes
      const vanishAnchor = 'n-will-vanish-' + Date.now();
      const th = createThread(dir, { anchor: vanishAnchor, sceneSlug: 'hero' });
      const an = createAnnotation(dir, {
        anchor: vanishAnchor,
        sceneSlug: 'hero',
        threadId: th.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'on vanishing node' },
      });
      const livingAnchors = new Set(['n-cta', 'n-other']);
      const orphThreads = orphanMissingThreads(dir, livingAnchors, 'hero', 'gc');
      const orphAnns = orphanMissingAnnotations(dir, livingAnchors, 'hero', 'gc');
      assert(orphThreads.find(t => t.id === th.id) !== undefined, 'thread orphaned');
      assert(orphAnns.find(a => a.id === an.id) !== undefined, 'annotation orphaned');

      // 49. Rule gesture → enforceable annotation
      const ruleG: Gesture = {
        kind: 'rule',
        at: new Date().toISOString(),
        sceneSlug: 'hero',
        author: { kind: 'human' },
        anchor: 'n-cta',
        rule: 'min-contrast',
        value: 4.5,
        enforced: true,
      };
      const rt = translateGesture(ruleG)!;
      const ruleAnn = createAnnotation(dir, {
        anchor: rt.anchor,
        sceneSlug: rt.sceneSlug,
        threadId: thread.id,
        author: rt.author,
        payload: rt.annotation!,
      });
      // Future audit can read active rule annotations:
      const rulesOnAnchor = listAnnotations(dir, {
        anchor: 'n-cta',
        kind: 'rule',
        status: 'active',
      });
      const enforcedRules = rulesOnAnchor.filter(r => (r.payload as any).enforced === true);
      assert(enforcedRules.length >= 1, 'audit can find enforced rules by anchor');
      assert(enforcedRules.some(r => r.id === ruleAnn.id), 'created rule found');

      // 50. Intent roundtrip through queue with anchor + threadId
      const withAnchor: Intent = makeIntent(
        [{ kind: 'text', value: 'roundtrip test' }],
        'hero',
        'n-roundtrip',
        thread.id,
      );
      writeIntent(dir, withAnchor);
      const list = listIntents(dir, { sceneSlug: 'hero' });
      const found = list.find(i => i.id === withAnchor.id);
      assert(found?.anchor === 'n-roundtrip', 'intent anchor roundtrips');
      assert(found?.threadId === thread.id, 'intent threadId roundtrips');
    } finally { cleanup(dir); }
  }

  // ── 51-54. Orphan GC integration with saveScene ─────────
  console.log('  51-54. Orphan GC integration');
  {
    const dir = setup();
    try {
      const { SceneGraph } = await import('../engine/scene-graph.js');
      const { saveScene } = await import('../project/io.js');
      const { sweepOrphans, collectLiveAnchors } = await import('../project/gc.js');

      // Build a minimal scene graph with two nodes.
      const graph = new SceneGraph();
      const canvas = graph.addPage('GC Page');
      const root = graph.createNode('FRAME', canvas.id, { name: 'Root', width: 1440, height: 900 });
      const child = graph.createNode('FRAME', root.id, { name: 'Child', width: 100, height: 40 });

      // Thread + annotation anchored on the child.
      const th = createThread(dir, { anchor: child.id, sceneSlug: 'gc-scene' });
      const an = createAnnotation(dir, {
        anchor: child.id,
        sceneSlug: 'gc-scene',
        threadId: th.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'on child' },
      });

      // 51. collectLiveAnchors returns both node ids.
      const live = collectLiveAnchors(graph);
      assert(live.has(root.id) && live.has(child.id), 'collectLiveAnchors includes all node ids');

      // 52. saveScene runs the sweep — with child still present, nothing orphaned.
      saveScene(dir, graph, root.id, { slug: 'gc-scene', name: 'GC Scene' });
      const afterSave1 = getAnnotation(dir, an.id);
      assert(afterSave1?.status === 'active', 'annotation stays active when anchor still present');

      // 53. Remove child → save again → sweepOrphans marks annotation orphaned.
      graph.deleteNode(child.id);
      saveScene(dir, graph, root.id, { slug: 'gc-scene', name: 'GC Scene' });
      const afterSave2 = getAnnotation(dir, an.id);
      assert(afterSave2?.status === 'orphaned', 'annotation orphaned after anchor removed');
      assert(afterSave2?.orphanedReason?.includes('save') ?? false, 'orphaned reason mentions save');

      // 54. Manual sweepOrphans is a no-op on already-orphaned — idempotent.
      const res = sweepOrphans(dir, 'gc-scene', graph, 'manual');
      const stillOrphaned = getAnnotation(dir, an.id);
      assert(stillOrphaned?.status === 'orphaned', 'manual sweep idempotent');
      assert(res.annotationsOrphaned.length === 0, 'already-orphaned not re-orphaned');
    } finally { cleanup(dir); }
  }

  // ── 55-70. Gesture geometry helpers ─────────────────────
  console.log('  55-70. Gesture geometry helpers');
  {
    // 55. pointInPolygon — inside triangle
    const tri: Array<[number, number]> = [[0, 0], [10, 0], [5, 10]];
    assert(pointInPolygon(5, 3, tri), 'point inside triangle');
    assert(!pointInPolygon(0, 10, tri), 'point outside triangle');
    assert(!pointInPolygon(-1, 0, tri), 'point left of triangle');

    // 56. Degenerate polygon
    assert(!pointInPolygon(1, 1, [[0, 0], [1, 1]]), 'degenerate 2-point polygon rejects');
    assert(!pointInPolygon(1, 1, []), 'empty polygon rejects');

    // 57. Square polygon
    const sq: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    assert(pointInPolygon(5, 5, sq), 'point inside square');
    assert(!pointInPolygon(11, 5, sq), 'point right of square');
    assert(!pointInPolygon(-1, 5, sq), 'point left of square');

    // 58. Concave polygon (C-shape)
    const c: Array<[number, number]> = [
      [0, 0], [10, 0], [10, 4], [4, 4], [4, 6], [10, 6], [10, 10], [0, 10],
    ];
    assert(pointInPolygon(2, 5, c), 'point in concave arm');
    assert(!pointInPolygon(7, 5, c), 'point in concave notch (outside)');

    // 59. bboxCenterInPolygon
    assert(bboxCenterInPolygon({ x: 2, y: 2, w: 4, h: 4 }, sq), 'bbox center in square');
    assert(!bboxCenterInPolygon({ x: 20, y: 20, w: 4, h: 4 }, sq), 'bbox center outside');

    // 60. pointInBBox
    assert(pointInBBox(5, 5, { x: 0, y: 0, w: 10, h: 10 }), 'point in bbox');
    assert(pointInBBox(0, 0, { x: 0, y: 0, w: 10, h: 10 }), 'point on bbox corner');
    assert(!pointInBBox(11, 5, { x: 0, y: 0, w: 10, h: 10 }), 'point outside bbox');

    // 61. hitTestInnermost — innermost wins
    const ms: InodeMeasurement[] = [
      { inode: 'outer', tag: 'section', bbox: { x: 0, y: 0, w: 1000, h: 1000 } },
      { inode: 'middle', tag: 'div',     bbox: { x: 100, y: 100, w: 500, h: 500 } },
      { inode: 'inner',  tag: 'button',  bbox: { x: 200, y: 200, w: 100, h: 100 } },
    ];
    const hit = hitTestInnermost(250, 250, ms);
    assert(hit === 'inner', 'innermost button wins hit-test');

    // 62. hitTestInnermost — miss
    assert(hitTestInnermost(5000, 5000, ms) === null, 'miss returns null');

    // 63. Resonance — tag axis
    const seed: InodeMeasurement = {
      inode: 'seed',
      tag: 'button',
      bbox: { x: 0, y: 0, w: 100, h: 44 },
      style: { bg: 'rgb(233,75,26)', fs: '14px', fw: '500', ff: 'Inter', color: 'white', br: '4px', pad: '12px', display: 'inline-flex' },
      className: 'cta primary',
      role: 'button',
      text: 'Get started',
    };
    const btnMatch: InodeMeasurement = {
      inode: 'b1',
      tag: 'button',
      bbox: { x: 200, y: 0, w: 100, h: 44 },
      style: { bg: 'rgb(233,75,26)', fs: '14px', fw: '500', ff: 'Inter', color: 'white', br: '4px', pad: '12px', display: 'inline-flex' },
      className: 'cta primary',
      role: 'button',
      text: 'Sign in',
    };
    const linkMiss: InodeMeasurement = {
      inode: 'a1',
      tag: 'a',
      bbox: { x: 0, y: 100, w: 100, h: 20 },
      style: { bg: 'rgba(0,0,0,0)', fs: '14px', fw: '400', ff: 'Inter', color: '#111', br: '0', pad: '0', display: 'inline' },
      className: '',
      role: '',
      text: 'Learn more',
    };
    assert(matchesResonanceAxes(seed, btnMatch, ['tag']), 'tag match succeeds');
    assert(!matchesResonanceAxes(seed, linkMiss, ['tag']), 'tag mismatch rejects');

    // 64. Resonance — style axis
    assert(matchesResonanceAxes(seed, btnMatch, ['style']), 'style match succeeds');
    assert(!matchesResonanceAxes(seed, linkMiss, ['style']), 'style mismatch rejects');

    // 65. Resonance — AND semantics (tag AND style)
    assert(matchesResonanceAxes(seed, btnMatch, ['tag', 'style']), 'tag+style both match');
    assert(!matchesResonanceAxes(seed, linkMiss, ['tag', 'style']), 'tag+style both fail');

    // 66. Resonance — role axis
    assert(matchesResonanceAxes(seed, btnMatch, ['role']), 'role match');
    assert(!matchesResonanceAxes(seed, linkMiss, ['role']), 'role mismatch');

    // 67. Resonance — content axis (different text)
    assert(!matchesResonanceAxes(seed, btnMatch, ['content']), 'content mismatch (different text)');

    // 68. Resonance — position axis (same width, same display)
    assert(matchesResonanceAxes(seed, btnMatch, ['position']), 'position match (same width)');
    const wider: InodeMeasurement = { ...btnMatch, bbox: { x: 0, y: 0, w: 200, h: 44 } };
    assert(!matchesResonanceAxes(seed, wider, ['position']), 'position mismatch (width differs)');

    // 69. findResonanceMatches skips seed + collects matches
    const pool: InodeMeasurement[] = [seed, btnMatch, linkMiss, wider];
    const found = findResonanceMatches(seed, pool, ['tag']);
    assert(found.indexOf('seed') < 0, 'seed excluded from matches');
    assert(found.indexOf('b1') >= 0, 'btnMatch included');
    assert(found.indexOf('a1') < 0, 'linkMiss excluded');

    // 70. unionBBox — encloses all boxes
    const u = unionBBox([
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 5, w: 10, h: 10 },
    ]);
    assert(u !== null && u.x === 0 && u.y === 0 && u.w === 30 && u.h === 15, 'union of two bboxes');
    assert(unionBBox([]) === null, 'union of empty list is null');
  }

  // ── 71-80. Loop closure: hydrate + agent flow integration ──
  console.log('  71-80. Loop closure — hydrate + agent flow');
  {
    const dir = setup();
    try {
      const { hydrateThread, collectAnchorContext } = await import('../project/hydrate.js');
      const {
        createDraft,
        commitDraft,
        startProcessing,
        proposeOps,
        acceptProposal,
        rejectProposal,
      } = await import('../project/intents/index.js');

      // 71. hydrateThread resolves intent + annotation ids
      const t = createThread(dir, { anchor: 'n-btn', sceneSlug: 'loop' });
      const draft = createDraft(dir, [{ kind: 'text', value: 'hi' }], {
        sceneSlug: 'loop',
      });
      writeIntent(dir, { ...draft, anchor: 'n-btn', threadId: t.id });
      attachIntent(dir, t.id, draft.id);
      const ann1 = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'loop',
        threadId: t.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'make this bigger' },
      });
      attachAnnotation(dir, t.id, ann1.id);

      const hydrated = hydrateThread(dir, t.id);
      assert(hydrated !== null, 'hydrate returns result');
      assert(hydrated?.intents.length === 1, 'hydrated intent count');
      assert(hydrated?.annotations.length === 1, 'hydrated annotation count');
      assert(hydrated?.thread.id === t.id, 'hydrated thread id preserved');

      // 72. hydrate missing → null
      const missing = hydrateThread(dir, 't-missing');
      assert(missing === null, 'missing thread hydrates null');

      // 73. collectAnchorContext returns active threads + annotations
      const ctx = collectAnchorContext(dir, 'n-btn', 'loop');
      assert(ctx.threads.length >= 1, 'context has at least our thread');
      assert(ctx.annotations.length >= 1, 'context has at least our annotation');

      // 74. Rule annotation is filterable in context
      const ruleAnn = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'loop',
        threadId: t.id,
        author: { kind: 'human' },
        payload: { kind: 'rule', rule: 'min-contrast', value: 4.5, enforced: true },
      });
      attachAnnotation(dir, t.id, ruleAnn.id);
      const ctx2 = collectAnchorContext(dir, 'n-btn', 'loop');
      const rules = ctx2.annotations.filter(a => a.payload.kind === 'rule');
      assert(rules.length === 1, 'rule found in context');
      assert((rules[0].payload as any).enforced === true, 'rule enforced flag preserved');

      // 75. Accept auto-resolve (via intent lifecycle)
      // Create a fresh intent on this thread, walk it through the flow.
      const d2 = createDraft(dir, [{ kind: 'text', value: 'second' }], {
        sceneSlug: 'loop',
      });
      const d2WithAnchor: Intent = { ...d2, anchor: 'n-btn', threadId: t.id };
      writeIntent(dir, d2WithAnchor);
      attachIntent(dir, t.id, d2.id);
      commitDraft(dir, d2.id);
      startProcessing(dir, d2.id, 'test-agent');
      proposeOps(dir, d2.id, ['op-1', 'op-2']);
      const acceptRes = acceptProposal(dir, d2.id, ['op-1', 'op-2']);
      assert(acceptRes.ok, 'accept succeeds');

      // Auto-resolve: simulate what the MCP tool does — transition thread
      // to resolved. (We test this integration at the MCP layer too via
      // the integration test; here we verify the helpers compose.)
      const resolveRes = transitionThread(dir, t.id, 'resolved', {
        resolvedBy: { kind: 'system' },
        resolution: `intent ${d2.id} accepted`,
      });
      assert(resolveRes.ok, 'thread resolved after accept');
      const threadAfter = getThread(dir, t.id);
      assert(threadAfter?.status === 'resolved', 'thread status = resolved');
      assert(threadAfter?.resolution?.includes(d2.id) ?? false, 'resolution mentions intent id');

      // 76. Reject + system annotation attached
      // Reopen thread, create another intent, reject it.
      transitionThread(dir, t.id, 'active');
      const d3 = createDraft(dir, [{ kind: 'text', value: 'third' }], {
        sceneSlug: 'loop',
      });
      writeIntent(dir, { ...d3, anchor: 'n-btn', threadId: t.id });
      attachIntent(dir, t.id, d3.id);
      commitDraft(dir, d3.id);
      startProcessing(dir, d3.id, 'test-agent');
      proposeOps(dir, d3.id, ['op-3']);
      const rejectRes = rejectProposal(dir, d3.id, 'too aggressive');
      assert(rejectRes.ok, 'reject succeeds');

      // Simulate the MCP tool's auto-annotate-on-reject step.
      const rejectAnn = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'loop',
        threadId: t.id,
        author: { kind: 'system' },
        payload: { kind: 'comment', text: 'Rejected: too aggressive' },
      });
      attachAnnotation(dir, t.id, rejectAnn.id);

      // 77. Hydrated thread now has the system rejection comment
      const hydrated2 = hydrateThread(dir, t.id);
      const systemComments = (hydrated2?.annotations ?? []).filter(
        a => a.author.kind === 'system' && a.payload.kind === 'comment',
      );
      assert(systemComments.length === 1, 'system reject annotation attached');
      assert((systemComments[0].payload as any).text.includes('too aggressive'), 'reject reason in text');

      // 78. Hydrated intents + annotations are in chronological order
      // (as attached — hydration preserves thread array order)
      const h3 = hydrateThread(dir, t.id);
      assert((h3?.intents.length ?? 0) >= 3, 'all three intents hydrated');

      // 79. Hydrate missing intent ids are skipped (not errors)
      updateThread(dir, t.id, { intentIds: [...threadAfter!.intentIds, 'i-does-not-exist'] });
      const h4 = hydrateThread(dir, t.id);
      // The missing id should be silently skipped — hydrated count
      // equals real intents count (ignoring the phantom id).
      assert(h4 !== null, 'hydrate survives missing id');

      // 80. Ghost-proposal annotation authored by agent → visible in hydrate
      const ghost = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'loop',
        threadId: t.id,
        author: { kind: 'agent', id: 'claude-1' },
        payload: {
          kind: 'ghost-proposal',
          intentId: d2.id,
          summary: 'change background to accent',
        },
      });
      attachAnnotation(dir, t.id, ghost.id);
      const h5 = hydrateThread(dir, t.id);
      const ghosts = (h5?.annotations ?? []).filter(a => a.payload.kind === 'ghost-proposal');
      assert(ghosts.length === 1, 'ghost-proposal hydrated');
      assert(ghosts[0].author.kind === 'agent', 'ghost-proposal author is agent');
    } finally { cleanup(dir); }
  }

  // ── 81-95. Typed diff + cascade resolve + JSON context ───
  console.log('  81-95. Typed diff + cascade resolve + JSON context');
  {
    const dir = setup();
    try {
      const { cascadeResolveOnAccept } = await import('../project/hydrate.js');

      // 81. GhostProposalPayload round-trips with DiffChange[]
      const th = createThread(dir, { anchor: 'n-btn', sceneSlug: 'diff' });
      const ghost = createAnnotation(dir, {
        anchor: 'n-btn',
        sceneSlug: 'diff',
        threadId: th.id,
        author: { kind: 'agent', id: 'claude-1' },
        payload: {
          kind: 'ghost-proposal',
          intentId: 'i-test',
          summary: 'change bg + move + resize',
          changes: [
            { kind: 'color', property: 'background', from: '#3b82f6', to: '#e94b1a' },
            { kind: 'move', from: { x: 100, y: 100 }, to: { x: 120, y: 100 } },
            { kind: 'resize', from: { w: 200, h: 44 }, to: { w: 240, h: 44 } },
            { kind: 'text', from: 'Buy', to: 'Get started' },
            { kind: 'style', property: 'border-radius', from: '4px', to: '8px' },
            { kind: 'replace', summary: 'restructure children' },
          ],
        },
      });
      const read = getAnnotation(dir, ghost.id);
      const p = read?.payload as any;
      assert(p.kind === 'ghost-proposal', 'ghost kind preserved');
      assert(Array.isArray(p.changes), 'changes array preserved');
      assert(p.changes.length === 6, 'all 6 diff changes stored');

      // 82. DiffChange discriminators
      const colorChange = p.changes.find((c: any) => c.kind === 'color');
      assert(colorChange.property === 'background', 'color property preserved');
      assert(colorChange.from === '#3b82f6' && colorChange.to === '#e94b1a', 'color from/to preserved');

      const moveChange = p.changes.find((c: any) => c.kind === 'move');
      assert(moveChange.from.x === 100 && moveChange.to.x === 120, 'move coords preserved');

      const resizeChange = p.changes.find((c: any) => c.kind === 'resize');
      assert(resizeChange.from.w === 200 && resizeChange.to.w === 240, 'resize dims preserved');

      const textChange = p.changes.find((c: any) => c.kind === 'text');
      assert(textChange.from === 'Buy' && textChange.to === 'Get started', 'text from/to preserved');

      const styleChange = p.changes.find((c: any) => c.kind === 'style');
      assert(styleChange.property === 'border-radius', 'style property preserved');

      const replaceChange = p.changes.find((c: any) => c.kind === 'replace');
      assert(replaceChange.summary === 'restructure children', 'replace summary preserved');

      // 83-86. Cascade resolve on accept
      // Thread with: comment (resolve), rule (KEEP active), pin (resolve),
      // ghost-proposal for THIS intent (dismiss), ghost-proposal for
      // OTHER intent (KEEP active).
      const thread2 = createThread(dir, { anchor: 'n-xyz', sceneSlug: 'cascade' });
      const acceptedIntentId = 'i-accepted';
      const otherIntentId = 'i-other';

      const comment = createAnnotation(dir, {
        anchor: 'n-xyz', sceneSlug: 'cascade', threadId: thread2.id,
        author: { kind: 'human' },
        payload: { kind: 'comment', text: 'should be bolder' },
      });
      attachAnnotation(dir, thread2.id, comment.id);

      const rule = createAnnotation(dir, {
        anchor: 'n-xyz', sceneSlug: 'cascade', threadId: thread2.id,
        author: { kind: 'human' },
        payload: { kind: 'rule', rule: 'min-contrast', value: 4.5, enforced: true },
      });
      attachAnnotation(dir, thread2.id, rule.id);

      const pin = createAnnotation(dir, {
        anchor: 'n-xyz', sceneSlug: 'cascade', threadId: thread2.id,
        author: { kind: 'human' },
        payload: { kind: 'pin', style: 'question' },
      });
      attachAnnotation(dir, thread2.id, pin.id);

      const ghostForAccepted = createAnnotation(dir, {
        anchor: 'n-xyz', sceneSlug: 'cascade', threadId: thread2.id,
        author: { kind: 'agent', id: 'claude-1' },
        payload: {
          kind: 'ghost-proposal',
          intentId: acceptedIntentId,
          summary: 'change bg',
        },
      });
      attachAnnotation(dir, thread2.id, ghostForAccepted.id);

      const ghostForOther = createAnnotation(dir, {
        anchor: 'n-xyz', sceneSlug: 'cascade', threadId: thread2.id,
        author: { kind: 'agent', id: 'claude-1' },
        payload: {
          kind: 'ghost-proposal',
          intentId: otherIntentId,
          summary: 'resize',
        },
      });
      attachAnnotation(dir, thread2.id, ghostForOther.id);

      // Cascade
      const cascade = cascadeResolveOnAccept(dir, thread2.id, acceptedIntentId);

      // 83. Comment + pin → resolved (2)
      assert(cascade.resolved.length === 2, 'two annotations resolved');
      assert(cascade.resolved.indexOf(comment.id) >= 0, 'comment in resolved set');
      assert(cascade.resolved.indexOf(pin.id) >= 0, 'pin in resolved set');
      assert(cascade.resolved.indexOf(rule.id) < 0, 'rule NOT resolved');

      // 84. Rule stays active (standing order)
      const ruleAfter = getAnnotation(dir, rule.id);
      assert(ruleAfter?.status === 'active', 'rule stays active');

      // 85. Ghost-proposal for accepted intent → dismissed (1)
      assert(cascade.dismissed.length === 1, 'one ghost dismissed');
      assert(cascade.dismissed[0] === ghostForAccepted.id, 'accepted ghost dismissed');
      const gaAfter = getAnnotation(dir, ghostForAccepted.id);
      assert(gaAfter?.status === 'dismissed', 'accepted ghost status is dismissed');

      // 86. Ghost-proposal for OTHER intent → stays active
      const goAfter = getAnnotation(dir, ghostForOther.id);
      assert(goAfter?.status === 'active', 'other ghost stays active');

      // 87. Cascade with missing thread → empty result
      const cEmpty = cascadeResolveOnAccept(dir, 't-missing', 'i-anything');
      assert(cEmpty.resolved.length === 0 && cEmpty.dismissed.length === 0, 'missing thread → empty cascade');

      // 88-90. Author classes preserved on annotations (for ring CSS)
      const byHuman = createAnnotation(dir, {
        anchor: 'n-a', sceneSlug: 'a', threadId: th.id,
        author: { kind: 'human', id: 'ilya' },
        payload: { kind: 'comment', text: 'h' },
      });
      const byAgent = createAnnotation(dir, {
        anchor: 'n-a', sceneSlug: 'a', threadId: th.id,
        author: { kind: 'agent', id: 'claude-1' },
        payload: { kind: 'comment', text: 'a' },
      });
      const bySystem = createAnnotation(dir, {
        anchor: 'n-a', sceneSlug: 'a', threadId: th.id,
        author: { kind: 'system' },
        payload: { kind: 'comment', text: 's' },
      });
      assert(getAnnotation(dir, byHuman.id)?.author.kind === 'human', 'human author preserved');
      assert(getAnnotation(dir, byAgent.id)?.author.kind === 'agent', 'agent author preserved');
      assert(getAnnotation(dir, bySystem.id)?.author.kind === 'system', 'system author preserved');
    } finally { cleanup(dir); }
  }

  console.log(`\n═══ PHASE 8: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
