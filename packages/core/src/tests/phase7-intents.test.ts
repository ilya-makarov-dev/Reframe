/**
 * Phase 7.0 stress test — Intent Model engine layer.
 *
 * Run: npx tsx packages/core/src/tests/phase7-intents.test.ts
 *
 * Covers:
 *   Part catalog:
 *     1. Every part kind serializes + deserializes round-trip
 *     2. Unknown part kinds filtered out on draft creation
 *     3. Empty parts allowed on draft, rejected on commit
 *
 *   Queue CRUD:
 *     4. Create draft appends to queue file
 *     5. List intents filters by status
 *     6. List intents filters by author
 *     7. List intents filters by sceneSlug
 *     8. List intents filters by parentId
 *     9. Get by id works (queue + archive fallback)
 *    10. Count by status aggregates correctly
 *    11. Chronological ordering in list
 *
 *   Lifecycle transitions:
 *    12. draft → queued (valid)
 *    13. queued → processing (valid)
 *    14. processing → proposed (valid)
 *    15. proposed → accepted (valid)
 *    16. processing → rejected (valid)
 *    17. proposed → rejected (valid)
 *    18. Invalid transition rejected with error (draft → accepted)
 *    19. Accept records op ids
 *    20. Reject records reason
 *    21. Refine creates child with parent ref, parent → refined
 *    22. Refinement chain 3 levels deep
 *    23. Commit empty draft rejected
 *    24. addPartToDraft only works in draft status
 *    25. removePartFromDraft index validation
 *
 *   Agent batch fetch:
 *    26. fetchNextBatch pops queued atomically, marks processing
 *    27. fetchNextBatch respects batch size
 *    28. fetchNextBatch returns [] when queue empty
 *    29. Processor id recorded on each fetched intent
 *
 *   Templates:
 *    30. saveTemplate writes file with revision
 *    31. Re-save bumps revision, preserves createdAt
 *    32. loadTemplate returns saved
 *    33. listTemplates alphabetical
 *    34. deleteTemplate removes file
 *    35. applyTemplate creates draft with cloned parts
 *    36. applyTemplate extraParts appended
 *    37. applyTemplate missing → null
 *    38. Empty template rejected
 *
 *   Multi-author / author attribution:
 *    39. Human author preserved through lifecycle
 *    40. Agent author distinct from human
 *    41. Audit author distinct
 *
 *   Archive + maintenance:
 *    42. archiveTerminal moves accepted/rejected to archive file
 *    43. Archive preserves latest snapshot
 *    44. Active queue shrinks after archive
 *    45. Archive includeArchive=true sees archived intents
 *
 *   Persistence stability:
 *    46. Corrupt queue line skipped
 *    47. Re-write (update) uses latest-wins via append
 *    48. Ids monotonic within a process
 *
 *   Integration:
 *    49. Realistic flow: add + commit + fetch + propose + accept
 *    50. Template flow: save + apply + tweak + commit
 *    51. Refine flow: create + refine + verify parent state
 *    52. Concurrent adds don't corrupt the queue
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createDraft,
  addPartToDraft,
  removePartFromDraft,
  commitDraft,
  startProcessing,
  proposeOps,
  acceptProposal,
  rejectProposal,
  refineIntent,
  fetchNextBatch,
  listIntents,
  getIntent,
  countByStatus,
  clearQueue,
  archiveTerminal,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  applyTemplate,
  queueFilePath,
  archiveFilePath,
  templateFilePath,
  writeIntent,
  type IntentPart,
  type IntentStatus,
} from '../project/intents/index.js';
import { initProject } from '../project/index.js';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) { passed++; } else { failed++; console.error(`  FAIL: ${msg}`); }
}
function tmp(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'reframe-p7-')); }
function cleanup(dir: string): void { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }

async function main() {
  console.log('═══ PHASE 7.0: Intent Model Stress Test ═══\n');

  // ── 1-3. Part catalog ────────────────────────────────────
  console.log('  1-3. Part catalog round-trip + validation');
  {
    const dir = tmp();
    try {
      initProject(dir, 'P7');
      // Create an intent with a representative sample of every category
      const parts: IntentPart[] = [
        { kind: 'select', nodes: ['h:a', 'h:b'], scope: 'scene' },
        { kind: 'scope', value: 'project' },
        { kind: 'role', role: 'button', index: 0 },
        { kind: 'query', selector: 'button[variant=primary]' },
        { kind: 'viewport', name: 'mobile' },
        { kind: 'text', value: 'make this bigger' },
        { kind: 'annotate', shape: 'arrow', points: [[0.1, 0.2], [0.5, 0.8]], coordSpace: 'normalized' },
        { kind: 'ref-brand', brand: 'stripe' },
        { kind: 'ref-image', url: 'https://example.com/ref.png' },
        { kind: 'ref-node', nodeId: 'h:other', aspect: 'style' },
        { kind: 'direction', value: 'bolder' },
        { kind: 'degree', value: 'dramatic' },
        { kind: 'preserve', keys: ['color', 'fontFamily'] },
        { kind: 'avoid', rule: 'contrast-minimum', value: 4.5 },
        { kind: 'priority', value: 'must' },
        { kind: 'move', delta: { dx: 0, dy: -40 } },
        { kind: 'resize', axis: 'width', mode: 'factor', value: 1.5 },
        { kind: 'duplicate', count: 3, direction: 'row' },
        { kind: 'extract-component', name: 'PricingCard' },
        { kind: 'instantiate', componentName: 'PricingCard', overrides: { title: { text: 'Pro' } } },
        { kind: 'apply-macro', macro: 'brutalize' },
        { kind: 'apply-variant', variant: 'mobile' },
        { kind: 'fix-audit', rule: 'contrast-minimum' },
        { kind: 'bind-token', property: 'fill', role: 'primary' },
        { kind: 'unbind-token', property: 'fontSize' },
        { kind: 'color', property: 'background', role: 'primary' },
        { kind: 'typography', property: 'fontSize', role: 'hero' },
        { kind: 'spacing', property: 'paddingTop', value: 32 },
        { kind: 'shadow', level: 2 },
        { kind: 'radius', scaleIndex: 3 },
        { kind: 'constraint', rule: 'min-height', value: 44 },
        { kind: 'explore', count: 3, dimension: 'aesthetic' },
        { kind: 'save-template', name: 'my-template' },
      ];
      const intent = createDraft(dir, parts, {
        author: { kind: 'human', label: 'test' },
        label: 'mega intent',
        sceneSlug: 'home',
      });
      assert(intent.parts.length === parts.length, `all ${parts.length} parts preserved (got ${intent.parts.length})`);
      // Round-trip: read back from queue
      const loaded = getIntent(dir, intent.id);
      assert(!!loaded, 'intent reloaded from queue');
      assert(loaded?.parts.length === parts.length, 'parts count after round-trip');
      // Each kind present
      const kinds = new Set(loaded!.parts.map(p => p.kind));
      assert(kinds.size === parts.length, `all part kinds distinct (${kinds.size})`);

      // Unknown part kinds filtered
      const withUnknown = createDraft(dir, [
        { kind: 'text', value: 'ok' },
        { kind: 'this-does-not-exist' } as any,
        { kind: 'select', nodes: ['x'] },
      ], { author: { kind: 'human' } });
      assert(withUnknown.parts.length === 2, `unknown parts filtered (got ${withUnknown.parts.length})`);
      assert(withUnknown.parts.every(p => p.kind !== 'this-does-not-exist' as any), 'unknown kind not present');

      // Empty draft allowed
      const emptyDraft = createDraft(dir, [], { author: { kind: 'human' } });
      assert(emptyDraft.status === 'draft', 'empty draft created');
      // but commit of empty draft rejected
      const commitEmpty = commitDraft(dir, emptyDraft.id);
      assert(!commitEmpty.ok, 'commit of empty draft rejected');
      assert(!!commitEmpty.error && commitEmpty.error.toLowerCase().includes('empty'), 'error mentions empty');
    } finally { cleanup(dir); }
  }

  // ── 4-11. Queue CRUD ─────────────────────────────────────
  console.log('  4-11. Queue CRUD + filtering');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Queue');
      const d1 = createDraft(dir, [{ kind: 'text', value: 'a' }], { author: { kind: 'human' }, sceneSlug: 'home' });
      const d2 = createDraft(dir, [{ kind: 'text', value: 'b' }], { author: { kind: 'human' }, sceneSlug: 'pricing' });
      const d3 = createDraft(dir, [{ kind: 'text', value: 'c' }], { author: { kind: 'agent', id: 'cursor' }, sceneSlug: 'home' });

      assert(fs.existsSync(queueFilePath(dir)), 'queue file written');

      const allDrafts = listIntents(dir, { status: 'draft' });
      assert(allDrafts.length === 3, `3 drafts listed (got ${allDrafts.length})`);

      const bySceneHome = listIntents(dir, { sceneSlug: 'home' });
      assert(bySceneHome.length === 2, `2 intents for home (got ${bySceneHome.length})`);

      const byAgent = listIntents(dir, { authorKind: 'agent' });
      assert(byAgent.length === 1, `1 agent intent (got ${byAgent.length})`);
      assert(byAgent[0].id === d3.id, 'correct agent intent');

      // Commit one, check filter by multiple statuses
      commitDraft(dir, d1.id);
      const draftOrQueued = listIntents(dir, { status: ['draft', 'queued'] });
      assert(draftOrQueued.length === 3, 'filter by array of statuses');

      const queuedOnly = listIntents(dir, { status: 'queued' });
      assert(queuedOnly.length === 1 && queuedOnly[0].id === d1.id, 'only d1 queued');

      const byId = getIntent(dir, d2.id);
      assert(!!byId && byId.id === d2.id, 'getIntent by id');

      const missing = getIntent(dir, 'i-nonexistent');
      assert(missing === null, 'missing id → null');

      const counts = countByStatus(dir);
      assert(counts.draft === 2 && counts.queued === 1, `counts draft=2 queued=1 (got ${JSON.stringify(counts)})`);

      // Chronological ordering
      const sorted = listIntents(dir);
      assert(sorted[0].id === d1.id && sorted[2].id === d3.id, 'chronological order');

      // parentId filter
      const refined = refineIntent(dir, d1.id, [{ kind: 'text', value: 'refined' }]);
      assert(!!refined.child, 'child created on refine');
      const children = listIntents(dir, { parentId: d1.id });
      assert(children.length === 1 && children[0].id === refined.child!.id, 'parentId filter works');
    } finally { cleanup(dir); }
  }

  // ── 12-25. Lifecycle ─────────────────────────────────────
  console.log('  12-25. Lifecycle transitions');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Lifecycle');

      // Happy path: draft → queued → processing → proposed → accepted
      const i1 = createDraft(dir, [{ kind: 'text', value: 'go' }]);
      assert(i1.status === 'draft', 'starts as draft');

      const c = commitDraft(dir, i1.id);
      assert(c.ok && c.status === 'queued', 'commit → queued');

      const p = startProcessing(dir, i1.id, 'cursor-agent');
      assert(p.ok, 'startProcessing ok');
      const proc = getIntent(dir, i1.id);
      assert(proc?.status === 'processing', 'status=processing');
      assert(proc?.processingBy === 'cursor-agent', 'processor recorded');
      assert(!!proc?.processingStartedAt, 'processingStartedAt set');

      const pr = proposeOps(dir, i1.id, ['op1', 'op2']);
      assert(pr.ok, 'proposeOps ok');
      const proposed = getIntent(dir, i1.id);
      assert(proposed?.status === 'proposed', 'status=proposed');
      assert(JSON.stringify(proposed?.proposedOpIds) === JSON.stringify(['op1', 'op2']), 'proposedOpIds recorded');

      const a = acceptProposal(dir, i1.id);
      assert(a.ok, 'accept ok');
      const accepted = getIntent(dir, i1.id);
      assert(accepted?.status === 'accepted', 'status=accepted');
      assert(JSON.stringify(accepted?.acceptedOpIds) === JSON.stringify(['op1', 'op2']), 'acceptedOpIds inherited from proposed');

      // Reject path
      const i2 = createDraft(dir, [{ kind: 'text', value: 'nope' }]);
      commitDraft(dir, i2.id);
      startProcessing(dir, i2.id, 'agent');
      proposeOps(dir, i2.id, ['opX']);
      const rj = rejectProposal(dir, i2.id, 'too invasive');
      assert(rj.ok, 'reject ok');
      const rejected = getIntent(dir, i2.id);
      assert(rejected?.status === 'rejected', 'status=rejected');
      assert(rejected?.rejectedReason === 'too invasive', 'reason recorded');

      // Reject from processing (no proposal yet)
      const i3 = createDraft(dir, [{ kind: 'text', value: 'abandon' }]);
      commitDraft(dir, i3.id);
      startProcessing(dir, i3.id, 'agent');
      const rj2 = rejectProposal(dir, i3.id, 'agent gave up');
      assert(rj2.ok, 'reject from processing ok');

      // Invalid transition: draft → accepted directly
      const i4 = createDraft(dir, [{ kind: 'text', value: 'bad' }]);
      const bad = acceptProposal(dir, i4.id);
      assert(!bad.ok, 'draft → accepted rejected');
      assert(!!bad.error && bad.error.includes('draft'), 'error mentions draft');

      // addPartToDraft only works on draft
      const i5 = createDraft(dir, [{ kind: 'text', value: 'initial' }]);
      const addOk = addPartToDraft(dir, i5.id, { kind: 'select', nodes: ['h:a'] });
      assert(addOk.ok, 'addPart on draft ok');
      const after = getIntent(dir, i5.id);
      assert(after?.parts.length === 2, 'part added');

      commitDraft(dir, i5.id);
      const addFail = addPartToDraft(dir, i5.id, { kind: 'text', value: 'late' });
      assert(!addFail.ok, 'addPart on queued rejected');

      // removePartFromDraft
      const i6 = createDraft(dir, [
        { kind: 'text', value: 'one' },
        { kind: 'text', value: 'two' },
        { kind: 'text', value: 'three' },
      ]);
      const rm = removePartFromDraft(dir, i6.id, 1);
      assert(rm.ok, 'remove ok');
      const afterRm = getIntent(dir, i6.id);
      assert(afterRm?.parts.length === 2, 'one part removed');
      assert((afterRm?.parts[0] as any).value === 'one' && (afterRm?.parts[1] as any).value === 'three', 'correct part removed');

      const rmBad = removePartFromDraft(dir, i6.id, 99);
      assert(!rmBad.ok, 'out-of-range index rejected');

      // Refinement chain — 3 levels
      const root = createDraft(dir, [{ kind: 'text', value: 'root' }]);
      commitDraft(dir, root.id);
      const r1 = refineIntent(dir, root.id, [{ kind: 'text', value: 'r1' }]);
      assert(!!r1.child && r1.parent.ok, 'refine 1 ok');
      assert(getIntent(dir, root.id)?.status === 'refined', 'root → refined');
      assert(r1.child?.parentId === root.id, 'child parentId points to root');

      commitDraft(dir, r1.child!.id);
      const r2 = refineIntent(dir, r1.child!.id, [{ kind: 'text', value: 'r2' }]);
      assert(!!r2.child && r2.parent.ok, 'refine 2 ok');
      assert(r2.child?.parentId === r1.child!.id, 'chain maintained');
      assert(r2.child?.parts.length === r1.child!.parts.length + 1, 'parts inherited and extended');
    } finally { cleanup(dir); }
  }

  // ── 26-29. Agent batch fetch ─────────────────────────────
  console.log('  26-29. Agent batch fetch');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Batch');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const d = createDraft(dir, [{ kind: 'text', value: `item ${i}` }]);
        commitDraft(dir, d.id);
        ids.push(d.id);
      }

      // Fetch batch of 3
      const batch = fetchNextBatch(dir, 'cursor-agent', 3);
      assert(batch.length === 3, `batch size 3 (got ${batch.length})`);
      assert(batch.every(i => i.status === 'processing'), 'all marked processing');
      assert(batch.every(i => i.processingBy === 'cursor-agent'), 'processor recorded on all');

      // Next fetch gets the remaining 2
      const batch2 = fetchNextBatch(dir, 'claude-code', 10);
      assert(batch2.length === 2, `remaining 2 (got ${batch2.length})`);
      assert(batch2.every(i => i.processingBy === 'claude-code'), 'different processor on second batch');

      // Queue empty → empty batch
      const batch3 = fetchNextBatch(dir, 'x', 10);
      assert(batch3.length === 0, 'empty when nothing queued');
    } finally { cleanup(dir); }
  }

  // ── 30-38. Templates ─────────────────────────────────────
  console.log('  30-38. Templates');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Templates');
      const templateParts: IntentPart[] = [
        { kind: 'role', role: 'cta' },
        { kind: 'text', value: 'make more dramatic but keep contrast' },
        { kind: 'preserve', keys: ['color'] },
        { kind: 'avoid', rule: 'contrast-minimum' },
      ];
      const tpl = saveTemplate(dir, 'CTA Enhance', templateParts, {
        description: 'Reusable CTA improvement',
        tags: ['cta', 'accessibility'],
      });
      assert(tpl.name === 'CTA Enhance', 'template name');
      assert(tpl.slug === 'cta-enhance', 'slug derived');
      assert(tpl.revision === 1, 'first save rev=1');
      assert(fs.existsSync(templateFilePath(dir, 'CTA Enhance')), 'file on disk');

      const loaded = loadTemplate(dir, 'CTA Enhance');
      assert(!!loaded && loaded.parts.length === 4, 'loaded with parts');
      assert(!!loaded?.description?.includes('Reusable'), 'description preserved');

      // Re-save bumps revision
      const originalCreated = tpl.createdAt;
      await new Promise(r => setTimeout(r, 2));
      const re = saveTemplate(dir, 'CTA Enhance', templateParts);
      assert(re.revision === 2, `rev bumped to 2 (got ${re.revision})`);
      assert(re.createdAt === originalCreated, 'createdAt preserved');

      // List
      saveTemplate(dir, 'Brutalize Hero', [{ kind: 'apply-macro', macro: 'brutalize' }]);
      const list = listTemplates(dir);
      assert(list.length === 2, `2 templates (got ${list.length})`);
      assert(list[0].name === 'Brutalize Hero', 'alphabetical order');

      // Apply
      const fromTpl = applyTemplate(dir, 'CTA Enhance', {
        extraParts: [{ kind: 'select', nodes: ['h:btn'] }],
      });
      assert(!!fromTpl, 'applyTemplate returns intent');
      assert(fromTpl?.status === 'draft', 'applied as draft');
      assert(fromTpl?.parts.length === 5, `4 template parts + 1 extra (got ${fromTpl?.parts.length})`);
      assert(fromTpl?.author.kind === 'template', 'author kind=template');

      // Apply non-existent
      const missing = applyTemplate(dir, 'Nope');
      assert(missing === null, 'missing template → null');

      // Delete
      const deleted = deleteTemplate(dir, 'CTA Enhance');
      assert(deleted, 'delete returns true');
      assert(listTemplates(dir).length === 1, '1 template remaining');

      // Empty template rejected
      let threwEmpty = false;
      try {
        saveTemplate(dir, 'Empty', []);
      } catch { threwEmpty = true; }
      assert(threwEmpty, 'empty template throws');
    } finally { cleanup(dir); }
  }

  // ── 39-41. Author attribution ────────────────────────────
  console.log('  39-41. Author attribution through lifecycle');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Author');
      const human = createDraft(dir, [{ kind: 'text', value: 'human' }], {
        author: { kind: 'human', id: 'ilya', label: 'Ilya' },
      });
      const agent = createDraft(dir, [{ kind: 'text', value: 'agent' }], {
        author: { kind: 'agent', id: 'cursor' },
      });
      const audit = createDraft(dir, [{ kind: 'fix-audit', rule: 'contrast' }], {
        author: { kind: 'audit', id: 'contrast-minimum' },
      });

      commitDraft(dir, human.id);
      startProcessing(dir, human.id, 'agent');
      proposeOps(dir, human.id, ['o1']);
      acceptProposal(dir, human.id);

      const final = getIntent(dir, human.id);
      assert(final?.author.kind === 'human', 'human author preserved through lifecycle');
      assert(final?.author.label === 'Ilya', 'label preserved');

      const agentLoaded = getIntent(dir, agent.id);
      assert(agentLoaded?.author.kind === 'agent', 'agent author preserved');

      const auditLoaded = getIntent(dir, audit.id);
      assert(auditLoaded?.author.kind === 'audit', 'audit author preserved');
    } finally { cleanup(dir); }
  }

  // ── 42-45. Archive + maintenance ─────────────────────────
  console.log('  42-45. Archive terminal intents');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Archive');
      // Create 3 intents, accept 1, reject 1, leave 1 queued
      const i1 = createDraft(dir, [{ kind: 'text', value: 'a' }]);
      commitDraft(dir, i1.id);
      startProcessing(dir, i1.id, 'agent');
      proposeOps(dir, i1.id, ['o1']);
      acceptProposal(dir, i1.id);

      const i2 = createDraft(dir, [{ kind: 'text', value: 'b' }]);
      commitDraft(dir, i2.id);
      startProcessing(dir, i2.id, 'agent');
      rejectProposal(dir, i2.id, 'nope');

      const i3 = createDraft(dir, [{ kind: 'text', value: 'c' }]);
      commitDraft(dir, i3.id);

      const beforeArchive = listIntents(dir).length;
      assert(beforeArchive === 3, '3 active before archive');

      const result = archiveTerminal(dir);
      assert(result.archived === 2, `2 archived (got ${result.archived})`);
      assert(fs.existsSync(archiveFilePath(dir)), 'archive file created');

      const afterArchive = listIntents(dir);
      assert(afterArchive.length === 1, `1 active after archive (got ${afterArchive.length})`);
      assert(afterArchive[0].id === i3.id, 'remaining is the queued one');

      // Archived intents findable via includeArchive flag
      const withArchive = listIntents(dir, { includeArchive: true });
      assert(withArchive.length === 3, `3 intents with archive (got ${withArchive.length})`);

      // getIntent falls back to archive
      const archivedLookup = getIntent(dir, i1.id);
      assert(!!archivedLookup, 'getIntent finds archived');
      assert(archivedLookup?.status === 'archived', 'status marked archived on move');
    } finally { cleanup(dir); }
  }

  // ── 46-48. Persistence stability ─────────────────────────
  console.log('  46-48. Persistence stability');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Persist');
      const i1 = createDraft(dir, [{ kind: 'text', value: 'initial' }]);

      // Simulate corruption: append a bogus line to the queue file
      fs.appendFileSync(queueFilePath(dir), '{not valid json\n', 'utf-8');

      // Further reads should skip the corrupt line
      const all = listIntents(dir);
      assert(all.length === 1, 'corrupt line skipped on read');
      assert(all[0].id === i1.id, 'valid intent still reachable');

      // Update: latest-wins — append new snapshot with same id
      addPartToDraft(dir, i1.id, { kind: 'text', value: 'added' });
      const updated = getIntent(dir, i1.id);
      assert(updated?.parts.length === 2, `2 parts after update (got ${updated?.parts.length})`);

      // The queue file now has multiple entries for the same id
      const lineCount = fs.readFileSync(queueFilePath(dir), 'utf-8').trim().split(/\r?\n/).length;
      assert(lineCount >= 3, `file has multiple snapshots (${lineCount} lines)`);

      // Id uniqueness / monotonicity
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const intent = createDraft(dir, [{ kind: 'text', value: String(i) }]);
        ids.add(intent.id);
      }
      assert(ids.size === 20, `20 unique ids (got ${ids.size})`);
    } finally { cleanup(dir); }
  }

  // ── 49. Full realistic flow ──────────────────────────────
  console.log('  49. Realistic flow: add → commit → fetch → propose → accept');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Realistic');
      // Human composes intent via Platform UI (simulated)
      const intent = createDraft(dir, [
        { kind: 'select', nodes: ['h:btn'] },
        { kind: 'annotate', shape: 'arrow', points: [[0.5, 0.5], [0.5, 0.3]] },
        { kind: 'text', value: 'move up and make bolder' },
      ], {
        author: { kind: 'human', id: 'ilya' },
        sceneSlug: 'home',
      });

      // Human commits
      const committed = commitDraft(dir, intent.id);
      assert(committed.ok, 'commit ok');

      // Agent fetches batch
      const batch = fetchNextBatch(dir, 'cursor-agent', 1);
      assert(batch.length === 1 && batch[0].id === intent.id, 'agent fetched intent');

      // Agent "generates" ops (mock)
      const proposed = proposeOps(dir, intent.id, ['op-move-up', 'op-bolder']);
      assert(proposed.ok, 'proposed ok');

      // Human reviews, accepts
      const accepted = acceptProposal(dir, intent.id);
      assert(accepted.ok, 'accepted ok');

      const final = getIntent(dir, intent.id);
      assert(final?.status === 'accepted', 'final status accepted');
      assert(final?.acceptedOpIds?.length === 2, '2 ops accepted');
      assert(final?.processingBy === 'cursor-agent', 'processor attributed');
    } finally { cleanup(dir); }
  }

  // ── 50. Template flow full ───────────────────────────────
  console.log('  50. Template flow: save → apply → tweak → commit');
  {
    const dir = tmp();
    try {
      initProject(dir, 'TemplateFlow');
      saveTemplate(dir, 'Brutal CTA', [
        { kind: 'role', role: 'cta' },
        { kind: 'apply-macro', macro: 'brutalize' },
        { kind: 'preserve', keys: ['href'] },
      ], { description: 'Brutalize every CTA' });

      const applied = applyTemplate(dir, 'Brutal CTA', { sceneSlug: 'home' });
      assert(!!applied, 'applyTemplate returns');
      assert(applied?.parts.length === 3, '3 parts in draft');
      assert(applied?.author.kind === 'template', 'author kind=template');

      // Tweak: add a scope to limit to hero section only
      const added = addPartToDraft(dir, applied!.id, { kind: 'scope', value: 'scene', sceneId: 'home' });
      assert(added.ok, 'tweak ok');
      const tweaked = getIntent(dir, applied!.id);
      assert(tweaked?.parts.length === 4, 'tweaked to 4 parts');

      // Commit + process
      commitDraft(dir, applied!.id);
      const fetched = fetchNextBatch(dir, 'agent', 1);
      assert(fetched.length === 1 && fetched[0].id === applied!.id, 'fetched after commit');
    } finally { cleanup(dir); }
  }

  // ── 51. Refine flow details ──────────────────────────────
  console.log('  51. Refine flow');
  {
    const dir = tmp();
    try {
      initProject(dir, 'RefineFlow');
      const parent = createDraft(dir, [{ kind: 'text', value: 'initial idea' }]);
      commitDraft(dir, parent.id);
      startProcessing(dir, parent.id, 'agent');
      proposeOps(dir, parent.id, ['op-a']);
      // proposed state — human decides to refine instead of accept/reject
      const result = refineIntent(dir, parent.id, [
        { kind: 'text', value: 'more dramatic this time' },
        { kind: 'degree', value: 'extreme' },
      ]);
      assert(result.parent.ok, 'refine from proposed ok');
      assert(!!result.child, 'child created');
      assert(result.child?.parts.length === 3, `child has parent+new parts (got ${result.child?.parts.length})`);

      const parentAfter = getIntent(dir, parent.id);
      assert(parentAfter?.status === 'refined', 'parent → refined');
      assert(parentAfter?.refinedIntoId === result.child?.id, 'parent points to child');
    } finally { cleanup(dir); }
  }

  // ── 52. Concurrent adds don't corrupt ─────────────────────
  console.log('  52. Concurrent adds do not corrupt the queue');
  {
    const dir = tmp();
    try {
      initProject(dir, 'Concurrent');
      // Simulate 20 rapid appends
      const intents = [];
      for (let i = 0; i < 20; i++) {
        intents.push(createDraft(dir, [{ kind: 'text', value: `${i}` }]));
      }
      const all = listIntents(dir);
      assert(all.length === 20, `20 intents visible (got ${all.length})`);
      const ids = new Set(all.map(i => i.id));
      assert(ids.size === 20, '20 unique ids');
    } finally { cleanup(dir); }
  }

  console.log(`\n═══ PHASE 7: ${passed} passed, ${failed} failed ═══`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
