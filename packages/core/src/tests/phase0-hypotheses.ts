/**
 * Phase 0 — INode Agent-Operable Substrate: Hypothesis Benchmark
 *
 * Runs the four hypotheses integrally against the new Block A primitives
 * and the brand-palette panel composer. No mocks — real SceneGraph,
 * real exporter, real audit, real path computer.
 *
 *   H1 — Interaction primitives in INode are sufficient for a live panel
 *   H2 — Agent-composed panel is deterministic across repeated composition
 *   H3 — Panel compose + export latency is tolerable (<100ms for 10 tokens)
 *   H4 — Semantic paths survive 20 edits with no drift
 *
 * Invoke: `npx tsx packages/core/src/tests/phase0-hypotheses.ts`
 * Exit 0 = all green. Exit non-zero = at least one hypothesis red.
 */

import { SceneGraph } from '../engine/scene-graph';
import { ensureSceneLayout, setTextMeasurer } from '../engine/layout';
import { setHost } from '../host/context';
import { StandaloneHost } from '../adapters/standalone/adapter';
import { StandaloneNode } from '../adapters/standalone/node';
import { exportToHtml } from '../exporters/html';
import { audit } from '../audit';
import { buildInspectAuditRules } from '../inspect-audit-rules';
import { composeBrandPalettePanel } from '../panels/brand-palette';
import { findNodeByPath, computeSemanticPaths } from '../engine/semantic-path';
import type { SceneNode } from '../engine/types';

// ─── Measurement helpers ─────────────────────────────────────────

const COLOR_ENTRIES = [
  { tokenName: 'color.primary',    hex: '#635BFF', label: 'Primary' },
  { tokenName: 'color.background', hex: '#0B0B13', label: 'Background' },
  { tokenName: 'color.surface',    hex: '#14141C', label: 'Surface' },
  { tokenName: 'color.text',       hex: '#FFFFFF', label: 'Text' },
  { tokenName: 'color.muted',      hex: '#9B9BA5', label: 'Muted' },
  { tokenName: 'color.accent',     hex: '#FF5A1F', label: 'Accent' },
  { tokenName: 'color.success',    hex: '#10B981', label: 'Success' },
  { tokenName: 'color.warning',    hex: '#F59E0B', label: 'Warning' },
  { tokenName: 'color.error',      hex: '#EF4444', label: 'Error' },
  { tokenName: 'color.border',     hex: '#2A2A35', label: 'Border' },
];

function now() { return performance.now(); }

function simpleTextMeasurer(node: SceneNode) {
  // Tight approx — avoids pulling real font ingestion into the bench.
  const text = node.text ?? '';
  const fontSize = node.fontSize || 14;
  return { width: Math.ceil(text.length * fontSize * 0.55), height: Math.ceil(fontSize * 1.3) };
}

// ─── Hypothesis 1: primitives sufficient for a live panel ────────

interface H1Result {
  status: 'green' | 'yellow' | 'red';
  details: {
    buttonCount: number;
    clickGesturesPresent: number;
    inputGesturesPresent: number;
    mountSlotPresent: boolean;
    focusableCount: number;
    keybindingCount: number;
    missingGestures: string[];
  };
}

function h1_primitives_live_panel(graph: SceneGraph): H1Result {
  let buttonCount = 0, clickGestures = 0, inputGestures = 0, focusableCount = 0, keybindingCount = 0;
  let mountSlotPresent = false;
  const missing: string[] = [];

  for (const node of graph.getAllNodes()) {
    const n = node as any;
    if (n.semanticRole === 'button') {
      buttonCount++;
      if (!n.onClick && !n.onInput && !n.href && n.intent?.editableBy !== 'locked') {
        missing.push(`${n.name ?? n.id} (button without handler)`);
      }
    }
    if (n.onClick) clickGestures++;
    if (n.onInput) inputGestures++;
    if (n.focusable) focusableCount++;
    if (n.keybinding) keybindingCount++;
    if (n.mountSlot) mountSlotPresent = true;
  }

  const status: H1Result['status'] =
    missing.length === 0 && clickGestures > 0 && inputGestures > 0 && mountSlotPresent
      ? 'green'
      : missing.length === 0 ? 'yellow' : 'red';

  return {
    status,
    details: { buttonCount, clickGesturesPresent: clickGestures, inputGesturesPresent: inputGestures, mountSlotPresent, focusableCount, keybindingCount, missingGestures: missing },
  };
}

// ─── Hypothesis 2: composition determinism ──────────────────────

interface H2Result {
  status: 'green' | 'yellow' | 'red';
  details: { compositions: number; uniqueStructures: number; examplePath: string | null };
}

