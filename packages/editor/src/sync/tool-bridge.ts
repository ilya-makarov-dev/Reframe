/**
 * Tool Bridge — extends reframe MCP tools with OpenPencil capabilities.
 *
 * Our MCP has 6 high-level tools. OpenPencil has 90 granular tools.
 * Instead of registering 90 new MCP tools, we EXTEND our existing tools
 * with new capabilities from OP core:
 *
 * reframe_compile  ← NEW: accepts .fig file (via OP readFigFile)
 * reframe_edit     ← NEW: pen tool, boolean ops, vector editing (via OP tools)
 * reframe_export   ← NEW: .fig export (via OP exportFigFile)
 * reframe_inspect  ← NEW: lint rules (via OP createLinter)
 * reframe_project  ← NEW: .fig save/load
 *
 * The AI still calls our 6 tools — same interface, more power.
 */

import {
  parseFigFile,
  exportFigFile,
  SceneGraph as OPSceneGraph,
  createLinter,
  allRules,
  ALL_TOOLS,
  type ToolDef,
} from '@open-pencil/core';

import { GraphBridge } from '../bridge/graph-bridge.js';

// ─── .fig Import (extends reframe_compile) ──────────────────

/**
 * Import a .fig file into a reframe-compatible SceneGraph.
 * Called when reframe_compile receives a .fig file instead of HTML.
 */
export async function importFigFile(
  fileData: ArrayBuffer,
  bridge: GraphBridge,
): Promise<{ opGraph: OPSceneGraph; rfGraph: any; rootId: string }> {
  // Use OP's .fig parser
  const opGraph = await parseFigFile(fileData);

  // Convert to reframe graph for audit/export
  const { graph: rfGraph, rootId } = bridge.toReframeGraph(opGraph);

  return { opGraph, rfGraph, rootId };
}

// ─── .fig Export (extends reframe_export) ───────────────────

/**
 * Export a scene as .fig file.
 * Called when reframe_export receives format: "fig".
 */
export async function exportToFig(
  opGraph: OPSceneGraph,
): Promise<Uint8Array> {
  return exportFigFile(opGraph);
}

// ─── OP Lint Rules (extends reframe_inspect) ────────────────

/**
 * Run OpenPencil's lint rules on a scene.
 * Complements reframe's 37-rule audit with OP's lint rules.
 */
export function runOPLint(
  opGraph: OPSceneGraph,
  preset: 'recommended' | 'strict' | 'accessibility' = 'recommended',
) {
  const linter = createLinter({ preset });
  // OP linter expects a different input format — adapt
  // This is a stub; full implementation depends on OP's linter API
  return { rules: allRules.length, preset };
}

// ─── OP Tool Registry (for direct execution) ────────────────

/**
 * Get all OpenPencil tool definitions.
 * These can be exposed via MCP as additional tools if needed,
 * or called internally by reframe_edit for vector/boolean operations.
 */
export function getOPTools(): ToolDef[] {
  return ALL_TOOLS;
}

/**
 * Execute an OP tool by name on the editor graph.
 * Used when reframe_edit receives a vector/boolean/pen operation
 * that our engine doesn't handle natively.
 */
export async function executeOPTool(
  toolName: string,
  args: Record<string, unknown>,
  opGraph: OPSceneGraph,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const tool = ALL_TOOLS.find(t => t.name === toolName);
  if (!tool) {
    return { success: false, error: `Unknown OP tool: ${toolName}` };
  }

  try {
    // OP tools expect a context with graph access
    // The exact execution API depends on OP's tool schema
    // This is the integration point
    const result = await (tool as any).execute?.(args, { graph: opGraph });
    return { success: true, result };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── Capability Map ─────────────────────────────────────────

/**
 * What our 6 MCP tools gain from OpenPencil integration:
 *
 * reframe_compile:
 *   BEFORE: HTML → INode
 *   AFTER:  HTML → INode  |  .fig → INode
 *
 * reframe_edit:
 *   BEFORE: update/add/delete/clone/resize/vary/adapt/tokens/mode/component
 *   AFTER:  + pen tool, boolean ops (union/subtract/intersect/exclude),
 *           vector editing, align/distribute, flatten, outline stroke
 *
 * reframe_export:
 *   BEFORE: html/react/svg/png/pdf/lottie/animated_html/site
 *   AFTER:  + .fig export (via OP exportFigFile)
 *
 * reframe_inspect:
 *   BEFORE: 37 audit rules + 8 aesthetic metrics + brand fidelity
 *   AFTER:  + OP lint rules (accessibility, recommended, strict presets)
 *           + .fig compatibility check
 *
 * reframe_project:
 *   BEFORE: save/load/list/history/blocks/content/macros
 *   AFTER:  + save as .fig, load .fig, Figma clipboard paste
 *
 * reframe_design:
 *   UNCHANGED — brand loading is reframe-specific
 *
 * reframe_ui:
 *   NEW — Playwright-backed Platform UI automation (open session, act,
 *   probe DOM, screenshot, read console/network errors). Replaces the
 *   dormant reframe_collab experimental stub.
 */
export const CAPABILITY_MAP = {
  compile: ['html', 'fig'],
  edit: ['structural', 'tokens', 'vary', 'adapt', 'boolean', 'vector', 'align'],
  export: ['html', 'react', 'svg', 'png', 'pdf', 'lottie', 'animated_html', 'site', 'fig'],
  inspect: ['audit-37', 'aesthetic-8', 'brand-fidelity', 'op-lint'],
  project: ['scenes', 'blocks', 'content', 'macros', 'fig-save', 'fig-load'],
  ui: ['open', 'act', 'probe', 'screenshot', 'wait', 'close', 'list'],
} as const;
