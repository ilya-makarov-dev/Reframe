/**
 * Phase 7.0 live demo — full intent lifecycle end-to-end on real filesystem.
 *
 * Simulates the canonical flow:
 *   1. Human (via Platform UI) composes a multi-part intent and commits it
 *   2. Agent (via MCP) fetches the queue, proposes ops
 *   3. Human reviews, accepts/rejects
 *   4. Template + refine flows demonstrated alongside
 *   5. Counts + archive maintenance
 *
 * Run: npx tsx packages/core/src/tests/phase7-live-demo.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initProject,
  createDraft,
  addPartToDraft,
  commitDraft,
  fetchNextBatch,
  proposeOps,
  acceptProposal,
  refineIntent,
  saveTemplate,
  applyTemplate,
  listIntents,
  countByStatus,
  archiveTerminal,
  getIntent,
  queueFilePath,
  type IntentPart,
} from '../project/index.js';

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase7-live-'));
  console.log(`\n[1] sandbox: ${dir}`);
  initProject(dir, 'Phase 7 Live Demo');

  // ─── Step A: Human composes a rich multi-part intent ───
  console.log('\n[2] HUMAN composes intent via Platform UI (simulated):');
  console.log('    - selects a CTA button');
  console.log('    - draws an arrow upward');
  console.log('    - types "move it up and make it bolder"');
  console.log('    - attaches a reference brand');

  const humanIntent = createDraft(dir, [
    { kind: 'select', nodes: ['h:cta-button'], scope: 'scene' },
    { kind: 'annotate',
      shape: 'arrow',
      points: [[0.5, 0.7], [0.5, 0.3]],
      coordSpace: 'normalized',
      note: 'bring it above the fold' },
    { kind: 'text', value: 'move this CTA up and make it bolder' },
    { kind: 'ref-brand', brand: 'stripe' },
    { kind: 'preserve', keys: ['href'] },
    { kind: 'priority', value: 'must' },
  ], {
    author: { kind: 'human', id: 'ilya', label: 'Ilya' },
    label: 'Make hero CTA pop',
    sceneSlug: 'home',
  });
  console.log(`    → intent ${humanIntent.id} created (${humanIntent.parts.length} parts, status=draft)`);

  // ─── Step B: Commit to queue ───
  const c = commitDraft(dir, humanIntent.id);
  console.log(`\n[3] HUMAN commits → ${c.status}`);

  // ─── Step C: Agent fetches batch ───
  console.log('\n[4] AGENT (Cursor, MCP session) calls reframe_intent process:');
  const batch = fetchNextBatch(dir, 'cursor-agent-session-abc', 10);
  console.log(`    → fetched ${batch.length} intent(s), marked processing`);
  for (const intent of batch) {
    console.log(`    [${intent.id}] processed by ${intent.processingBy}`);
    for (const part of intent.parts) {
      const p = part as any;
      const summary =
        p.kind === 'select'    ? `select ${p.nodes.length} nodes` :
        p.kind === 'annotate'  ? `${p.shape} with ${p.points?.length ?? 0}pts` :
        p.kind === 'text'      ? `text "${p.value.slice(0, 40)}..."` :
        p.kind === 'ref-brand' ? `ref-brand ${p.brand}` :
        p.kind === 'preserve'  ? `preserve ${p.keys.join(',')}` :
        p.kind === 'priority'  ? `priority ${p.value}` :
        p.kind;
      console.log(`      · ${summary}`);
    }
  }

  // ─── Step D: Agent "generates" ops (simulated — real agent would call reframe_edit) ───
  console.log('\n[5] AGENT generates ops by reasoning over the parts:');
  const generatedOpIds = [
    'op-move-cta-up-40px',
    'op-set-font-weight-700',
    'op-bind-fill-to-stripe-primary',
  ];
  console.log(`    → generated ${generatedOpIds.length} ops:`);
  for (const id of generatedOpIds) console.log(`      · ${id}`);

  const propResult = proposeOps(dir, humanIntent.id, generatedOpIds);
  console.log(`    → status: ${propResult.status}`);

  // ─── Step E: Human reviews the proposal ───
  console.log('\n[6] HUMAN reviews proposal via Platform diff viewer:');
  const proposed = getIntent(dir, humanIntent.id);
  console.log(`    intent.status = ${proposed?.status}`);
  console.log(`    proposedOpIds = ${JSON.stringify(proposed?.proposedOpIds)}`);

  // ─── Step F: Accept ───
  console.log('\n[7] HUMAN clicks Accept:');
  const acc = acceptProposal(dir, humanIntent.id);
  console.log(`    → ${acc.status}, ${generatedOpIds.length} ops will be replayed on next reframe_compile`);

  // ─── Step G: Refine flow ───
  // We run refine BEFORE template demo so fetchNextBatch picks up the
  // "first" intent (no other queued entries competing for the oldest slot).
  console.log('\n[8] Refine flow: human wants to tweak after seeing proposal');
  const first = createDraft(dir, [{ kind: 'text', value: 'initial idea' }]);
  commitDraft(dir, first.id);
  fetchNextBatch(dir, 'agent', 1);
  proposeOps(dir, first.id, ['op-initial']);
  console.log(`    ${first.id}: draft → queued → processing → proposed`);

  // Instead of accept, human refines with more parts
  const refined = refineIntent(dir, first.id, [
    { kind: 'text', value: 'actually more dramatic this time' },
    { kind: 'degree', value: 'extreme' },
  ]);
  console.log(`    → ${first.id} → refined`);
  console.log(`    → child ${refined.child?.id} (${refined.child?.parts.length} parts merged from parent + 2 new)`);

  // ─── Step H: Template workflow ───
  console.log('\n[9] Template flow: save, apply, tweak, commit');
  const tplParts: IntentPart[] = [
    { kind: 'role', role: 'cta' },
    { kind: 'text', value: 'make CTAs more dramatic but keep contrast' },
    { kind: 'apply-macro', macro: 'brutalize' },
    { kind: 'preserve', keys: ['href'] },
    { kind: 'avoid', rule: 'contrast-minimum', value: 4.5 },
  ];
  const tpl = saveTemplate(dir, 'Brutal CTAs', tplParts, {
    description: 'Apply brutalize macro to every CTA while keeping contrast',
    tags: ['cta', 'branding', 'accessibility'],
  });
  console.log(`    → saved template "${tpl.name}" (slug=${tpl.slug}, rev=${tpl.revision})`);

  const applied = applyTemplate(dir, 'Brutal CTAs', {
    sceneSlug: 'pricing',
    extraParts: [{ kind: 'scope', value: 'scene', sceneId: 'pricing' }],
  });
  console.log(`    → applied as draft ${applied?.id} (${applied?.parts.length} parts)`);

  commitDraft(dir, applied!.id);
  console.log(`    → committed`);

  // ─── Step I: Counts + archive ───
  console.log('\n[10] Queue state:');
  const counts = countByStatus(dir);
  for (const [status, n] of Object.entries(counts)) {
    if (n > 0) console.log(`    ${status}: ${n}`);
  }

  console.log('\n[11] Archive terminal intents:');
  const archiveResult = archiveTerminal(dir);
  console.log(`    → archived ${archiveResult.archived}, compacted ${archiveResult.compacted}`);

  const countsAfter = countByStatus(dir);
  console.log('    queue after:');
  for (const [status, n] of Object.entries(countsAfter)) {
    if (n > 0) console.log(`      ${status}: ${n}`);
  }

  // ─── Step J: File on disk inspection ───
  console.log('\n[12] File structure:');
  const queueStat = fs.statSync(queueFilePath(dir));
  console.log(`    queue.jsonl: ${queueStat.size} bytes`);
  const archivePath = path.join(dir, '.reframe/intents/archive.jsonl');
  if (fs.existsSync(archivePath)) {
    const archiveStat = fs.statSync(archivePath);
    console.log(`    archive.jsonl: ${archiveStat.size} bytes`);
  }
  const templatesDir = path.join(dir, '.reframe/intents/templates');
  if (fs.existsSync(templatesDir)) {
    const tplFiles = fs.readdirSync(templatesDir);
    console.log(`    templates/: ${tplFiles.length} file(s) — ${tplFiles.join(', ')}`);
  }

  // ─── Final validation ───
  // After archive, terminal intents are in the archive file with
  // status='archived'. Their pre-archive terminal state is recoverable
  // via the metadata fields (acceptedOpIds for accepted, refinedIntoId
  // for refined, rejectedReason for rejected).
  const finalIntent = getIntent(dir, humanIntent.id);
  const firstAfter = getIntent(dir, first.id);
  const ok =
    finalIntent?.status === 'archived' &&
    finalIntent?.acceptedOpIds?.length === 3 &&
    finalIntent?.processingBy === 'cursor-agent-session-abc' &&
    !!refined.child &&
    firstAfter?.status === 'archived' &&
    firstAfter?.refinedIntoId === refined.child?.id &&  // refine link survives
    countsAfter.queued === 1;  // brutal-CTAs committed draft still active

  console.log(`\n${ok ? '✓' : '✗'} Phase 7.0 live demo ${ok ? 'complete' : 'FAILED'}.`);
  console.log(`  Sandbox kept at: ${dir}`);
  if (!ok) process.exit(1);
}

main().catch(e => { console.error('CRASH', e); process.exit(1); });
