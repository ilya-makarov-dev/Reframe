/**
 * Phase 8 — Annotation model.
 *
 * An Annotation is a persistent visual marker attached to a scene-graph
 * anchor. Unlike an Intent (which is a message the agent will process),
 * an Annotation is a **visible thing on the preview surface** that:
 *
 *   - Is authored by either a human (drawing on the preview) or an agent
 *     (rendering a proposal as a ghost).
 *   - Is anchored to an INode id (or scene / region / project) — the same
 *     stable id the rest of the engine operates on.
 *   - Belongs to a Thread. A thread groups annotations + intents on the
 *     same anchor into a conversation.
 *   - Has a lifecycle: active → orphaned when its anchor vanishes, →
 *     resolved when the thread closes, → dismissed when the user removes.
 *
 * The discriminated payload covers every annotation kind the 8 tools
 * (Ask / Drag / Lasso / Brush / Resonance / Pin / Constraint / Time)
 * need to express. New kinds can be added without breaking old data —
 * readers that don't know a kind skip it.
 *
 * Relationship with Intents:
 *
 *   - A human drawing an "Ask" comment creates BOTH an annotation
 *     (visible marker) AND an intent (message to agent). They share a
 *     thread and an anchor.
 *   - A human dropping a Pin creates only an annotation (persistent
 *     reference), no intent (the agent doesn't need to act yet).
 *   - An agent proposing a change creates a "ghost-proposal" annotation
 *     on the preview so the human sees the proposal in place, linked to
 *     the intent that proposed it.
 *
 * Annotations are the **substrate of visual communication** between
 * human and agent — the thing both sides can draw on.
 */

export type AnnotationId = string;

export type AnnotationAuthor =
  | { kind: 'human'; id?: string }
  | { kind: 'agent'; id?: string }
  | { kind: 'system'; id?: string };

export type AnnotationStatus =
  | 'active'     // visible on the preview, live
  | 'orphaned'   // anchor node gone; awaiting user re-anchor or dismiss
  | 'resolved'   // thread closed, annotation retained for history
  | 'dismissed'; // user explicitly removed

export const VALID_ANNOTATION_TRANSITIONS: Record<AnnotationStatus, AnnotationStatus[]> = {
  active:    ['orphaned', 'resolved', 'dismissed'],
  orphaned:  ['active', 'dismissed'],
  resolved:  ['active', 'dismissed'],
  dismissed: [],
};

// ─── Payload discriminators — what the annotation IS ─────────

/** Ask — a comment tethered to an anchor. Persists as a pin + text bubble
 *  on the preview. Replies live as linked intents in the same thread. */
export interface CommentPayload {
  kind: 'comment';
  text: string;
}

/** Pin — a marker at a point. Used when the user wants to "bookmark" a
 *  node without saying anything in particular — a visible "I care about
 *  this" flag. */
export interface PinPayload {
  kind: 'pin';
  /** Visual style token for the pin marker. */
  style?: 'default' | 'question' | 'todo' | 'warn';
  note?: string;
}

/** Echo — a directional arrow from source to target, semantic mapping. */
export interface EchoArrowPayload {
  kind: 'echo-arrow';
  /** Source anchor — the donor. */
  fromAnchor: string;
  /** Target anchor — the recipient. (Same as the owning annotation's
   *  `anchor` field.) */
  toAnchor: string;
  /** Which aspect of the donor to transfer. */
  axis: 'visual-style' | 'structure' | 'role' | 'all';
  /** Optional modifier: "reverse", "invert", "brighter", etc. */
  note?: string;
}

/** Region — a bounded area containing multiple nodes. Result of lasso. */
export interface RegionPayload {
  kind: 'region';
  /** INode ids contained in the region. */
  anchors: string[];
  /** Common ancestor of the contained anchors (computed by UI). */
  ancestor?: string;
  shape: 'rect' | 'freehand';
  /** Normalized 0..1 coordinates relative to the viewport frame, used for
   *  rendering the region outline on the preview. */
  points: Array<[number, number]>;
}

/** Brush stroke — a sequence of anchors painted with a macro. */
export interface BrushStrokePayload {
  kind: 'brush-stroke';
  anchors: string[];
  macro: string;
}

/** Reference — a pinned external reference attached to an anchor. */
export interface ReferencePayload {
  kind: 'reference';
  source:
    | { type: 'image'; url?: string; hash?: string }
    | { type: 'url'; url: string }
    | { type: 'brand'; brand: string }
    | { type: 'node'; anchor: string; aspect?: 'style' | 'structure' | 'all' };
  note?: string;
}

/** Rule — a standing constraint on the anchor. Persists; may be enforced
 *  by the audit system as a custom rule. */
export interface RulePayload {
  kind: 'rule';
  rule: string;
  value?: unknown;
  /** When true, the audit surfaces violations of this rule as findings.
   *  When false, the rule is a one-shot nudge for the next proposal. */
  enforced: boolean;
}

/** Ghost proposal — agent-side annotation showing a proposed change
 *  before acceptance. The human sees a "what it would look like" marker
 *  on the preview, linked to the intent that proposed it. */
