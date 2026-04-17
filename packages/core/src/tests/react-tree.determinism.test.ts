/**
 * Determinism tests for exportToReactTree.
 *
 * The whole point of Phase 1 React tree export is that it's byte-deterministic:
 * same INode tree + same options → same files map, every time. If this test
 * ever fails, we lost the moat that makes this skill better than LLM-refactor.
 *
 * Run: npx tsx packages/core/src/tests/react-tree.determinism.test.ts
 */

import { exportToReactTree } from '../exporters/react';
import { SceneGraph } from '../engine/scene-graph';
import { NodeType } from '../host';
import { StandaloneNode } from '../adapters/standalone/node';

// ─── Fixtures ─────────────────────────────────────────────────

function buildSceneWithSemanticRoles(): StandaloneNode {
  const graph = new SceneGraph();
  const page = graph.addPage('Landing');
  const root = graph.createNode(NodeType.Frame, page.id, {
    name: 'Root',
    width: 1440,
    height: 2400,
    layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID', color: { r: 0.04, g: 0.15, b: 0.25, a: 1 }, opacity: 1, visible: true }],
  });

  // 3 sections with semanticRoles — should split into 3 separate files.
  const nav = graph.createNode(NodeType.Frame, root.id, {
    name: 'Nav',
    width: 1440,
    height: 72,
    fills: [{ type: 'SOLID', color: { r: 0.04, g: 0.15, b: 0.25, a: 1 }, opacity: 1, visible: true }],
  });
  graph.updateNode(nav.id, { semanticRole: 'nav' } as any);

  const hero = graph.createNode(NodeType.Frame, root.id, {
    name: 'Hero',
    width: 1440,
    height: 800,
    fills: [{ type: 'SOLID', color: { r: 0.04, g: 0.15, b: 0.25, a: 1 }, opacity: 1, visible: true }],
  });
  graph.updateNode(hero.id, { semanticRole: 'hero' } as any);

  // Hero has children with enough content
  for (let i = 0; i < 4; i++) {
    graph.createNode(NodeType.Frame, hero.id, {
      name: `HeroChild${i}`,
      width: 100,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 0.05, g: 0.16, b: 0.30, a: 1 }, opacity: 1, visible: true }],
    });
  }

  const footer = graph.createNode(NodeType.Frame, root.id, {
    name: 'Footer',
    width: 1440,
    height: 240,
    fills: [{ type: 'SOLID', color: { r: 0.04, g: 0.15, b: 0.25, a: 1 }, opacity: 1, visible: true }],
  });
  graph.updateNode(footer.id, { semanticRole: 'footer' } as any);

  return new StandaloneNode(graph, graph.getNode(root.id)!);
}

function buildSceneWithoutSemanticRoles(): StandaloneNode {
  const graph = new SceneGraph();
  const page = graph.addPage('Simple');
  const root = graph.createNode(NodeType.Frame, page.id, {
    name: 'SimpleRoot',
    width: 1200,
    height: 800,
    layoutMode: 'VERTICAL',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
  });

  // No semanticRoles on children; some have ≥3 descendants, some don't.
  // Fallback rule should pick the ones with descendants.
  const richSection = graph.createNode(NodeType.Frame, root.id, {
    name: 'RichSection',
    width: 1200,
    height: 400,
    fills: [{ type: 'SOLID', color: { r: 0.95, g: 0.95, b: 0.95, a: 1 }, opacity: 1, visible: true }],
  });
  for (let i = 0; i < 5; i++) {
    graph.createNode(NodeType.Frame, richSection.id, {
      name: `RichChild${i}`,
      width: 100,
      height: 40,
      fills: [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, opacity: 1, visible: true }],
    });
  }

  // Thin section — 1 child — should be excluded by fallback threshold (≥3)
  const thinSection = graph.createNode(NodeType.Frame, root.id, {
    name: 'ThinSection',
    width: 1200,
    height: 100,
    fills: [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85, a: 1 }, opacity: 1, visible: true }],
  });
  graph.createNode(NodeType.Frame, thinSection.id, {
    name: 'ThinChild',
    width: 50,
    height: 50,
    fills: [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, opacity: 1, visible: true }],
  });

  return new StandaloneNode(graph, graph.getNode(root.id)!);
}