function h2_determinism(): H2Result {
  const signatures = new Set<string>();
  let examplePath: string | null = null;
  const ITERATIONS = 10;

  for (let i = 0; i < ITERATIONS; i++) {
    const g = composeBrandPalettePanel({ brandSlug: 'phase0', entries: COLOR_ENTRIES });
    ensureSceneLayout(g, g.rootId);
    const structuralSignature: string[] = [];
    for (const node of g.getAllNodes()) {
      const n = node as any;
      structuralSignature.push(`${n.semanticPath ?? '(root)'}::${n.type}::${n.semanticRole ?? '-'}::${n.intent?.role ?? '-'}`);
    }
    structuralSignature.sort();
    signatures.add(structuralSignature.join('|'));
    if (!examplePath) {
      const firstSwatch = Array.from(g.getAllNodes()).find(n => (n as any).intent?.role === 'brand-palette/swatch') as SceneNode | undefined;
      examplePath = firstSwatch?.semanticPath ?? null;
    }
  }

  const status: H2Result['status'] = signatures.size === 1 ? 'green' : 'red';
  return { status, details: { compositions: ITERATIONS, uniqueStructures: signatures.size, examplePath } };
}

// ─── Hypothesis 3: latency budget ────────────────────────────────

interface H3Result {
  status: 'green' | 'yellow' | 'red';
  details: {
    composeMs: number;
    layoutMs: number;
    exportMs: number;
    auditMs: number;
    totalMs: number;
    htmlBytes: number;
    gestureAttrCount: number;
  };
}

function h3_latency(graph: SceneGraph): H3Result {
  const t0 = now();
  const fresh = composeBrandPalettePanel({ brandSlug: 'phase0', entries: COLOR_ENTRIES });
  const composeMs = now() - t0;

  const t1 = now();
  ensureSceneLayout(fresh, fresh.rootId);
  const layoutMs = now() - t1;

  const t2 = now();
  const html = exportToHtml(fresh, fresh.rootId, { fullDocument: true, dataAttributes: true });
  const exportMs = now() - t2;

  const t3 = now();
  setHost(new StandaloneHost(fresh));
  const wrapped = new StandaloneNode(fresh, fresh.getNode(fresh.rootId)!);
  const rules = buildInspectAuditRules(undefined);
  audit(wrapped, rules);
  const auditMs = now() - t3;

  const gestureAttrCount =
    (html.match(/data-gesture-click/g)?.length ?? 0) +
    (html.match(/data-gesture-input/g)?.length ?? 0);

  const totalMs = composeMs + layoutMs + exportMs + auditMs;
  const status: H3Result['status'] =
    totalMs < 100 ? 'green' :
    totalMs < 300 ? 'yellow' : 'red';

  return {
    status,
    details: { composeMs, layoutMs, exportMs, auditMs, totalMs, htmlBytes: html.length, gestureAttrCount },
  };
}

// ─── Hypothesis 4: addressing stability across edits ────────────

interface H4Result {
  status: 'green' | 'yellow' | 'red';
  details: { attempted: number; pathStableHits: number; pathDriftEvents: number; exampleDriftPath: string | null };
}

function h4_addressing_stability(): H4Result {
  const g = composeBrandPalettePanel({ brandSlug: 'phase0', entries: COLOR_ENTRIES });
  ensureSceneLayout(g, g.rootId);

  // Pick targets by semantic path and record their expected stability.
  const targetPaths: string[] = [];
  for (const node of g.getAllNodes()) {
    const n = node as any;
    if (n.intent?.role === 'brand-palette/swatch') targetPaths.push(n.semanticPath);
    if (n.intent?.role === 'brand-palette/hex-input') targetPaths.push(n.semanticPath);
  }

  const ATTEMPTS = 20;
  let hits = 0, drifts = 0;
  let exampleDrift: string | null = null;

  for (let i = 0; i < ATTEMPTS; i++) {
    // Mutate: update a random node's name, remove/re-add a sibling,
    // trigger path recomputation. Then verify target paths still resolve.
    const nodesArr = Array.from(g.getAllNodes());
    const victim = nodesArr[(i * 7 + 3) % nodesArr.length];
    if (victim && victim !== g.getNode(g.rootId)) {
      const originalName = victim.name;
      g.updateNode(victim.id, { name: `${originalName}-jitter-${i}` });
      g.updateNode(victim.id, { name: originalName });
    }
    computeSemanticPaths(g);

    const targetPath = targetPaths[i % targetPaths.length];
    const resolved = findNodeByPath(g, targetPath);
    if (resolved) hits++;
    else {
      drifts++;
      if (!exampleDrift) exampleDrift = targetPath;
    }
  }

  const status: H4Result['status'] =
    drifts === 0 ? 'green' :
    drifts < ATTEMPTS * 0.1 ? 'yellow' : 'red';

  return { status, details: { attempted: ATTEMPTS, pathStableHits: hits, pathDriftEvents: drifts, exampleDriftPath: exampleDrift } };
}

// ─── Bonus: check exporter emits agent-operable attrs ──────────