export interface GhostProposalPayload {
  kind: 'ghost-proposal';
  /** Intent id this ghost represents. */
  intentId: string;
  /** Short human-readable summary of the proposed change. */
  summary: string;
  /** Optional opaque before/after snapshot references. Kept for agents
   *  that want to ship arbitrary diff hashes without touching the
   *  typed shape below. */
  before?: string;
  after?: string;
  /** Typed list of atomic changes the proposal will apply. When present,
   *  the Platform UI renders an inline visual diff (color swatches, move
   *  vector, before/after geometry) directly on the preview surface
   *  instead of a text summary. Each change is discriminated by `kind`
   *  and the renderer picks the visualization. */
  changes?: DiffChange[];
}

/** A single atomic change inside a ghost proposal. The renderer produces
 *  a visual artifact per kind (swatch pair, arrow, outlined rect, etc).
 *  New kinds can be added — unknown kinds are rendered as plain text
 *  chips for forward compatibility. */
export type DiffChange =
  | DiffColorChange
  | DiffMoveChange
  | DiffResizeChange
  | DiffTextChange
  | DiffStyleChange
  | DiffReplaceChange;

/** Color change on a property (background, color, border, shadow, …). */
export interface DiffColorChange {
  kind: 'color';
  /** CSS property name or semantic role ("background", "text", "border"). */
  property: string;
  /** CSS hex / rgba / var reference for the current value. */
  from: string;
  /** Target value. */
  to: string;
}

/** Spatial move — from old origin to new origin (iframe-doc coords). */
export interface DiffMoveChange {
  kind: 'move';
  from: { x: number; y: number };
  to:   { x: number; y: number };
}

/** Resize — from old dimensions to new dimensions. */
export interface DiffResizeChange {
  kind: 'resize';
  from: { w: number; h: number };
  to:   { w: number; h: number };
}

/** Text content change — rendered as from-strikethrough + to-bold. */
export interface DiffTextChange {
  kind: 'text';
  from: string;
  to: string;
}

/** Generic style change for properties that aren't colors. */
export interface DiffStyleChange {
  kind: 'style';
  property: string;
  from: string;
  to: string;
}

/** Opaque replace — when no structured diff is available. Renders as
 *  a plain summary chip. */
export interface DiffReplaceChange {
  kind: 'replace';
  summary: string;
}

/** Resonance overlay — agent or UI result highlighting matched nodes. */
export interface ResonanceOverlayPayload {
  kind: 'resonance-overlay';
  seed: string;
  axes: Array<'tag' | 'class' | 'style' | 'role' | 'content' | 'position'>;
  matches: string[];
}

/** Free-vector — designer-drawn polyline that floats above the scene. Unlike
 *  every other annotation kind, it has no semantic anchor — it lives in
 *  viewport (or scene-relative) coordinate space and persists as part of the
 *  scene. Phase 2 Brief 2b. */
export interface FreeVectorPayload {
  kind: 'free-vector';
  /** Polyline points in iframe-doc coordinate space (matches the SVG overlay's
   *  viewBox so a redraw at any zoom places strokes correctly). */
  points: Array<{ x: number; y: number }>;
  /** CSS hex / rgba stroke color. Default = brand accent at draw time. */
  stroke: string;
  /** Stroke width in px. */
  width: number;
  /** Opacity 0..1. */
  opacity: number;
  /** When true, points are rendered through a Catmull-Rom interpolation
   *  emitting cubic-bezier path commands. When false, the path is a plain
   *  polyline (M + L commands only). */
  smooth: boolean;
}

export type AnnotationPayload =
  | CommentPayload
  | PinPayload
  | EchoArrowPayload
  | RegionPayload
  | BrushStrokePayload
  | ReferencePayload
  | RulePayload
  | GhostProposalPayload
  | ResonanceOverlayPayload
  | FreeVectorPayload;

export const KNOWN_ANNOTATION_KINDS = new Set<AnnotationPayload['kind']>([
  'comment', 'pin', 'echo-arrow', 'region', 'brush-stroke',
  'reference', 'rule', 'ghost-proposal', 'resonance-overlay',
  'free-vector',
]);

// ─── The Annotation itself ──────────────────────────────────

export interface Annotation {
  /** Stable id. Format: `a-<ts36>-<counter36>`. */
  id: AnnotationId;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last change. */
  updatedAt: string;

  author: AnnotationAuthor;
  status: AnnotationStatus;

  /** What this annotation is attached to. Usually an INode id; can be
   *  "scene:<slug>", "region:<hash>", or "project". */
  anchor: string;
  /** Scene slug the annotation lives on, for filtering. Redundant with
   *  anchor when anchor is "scene:<slug>". */
  sceneSlug?: string;

  /** Thread this annotation belongs to. Every annotation has a thread —
   *  multiple annotations on the same anchor share a thread. */
  threadId: string;

  /** Discriminated payload — what the annotation IS. */
  payload: AnnotationPayload;

  /** When status === 'orphaned', ISO timestamp of the orphaning event. */
  orphanedAt?: string;
  /** Optional context for the orphaning — "anchor node removed in op xyz". */
  orphanedReason?: string;
}

/** Result of an annotation-level action. Returned by lifecycle functions. */
export interface AnnotationActionResult {
  ok: boolean;
  annotationId?: AnnotationId;
  status?: AnnotationStatus;
  error?: string;
}