// ─── Test runner ──────────────────────────────────────────────

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, predicate: () => boolean | { ok: boolean; detail?: string }): void {
  try {
    const r = predicate();
    const ok = typeof r === 'boolean' ? r : r.ok;
    const detail = typeof r === 'boolean' ? '' : (r.detail ?? '');
    results.push({ name, ok, detail });
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail ? ' — ' + detail : ''}`);
  } catch (err: any) {
    results.push({ name, ok: false, detail: err?.message ?? String(err) });
    console.log(`  \x1b[31m✗\x1b[0m ${name} — ${err?.message ?? err}`);
  }
}

function diffFileMaps(a: Record<string, string>, b: Record<string, string>): string[] {
  const keysA = new Set(Object.keys(a));
  const keysB = new Set(Object.keys(b));
  const diffs: string[] = [];
  for (const k of keysA) {
    if (!keysB.has(k)) diffs.push(`only in A: ${k}`);
    else if (a[k] !== b[k]) diffs.push(`different content: ${k} (A=${a[k].length} chars, B=${b[k].length} chars)`);
  }
  for (const k of keysB) {
    if (!keysA.has(k)) diffs.push(`only in B: ${k}`);
  }
  return diffs;
}

// ─── Tests ────────────────────────────────────────────────────

console.log('\n\x1b[1m1. Determinism — same input produces byte-equal output\x1b[0m');

check('same scene + same options → byte-equal files map', () => {
  const sceneA = buildSceneWithSemanticRoles();
  const sceneB = buildSceneWithSemanticRoles();
  const a = exportToReactTree(sceneA, { target: 'inline', pageSlug: 'landing' });
  const b = exportToReactTree(sceneB, { target: 'inline', pageSlug: 'landing' });
  const diffs = diffFileMaps(a.files, b.files);
  return { ok: diffs.length === 0, detail: diffs.length === 0 ? `${Object.keys(a.files).length} files, all equal` : diffs.join('; ') };
});

check('determinism across repeated calls (×5) on same scene', () => {
  const scene = buildSceneWithSemanticRoles();
  const first = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing' });
  for (let i = 0; i < 5; i++) {
    const run = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing' });
    if (diffFileMaps(first.files, run.files).length > 0) {
      return { ok: false, detail: `diverged on run ${i + 1}` };
    }
  }
  return true;
});

console.log('\n\x1b[1m2. Semantic-role extraction\x1b[0m');

check('3 sections with semanticRole → 3 section files', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing' });
  const expected = ['Nav', 'Hero', 'Footer'];
  const missing = expected.filter((name) => !res.manifest.sections.some((s) => s.name === name));
  return { ok: missing.length === 0, detail: missing.length === 0 ? `3 sections: ${expected.join(', ')}` : `missing: ${missing.join(', ')}` };
});

check('entry page imports all sections', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing' });
  const entry = res.files[res.entry];
  const expectedImports = ['Nav', 'Hero', 'Footer'];
  const missing = expectedImports.filter((name) => !entry.includes(`import ${name} from`));
  return { ok: missing.length === 0, detail: missing.length === 0 ? 'all imports present' : `missing: ${missing.join(', ')}` };
});

check('paths follow src/ base convention', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing' });
  const allStartWithSrc = Object.keys(res.files).every((p) => p.startsWith('src/'));
  return { ok: allStartWithSrc, detail: allStartWithSrc ? '' : 'some paths missing src/ prefix' };
});

console.log('\n\x1b[1m3. No-semantic-role fallback\x1b[0m');

check('scene without semanticRoles falls back by descendant count', () => {
  const scene = buildSceneWithoutSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'simple' });
  // RichSection has 5 descendants (passes threshold); ThinSection has 1 (excluded)
  const names = res.manifest.sections.map((s) => s.name);
  const hasRich = names.includes('RichSection');
  const excludedThin = !names.includes('ThinSection');
  return {
    ok: hasRich && excludedThin,
    detail: `got sections: [${names.join(', ')}]; rich=${hasRich}, thin-excluded=${excludedThin}`,
  };
});

console.log('\n\x1b[1m4. Phase 2/3 scaffolding\x1b[0m');

check('extractPrimitives=true emits notes, no primitives', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing', extractPrimitives: true });
  const hasNote = res.manifest.notes.some((n) => n.toLowerCase().includes('extractprimitives'));
  const emptyPrims = res.manifest.primitives.length === 0;
  return { ok: hasNote && emptyPrims, detail: `note: ${hasNote}, primitives empty: ${emptyPrims}` };
});

check('extractHooks=true emits notes, no hooks', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'inline', pageSlug: 'landing', extractHooks: true });
  const hasNote = res.manifest.notes.some((n) => n.toLowerCase().includes('extracthooks'));
  const emptyHooks = res.manifest.hooks.length === 0;
  return { ok: hasNote && emptyHooks, detail: `note: ${hasNote}, hooks empty: ${emptyHooks}` };
});

check('tailwind target falls back + emits notes', () => {
  const scene = buildSceneWithSemanticRoles();
  const res = exportToReactTree(scene, { target: 'tailwind', pageSlug: 'landing' });
  const hasNote = res.manifest.notes.some((n) => n.toLowerCase().includes('tailwind'));
  return { ok: hasNote, detail: `note present: ${hasNote}` };
});

// ─── Summary ──────────────────────────────────────────────────

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n\x1b[1mSummary:\x1b[0m ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  process.exit(1);
}
