/**
 * Phase 8 — Gesture vocabulary.
 *
 * A Gesture is a typed representation of what a user DID on the preview
 * surface. Gestures are captured by a UI client (Platform web UI, VS Code
 * plugin, CLI, future clients) and translated into domain objects
 * (Annotations + Intents + Threads) by `translate.ts`.
 *
 * Gestures are pure data — no side effects, no DOM references, no client
 * state. This lets the translator run in any environment (browser, Node,
 * edge worker) and produces the same results.
 *
 * The vocabulary below consists of 8 semantic verbs (Ask, Echo, Pin,
 * Rule, Drag, Resonance, Lasso, Brush) plus two ambient gestures
 * (Hover and Select) that are captured but don't produce persistent
 * state. Each verb carries intent at gesture time, not post-hoc.
 *
 * Design axioms:
 *
 *   1. **Semantic anchors, not pixels.** Every gesture references anchors
 *      (INode ids) — not coordinates. The UI captures a pointer event,
 *      maps it to a DOM node via the injected preview script, resolves
 *      that node to an INode id, and emits the gesture with the id.
 *
 *   2. **Intent is captured at gesture time, not inferred later.** The UI
 *      decides up front "this drag is semantic (drop-into)" vs "this drag
 *      is pixel delta" — the gesture captures which. No post-hoc guessing.
 *
 *   3. **Composable translator.** `translate.ts` produces a uniform result
 *      shape so that different surfaces (annotation + intent + thread)
 *      can be created in a single transaction.
 */

// ─── Common fields ──────────────────────────────────────────

export interface GestureBase {
  /** ISO timestamp of the gesture. */
  at: string;
  /** Scene slug the gesture happened on. */
  sceneSlug: string;
  /** Who performed the gesture. */
  author: { kind: 'human' | 'agent'; id?: string };
}

// ─── Ambient (captured but don't produce persistent state) ─

/** Hover — transient outline highlight. Translated to null. */
export interface HoverGesture extends GestureBase {
  kind: 'hover';
  anchor: string;
}

/** Select — ephemeral selection state. Translated to null. */
export interface SelectGesture extends GestureBase {
  kind: 'select';
  anchors: string[];
}

// ─── The 8 real verbs ───────────────────────────────────────

/** Ask — comment tethered to an anchor. Produces a comment annotation
 *  and an `ask` intent (select + text). */
export interface AskGesture extends GestureBase {
  kind: 'ask';
  anchor: string;
  text: string;
}

/** Drag — semantic move. Destination can be pixel-delta or semantic
 *  (before / after / into a target node). Prefer semantic when the UI
 *  can compute it from hover tracking. */
export interface DragGesture extends GestureBase {
  kind: 'drag';
  anchor: string;
  destination:
    | { kind: 'before'; anchor: string }
    | { kind: 'after'; anchor: string }
    | { kind: 'into'; anchor: string }
    | { kind: 'delta'; dx: number; dy: number };
}

/** Lasso — freeform region selection. UI computes which anchors the
 *  lasso path contains and the common ancestor of those anchors. */
export interface LassoGesture extends GestureBase {
  kind: 'lasso';
  /** Normalized 0..1 coordinates relative to the viewport frame. */
  points: Array<[number, number]>;
  /** Anchors the UI computed as being inside the lasso region. */
  containedAnchors: string[];
  /** Common ancestor of the contained anchors, if any. */
  ancestor?: string;
}

/** Brush — paint-with-macro. Collects anchors hit during the stroke. */
export interface BrushGesture extends GestureBase {
  kind: 'brush';
  /** Anchors the brush passed over, in stroke order. */
  anchors: string[];
  /** Which macro to apply to each anchor. */
  macro: string;
}

/** Resonance — semantic-similar query from a seed node. The UI runs the
 *  match against the live DOM (we have it — snip does not) and includes
 *  the matched anchors in the gesture. */
export interface ResonanceGesture extends GestureBase {
  kind: 'resonance';
  /** The node the user clicked on. */
  seed: string;
  /** Which axes of similarity to consider. */
  axes: Array<'tag' | 'class' | 'style' | 'role' | 'content' | 'position'>;
  /** Anchors the UI matched against `seed` along the requested axes. */
  matches: string[];
}

/** Echo — directional arrow from source to target with semantic mapping.
 *  The axis is chosen by the user in a two-step gesture: draw the arrow,
 *  then pick the axis from a small inline menu. */
export interface EchoGesture extends GestureBase {
  kind: 'echo';
  /** Source anchor — the donor. */
  fromAnchor: string;
  /** Target anchor — the recipient. */
  toAnchor: string;
  axis: 'visual-style' | 'structure' | 'role' | 'all';
  /** Optional modifier ("reverse", "invert", etc). */
  modifier?: string;
}

/** Pin — attach a reference to an anchor. Reference can be an image, a
 *  URL, a brand, or another node. Produces a `reference` annotation and
 *  an intent carrying the appropriate ref-* part. */
export interface PinGesture extends GestureBase {
  kind: 'pin';
  anchor: string;
  reference:
    | { type: 'image'; url?: string; hash?: string }
    | { type: 'url'; url: string }
    | { type: 'brand'; brand: string }
    | { type: 'node'; anchor: string; aspect?: 'style' | 'structure' | 'all' };
  note?: string;
}

/** Rule — attach a constraint to an anchor. When `enforced === true`, the
 *  rule is a standing guardrail — no one-shot intent is emitted; the
 *  audit system reads active rule annotations and enforces them. When
 *  `enforced === false`, the rule doubles as a one-shot nudge to the
 *  next proposal. */
export interface RuleGesture extends GestureBase {
  kind: 'rule';
  anchor: string;
  rule: string;
  value?: unknown;
  enforced: boolean;
}

/** Time scrub — scrub to an op in history. Does not produce an annotation;
 *  produces a control intent (branch / cherry-pick / compare). */
export interface TimeScrubGesture extends GestureBase {
  kind: 'time-scrub';
  opId: string;
  action: 'branch' | 'cherry-pick' | 'compare' | 'revive';
}

// ─── Union ──────────────────────────────────────────────────

export type Gesture =
  | HoverGesture
  | SelectGesture
  | AskGesture
  | DragGesture
  | LassoGesture
  | BrushGesture
  | ResonanceGesture
  | EchoGesture
  | PinGesture
  | RuleGesture
  | TimeScrubGesture;

export const KNOWN_GESTURE_KINDS = new Set<Gesture['kind']>([
  'hover', 'select',
  'ask', 'drag', 'lasso', 'brush', 'resonance', 'echo', 'pin', 'rule', 'time-scrub',
]);