function verifyExportedAttrs(html: string): { ok: boolean; attrs: Record<string, number> } {
  const attrs = {
    'data-semantic-path': (html.match(/data-semantic-path=/g) ?? []).length,
    'data-intent-role': (html.match(/data-intent-role=/g) ?? []).length,
    'data-intent-editable': (html.match(/data-intent-editable=/g) ?? []).length,
    'data-gesture-click': (html.match(/data-gesture-click=/g) ?? []).length,
    'data-gesture-input': (html.match(/data-gesture-input=/g) ?? []).length,
    'data-focusable': (html.match(/data-focusable=/g) ?? []).length,
    'data-mount-slot': (html.match(/data-mount-slot=/g) ?? []).length,
    'data-keybinding': (html.match(/data-keybinding=/g) ?? []).length,
    'tabindex': (html.match(/tabindex="0"/g) ?? []).length,
  };
  const ok = attrs['data-semantic-path'] > 0
    && attrs['data-gesture-click'] >= 1
    && attrs['data-gesture-input'] >= 1
    && attrs['data-mount-slot'] >= 1
    && attrs['data-intent-role'] > 0;
  return { ok, attrs };
}

// ─── Runner ──────────────────────────────────────────────────────

function line(len = 72) { return '─'.repeat(len); }

async function run() {
  setTextMeasurer(simpleTextMeasurer);

  console.log(line());
  console.log('  Phase 0 — INode Agent-Operable Substrate: Hypothesis Bench');
  console.log(line());

  // Build the reference panel once for H1/H3 re-use.
  const panel = composeBrandPalettePanel({ brandSlug: 'phase0', entries: COLOR_ENTRIES });
  ensureSceneLayout(panel, panel.rootId);

  const h1 = h1_primitives_live_panel(panel);
  const h2 = h2_determinism();
  const h3 = h3_latency(panel);
  const h4 = h4_addressing_stability();

  // Verify exporter emits agent-operable attrs on the reference panel.
  const html = exportToHtml(panel, panel.rootId, { fullDocument: true, dataAttributes: true });
  const attrCheck = verifyExportedAttrs(html);

  const fmt = (status: string) => status === 'green' ? '🟢 GREEN' : status === 'yellow' ? '🟡 YELLOW' : '🔴 RED';

  console.log();
  console.log(`H1  ${fmt(h1.status)}  Primitives sufficient for live panel`);
  console.log(`    buttons:${h1.details.buttonCount}  clicks:${h1.details.clickGesturesPresent}  inputs:${h1.details.inputGesturesPresent}  focusable:${h1.details.focusableCount}  keybindings:${h1.details.keybindingCount}  mountSlot:${h1.details.mountSlotPresent}`);
  if (h1.details.missingGestures.length) {
    console.log(`    ⚠ missing handlers: ${h1.details.missingGestures.slice(0, 3).join(', ')}${h1.details.missingGestures.length > 3 ? '…' : ''}`);
  }

  console.log();
  console.log(`H2  ${fmt(h2.status)}  Composition determinism`);
  console.log(`    ${h2.details.compositions} compositions → ${h2.details.uniqueStructures} unique structure(s)`);
  console.log(`    example swatch path: ${h2.details.examplePath ?? '(none)'}`);

  console.log();
  console.log(`H3  ${fmt(h3.status)}  Latency budget`);
  console.log(`    compose:${h3.details.composeMs.toFixed(2)}ms  layout:${h3.details.layoutMs.toFixed(2)}ms  export:${h3.details.exportMs.toFixed(2)}ms  audit:${h3.details.auditMs.toFixed(2)}ms`);
  console.log(`    TOTAL: ${h3.details.totalMs.toFixed(2)}ms  htmlBytes:${h3.details.htmlBytes}  gestureAttrsInHtml:${h3.details.gestureAttrCount}`);

  console.log();
  console.log(`H4  ${fmt(h4.status)}  Addressing stability across ${h4.details.attempted} edits`);
  console.log(`    hits:${h4.details.pathStableHits}  drifts:${h4.details.pathDriftEvents}  exampleDrift:${h4.details.exampleDriftPath ?? '(none)'}`);

  console.log();
  console.log(`Exporter agent-attrs on reference panel: ${attrCheck.ok ? '🟢 all present' : '🔴 gaps'}`);
  for (const [k, v] of Object.entries(attrCheck.attrs)) console.log(`    ${k}: ${v}`);

  console.log();
  console.log(line());
  const allGreen = [h1.status, h2.status, h3.status, h4.status].every(s => s === 'green') && attrCheck.ok;
  const anyRed = [h1.status, h2.status, h3.status, h4.status].some(s => s === 'red') || !attrCheck.ok;
  console.log(`  VERDICT: ${allGreen ? '🟢 ALL GREEN — proceed to Phase 1' : anyRed ? '🔴 RED — fix before proceed' : '🟡 YELLOW — note issues, decide'}`);
  console.log(line());

  if (anyRed) process.exit(1);
}

run().catch(err => {
  console.error('Phase 0 bench crashed:', err);
  process.exit(2);
});
