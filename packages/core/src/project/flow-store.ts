/**
 * Flow persistence — `.reframe/flows/<flowId>/` directory.
 *
 * Each flow is a first-class entity on disk, not an ephemeral URL query
 * list. Two files per flow:
 *
 *   flow.json   — the spec: stepSceneIds (references to compiled scenes
 *                 in the project), transitions, metadata. Written once at
 *                 flow compile time, read on mount to rebuild composition.
 *
 *   state.json  — live cross-step user data + navigation position. Shape
 *                 is FlowState from engine/composition.ts. Written on
 *                 every step transition + every flow-author data write.
 *                 Restored on mount so a refresh or reopen continues from
 *                 the last visited step.
 *
 * Why on disk and not in SceneGraph: flow state is app-level (form
 * inputs, conditional flags, visited-step history) — owned by the flow
 * author's application model, NOT by the design engine's edit history.
 * Ctrl+Z on a scene doesn't undo flow-state mutations; that's the
 * boundary between scene editing and flow authoring.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FlowTransition, FlowState } from '../engine/composition.js';

// ─── Paths ───────────────────────────────────────────────────

function flowsRoot(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'flows');
}

function flowDir(projectDir: string, flowId: string): string {
  return path.join(flowsRoot(projectDir), sanitizeId(flowId));
}

export function flowSpecPath(projectDir: string, flowId: string): string {
  return path.join(flowDir(projectDir, flowId), 'flow.json');
}

export function flowStatePath(projectDir: string, flowId: string): string {
  return path.join(flowDir(projectDir, flowId), 'state.json');
}

function sanitizeId(id: string): string {
  return id.replace(/[\\/\0]/g, '_');
}

// ─── Spec (flow.json) ────────────────────────────────────────

export interface FlowSpec {
  /** Stable id; matches the directory name. */
  flowId: string;
  /** Optional human-readable label. */
  name?: string;
  /**
   * Scene slugs for each step in order. These reference existing scenes
   * in the project (compiled separately via reframe_compile per scene,
   * OR created in batch by handleFlowCompile). The flow is a view; it
   * does not own the scenes — they live under `.reframe/scenes/<slug>.scene.json`
   * like any other project scene and can be edited independently.
   */
  stepSceneIds: string[];
  /**
   * Transition graph. Phase 0: linear — transitions are (from, to, label)
   * triples, every transition evaluates to true. The `condition` field
   * is reserved for future conditional-flow implementation.
   */
  transitions: FlowTransition[];
  createdAt: string;
  updatedAt: string;
}

export function readFlowSpec(projectDir: string, flowId: string): FlowSpec | null {
  const p = flowSpecPath(projectDir, flowId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as FlowSpec;
  } catch (err) {
    console.warn(`[flow-store] failed to parse ${p}:`, err);
    return null;
  }
}

export function writeFlowSpec(projectDir: string, spec: FlowSpec): void {
  const dir = flowDir(projectDir, spec.flowId);
  fs.mkdirSync(dir, { recursive: true });
  const nextSpec: FlowSpec = { ...spec, updatedAt: new Date().toISOString() };
  fs.writeFileSync(flowSpecPath(projectDir, spec.flowId), JSON.stringify(nextSpec, null, 2), 'utf-8');
}

export function listFlows(projectDir: string): string[] {
  const root = flowsRoot(projectDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((name) => {
    const specFile = path.join(root, name, 'flow.json');
    return fs.existsSync(specFile);
  });
}

// ─── State (state.json) ──────────────────────────────────────

/**
 * Read flow state, or synthesize an initial state at step 0 with empty
 * data when the file is missing (new flow, never navigated yet). Callers
 * get a non-null FlowState they can mutate.
 */
export function readFlowState(projectDir: string, flowId: string): FlowState {
  const p = flowStatePath(projectDir, flowId);
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as FlowState;
    } catch (err) {
      console.warn(`[flow-store] state parse failed for ${p}, re-initializing:`, err);
    }
  }
  return {
    flowId,
    currentStep: 0,
    data: {},
    visitedSteps: [0],
    updatedAt: new Date().toISOString(),
  };
}

export function writeFlowState(projectDir: string, state: FlowState): void {
  const dir = flowDir(projectDir, state.flowId);
  fs.mkdirSync(dir, { recursive: true });
  const nextState: FlowState = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(flowStatePath(projectDir, state.flowId), JSON.stringify(nextState, null, 2), 'utf-8');
}

/**
 * Atomic step transition: moves state to targetStep, appends to visited
 * if new, persists. Transition rules (condition evaluation) are the
 * caller's concern — Phase 0 accepts any transition the caller asserts
 * is valid. Returns the new state.
 */
export function transitionTo(projectDir: string, flowId: string, targetStep: number): FlowState {
  const state = readFlowState(projectDir, flowId);
  state.currentStep = targetStep;
  if (!state.visitedSteps.includes(targetStep)) state.visitedSteps.push(targetStep);
  writeFlowState(projectDir, state);
  return state;
}

export function deleteFlow(projectDir: string, flowId: string): boolean {
  const dir = flowDir(projectDir, flowId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
