/**
 * Inspector numeric input helpers — Phase 1 UI-5a Pins #8 + #9.
 *
 * Pure functions (no DOM, no fetch) so the contract test can exercise
 * them directly. The platform-ui bundle wires them into:
 *   - .effect-slider (range)         — debounced live-preview commit
 *   - .prop-compact-input (number)   — Cmd/Shift arrow modifiers
 *
 * Consumed via the concatenated `platform-ui.js` bundle (not imported
 * by the browser as a module) — `120-widgets.js` references the same
 * names from a sibling IIFE. To keep the bundle build deterministic,
 * a thin parallel JS copy is emitted at the same name in `ui/` and
 * the TS module is the source of truth for tests.
 */

// ─── Pin #9: applyArrowModifier ────────────────────────────────
//
// Figma muscle-memory:
//   Arrow         ±step (default 1, or field-natural step)
//   Shift+Arrow   ±0.1  (or step/10) — fine adjustment
//   Cmd+Arrow     ±10   (or step*10) — coarse adjustment
//   Shift+Cmd     ±100  (or step*100) — power user
//
// The "or step*N" branches handle fields with non-1 natural step:
//   - opacity (step 0.05) → coarse = 0.5, not 10
//   - cornerRadius (step 1) → coarse = 10
//   - corner-smoothing (step 0.05) → coarse = 0.5
// Heuristic: if `step` < 1, scale by step; otherwise use raw step.

export interface ArrowModifierInput {
  /** Current value of the input. */
  current: number;
  /** Arrow direction — 'up' or 'down'. */
  direction: 'up' | 'down';
  /** Held modifiers. `meta` is Cmd on macOS / Ctrl on Win+Linux. */
  modifiers: { shift?: boolean; meta?: boolean };
  /** Field-natural step. Defaults to 1. */
  step?: number;
}

export function applyArrowModifier(input: ArrowModifierInput): number {
  const step = input.step ?? 1;
  const sign = input.direction === 'up' ? 1 : -1;
  const shift = !!input.modifiers.shift;
  const meta = !!input.modifiers.meta;

  // Pick magnitude tier
  let mag: number;
  if (shift && meta) {
    mag = step < 1 ? step * 100 : step * 100; // ±100 in step units
  } else if (meta) {
    mag = step < 1 ? step * 10 : step * 10;   // ±10 in step units
  } else if (shift) {
    // Fine: step/10 — but with sub-1 step, drop one decade further.
    mag = step < 1 ? step / 10 : step / 10;
  } else {
    mag = step;
  }

  const next = input.current + sign * mag;
  // Clamp away floating-point dust — Figma rounds to 4 decimals on
  // display so we round to 6 internally to cover anything you might
  // multiply downstream.
  return roundTo(next, 6);
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

// ─── Pin #8: createDebouncedSliderCommit ───────────────────────
//
// Live-preview during slider drag without spamming the server with
// 60 POSTs/sec. Pattern:
//   - input event (drag) → schedule trailing-edge POST in 250ms
//   - subsequent input within 250ms cancels prior, reschedules
//   - change event (mouseup) → flush immediately (bypasses debounce)
//
// State is per-(scene, node, prop) — two separate sliders shouldn't
// cancel each other. The factory returns a controller bound to a
// single sink fn (the actual fetch wrapper).

export type SliderCommitFn = (
  sceneId: string,
  nodeId: string,
  prop: string,
  value: number,
) => void | Promise<void>;

export interface DebouncedSliderController {
  /** Drag-time call — schedules trailing POST. */
  schedule(sceneId: string, nodeId: string, prop: string, value: number): void;
  /** Mouseup / changeEnd — flushes pending immediately. */
  flush(sceneId: string, nodeId: string, prop: string, value: number): void;
  /** Number of currently-pending timers (debug + tests). */
  pendingCount(): number;
  /** Cancel all pending without firing. Used on edit-mode teardown. */
  cancelAll(): void;
}

export interface DebouncedSliderOptions {
  /** Trailing-edge delay in ms. Default 250. */
  delayMs?: number;
  /** Schedule API (defaults to setTimeout). Override for tests. */
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

export function createDebouncedSliderCommit(
  commit: SliderCommitFn,
  opts: DebouncedSliderOptions = {},
): DebouncedSliderController {
  const delay = opts.delayMs ?? 250;
  const sched = opts.scheduler ?? {
    setTimeout: (fn, ms) => (globalThis as { setTimeout: (fn: () => void, ms: number) => unknown }).setTimeout(fn, ms),
    clearTimeout: (h) => (globalThis as { clearTimeout: (h: unknown) => void }).clearTimeout(h),
  };

  // Map key: `${sceneId}::${nodeId}::${prop}` → { timer, value }
  const pending = new Map<string, { timer: unknown; value: number }>();

  const keyOf = (s: string, n: string, p: string) => s + '::' + n + '::' + p;

  const schedule: DebouncedSliderController['schedule'] = (sceneId, nodeId, prop, value) => {
    const k = keyOf(sceneId, nodeId, prop);
    const prior = pending.get(k);
    if (prior) sched.clearTimeout(prior.timer);
    const timer = sched.setTimeout(() => {
      pending.delete(k);
      void commit(sceneId, nodeId, prop, value);
    }, delay);
    pending.set(k, { timer, value });
  };

  const flush: DebouncedSliderController['flush'] = (sceneId, nodeId, prop, value) => {
    const k = keyOf(sceneId, nodeId, prop);
    const prior = pending.get(k);
    if (prior) sched.clearTimeout(prior.timer);
    pending.delete(k);
    void commit(sceneId, nodeId, prop, value);
  };

  const pendingCount = () => pending.size;

  const cancelAll = () => {
    for (const { timer } of pending.values()) sched.clearTimeout(timer);
    pending.clear();
  };

  return { schedule, flush, pendingCount, cancelAll };
}

// ─── Step heuristic for known fields ───────────────────────────
//
// Maps a property name to its natural step. Used by the platform UI
// when wiring arrow modifiers without explicit per-field config.

const FIELD_STEP_MAP: Record<string, number> = {
  opacity: 0.05,
  'corner-smoothing': 0.05,
  'letter-spacing': 0.1,
  'line-height': 0.1,
  'border-radius': 1,
  width: 1,
  height: 1,
  x: 1,
  y: 1,
  'font-size': 1,
  'padding-top': 1,
  'padding-right': 1,
  'padding-bottom': 1,
  'padding-left': 1,
  'margin-top': 1,
  'margin-right': 1,
  'margin-bottom': 1,
  'margin-left': 1,
  'gap': 1,
};

export function naturalStepForProp(prop: string): number {
  const v = FIELD_STEP_MAP[prop];
  return v !== undefined ? v : 1;
}
