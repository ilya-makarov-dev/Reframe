/**
 * Phase 7.0 — Intent Model types.
 *
 * An Intent is a multi-part structured message expressing "what the human (or
 * audit, or another agent) wants to happen next". It is NOT an edit — it's a
 * description of desired change, to be consumed by an agent that translates it
 * into concrete Operations (Phase 3).
 *
 * Design axioms:
 *
 *   1. **Multi-part.** One intent carries many parts — select + annotate +
 *      text + reference is ONE message, not four. Agents read parts together.
 *
 *   2. **Open-ended.** New part kinds can be added without breaking old
 *      intents. Consumers that don't understand a kind must skip it, not
 *      throw. The discriminated union is the contract, unknown kinds are
 *      forward-compat.
 *
 *   3. **Lifecycle.** Intents are not one-shot events. They move through
 *      states (draft → queued → processing → proposed → accepted/rejected),
 *      forming a creative-process git log orthogonal to the ops log.
 *
 *   4. **Refinable.** Rejecting or tweaking an intent creates a child intent
 *      with `parentId` pointing back — the creative tree is preserved for
 *      review and replay.
 *
 *   5. **Author-tracked.** Each intent records who created it: human (which
 *      UI), agent (which client), or audit (which rule). Needed for
 *      conflict resolution in multi-client usage.
 *
 *   6. **Dense coverage.** The part catalog below enumerates every design
 *      verb a user could plausibly invoke. Gaps mean agents can't understand
 *      an intent; overreach means serialization bloat. We aim for exhaustive
 *      but orthogonal.
 */

// ─── Targeting parts ────────────────────────────────────────

/** Explicit node selection by stable id. Most common in UI flows. */
export interface SelectPart {
  kind: 'select';
  nodes: string[];
  /** Limits the effective scope of the selection. Default: 'scene'. */
  scope?: 'scene' | 'component' | 'project';
}

/** Broad scope marker when a part like `apply-macro` should run over a
 *  whole scene / component / project rather than a specific node list. */
export interface ScopePart {
  kind: 'scope';
  value: 'scene' | 'component' | 'project' | 'selection';
  /** When scope === 'scene', the target slug. Defaults to current scene. */
  sceneId?: string;
}

/** Target by semantic role: "all buttons in the project". */
export interface RolePart {
  kind: 'role';
  role: string;
  /** Optional index when multiple matches exist and only one is wanted. */
  index?: number;
}

/** CSS-ish structured query: `button[variant=primary] in section[role=hero]`. */
export interface QueryPart {
  kind: 'query';
  selector: string;
}

/** Restrict the intent to a named viewport (mobile, tablet, desktop). */
export interface ViewportPart {
  kind: 'viewport';
  name: string;
}

// ─── Expression parts ───────────────────────────────────────

/** Natural-language description. Always accepted as a hint, even when other
 *  structured parts express the same thing — agent can use it for tiebreaking. */
export interface TextPart {
  kind: 'text';
  value: string;
}

/** Freehand / shape drawn over a preview. Coordinates are in the preview
 *  viewport space (0-1 normalized or px — see `coordSpace`). */
export interface AnnotatePart {
  kind: 'annotate';
  shape: 'arrow' | 'circle' | 'rect' | 'cross' | 'freehand' | 'underline';
  /** Ordered points defining the shape. Single point for cross, two for arrow,
   *  many for freehand. */
  points: Array<[number, number]>;
  /** Which scene/variant this annotation lives on. */
  sceneId?: string;
  /** 'normalized' → 0..1 fractions of the preview; 'px' → raw pixel coords. */
  coordSpace?: 'normalized' | 'px';
  /** Optional color for rendering the annotation (purely visual). */
  color?: string;
  /** Note attached to the shape — agent can read this as context. */
  note?: string;
}

/** Recognized gesture (e.g. swipe, pinch, stretch) — future, keeps the slot
 *  open so Phase 7.2+ tools can emit one without schema change. */
export interface GesturePart {
  kind: 'gesture';
  name: string;
  metadata?: Record<string, unknown>;
}

/** Voice clip (stored by hash) + optional transcript. Future slot. */
export interface VoicePart {
  kind: 'voice';
  hash: string;
  transcript?: string;
}

/** SVG path string drawn by the designer — "draw it like this". */
export interface PathPart {
  kind: 'path';
  svg: string;
  sceneId?: string;
}

// ─── Reference parts ────────────────────────────────────────

/** Reference image — drop from disk, clipboard, URL. */
export interface RefImagePart {
  kind: 'ref-image';
  /** Hash of stored image when reframe downloaded/persisted it. */
  hash?: string;
  /** Remote URL when image lives elsewhere. */
  url?: string;
  /** What the human wants the agent to pick up from the reference. */
  description?: string;
}

/** Reference a URL (website). Agent can fetch and inspect. */
export interface RefUrlPart {
  kind: 'ref-url';
  url: string;
  description?: string;
}

/** Reference an existing node as a style donor. */
export interface RefNodePart {
  kind: 'ref-node';
  nodeId: string;
  sceneId?: string;
  /** What aspect to transfer: style / layout / text / everything. */
  aspect?: 'style' | 'layout' | 'text' | 'all';
  description?: string;
}

/** Reference an existing component master. */
export interface RefComponentPart {
  kind: 'ref-component';
  componentName: string;
  description?: string;
}

/** Reference a registered brand — apply its tokens. */
export interface RefBrandPart {
  kind: 'ref-brand';
  brand: string;
}

/** Reference a specific point in the ops history. Used for branching. */
export interface RefHistoryPart {
  kind: 'ref-history';
  opId: string;
  action?: 'branch' | 'cherry-pick' | 'compare';
}

/** Reference a named macro. Simpler alias for `apply-macro` when the intent
 *  is "just run this macro, no extra context needed". */
export interface RefMacroPart {
  kind: 'ref-macro';
  macro: string;
}

// ─── Modifier parts ─────────────────────────────────────────

/** Direction hint — bolder, smaller, brighter, etc. */
export interface DirectionPart {
  kind: 'direction';
  value:
    | 'up' | 'down' | 'left' | 'right'
    | 'larger' | 'smaller'
    | 'tighter' | 'looser'
    | 'bolder' | 'subtler'
    | 'brighter' | 'darker'
    | 'faster' | 'slower'
    | 'warmer' | 'cooler';
}

/** How much — agent interprets against current scene. */
export interface DegreePart {
  kind: 'degree';
  value: 'subtle' | 'moderate' | 'dramatic' | 'extreme';
}

/** Things the agent MUST NOT change. */
export interface PreservePart {
  kind: 'preserve';
  keys: string[];
}

/** Rules the agent MUST NOT violate. */
export interface AvoidPart {
  kind: 'avoid';
  rule: string;
  value?: unknown;
}

/** How important this intent is. */
export interface PriorityPart {
  kind: 'priority';
  value: 'must' | 'should' | 'nice';
}

// ─── Transform parts ────────────────────────────────────────

/** Spatial move. `delta` for relative, `destination` for anchored moves. */
export interface MovePart {
  kind: 'move';
  delta?: { dx: number; dy: number };
  destination?: {
    /** Place target before this sibling id. */
    before?: string;
    /** Place target after this sibling id. */
    after?: string;
    /** Move target INTO this parent. */
    into?: string;
  };
}

/** Resize. `mode` decides how `value` is interpreted. */
export interface ResizePart {
  kind: 'resize';
  axis: 'width' | 'height' | 'both';
  mode: 'delta' | 'factor' | 'absolute';
  value: number;
}

/** Duplicate N times in a spatial pattern. */
export interface DuplicatePart {
  kind: 'duplicate';
  count: number;
  direction?: 'row' | 'column' | 'grid';
}

/** Swap two targets. */
export interface SwapPart {
  kind: 'swap';
  targets: [string, string];
}

/** Remove a target (cascade rule decided by agent). */
export interface RemovePart {
  kind: 'remove';
}

/** Group targets under a new container. */
export interface GroupPart {
  kind: 'group';
  newName?: string;
}

/** Ungroup a container. */
export interface UngroupPart {
  kind: 'ungroup';
}

/** Reparent target under a new parent. */
export interface ReparentPart {
  kind: 'reparent';
  newParent: string;
}

/** Change sibling index. */
export interface ReorderPart {
  kind: 'reorder';
  newIndex: number;
}

// ─── Semantic parts ─────────────────────────────────────────

/** Extract target subtree as a component master. */
export interface ExtractComponentPart {
  kind: 'extract-component';
  name: string;
}

/** Instantiate a component under a parent. */
export interface InstantiatePart {
  kind: 'instantiate';
  componentName: string;
  overrides?: Record<string, Record<string, unknown>>;
}

/** Apply a macro. */
export interface ApplyMacroPart {
  kind: 'apply-macro';
  macro: string;
}

/** Apply a variant (responsive adaptation) to a target. */
export interface ApplyVariantPart {
  kind: 'apply-variant';
  variant: string;
}

/** Ask agent to fix a specific audit issue. */
export interface FixAuditPart {
  kind: 'fix-audit';
  rule: string;
}

/** Bind a node property to a DS token. */
export interface BindTokenPart {
  kind: 'bind-token';
  property: 'fill' | 'stroke' | 'fontSize' | 'fontFamily' | 'cornerRadius';
  role: string;
}

/** Unbind a previously bound property. */
export interface UnbindTokenPart {
  kind: 'unbind-token';
  property: 'fill' | 'stroke' | 'fontSize' | 'fontFamily' | 'cornerRadius';
}

// ─── Style parts ────────────────────────────────────────────

/** Generic color modifier — property + value OR property + role. */
export interface ColorPart {
  kind: 'color';
  property: string;
  value?: string;
  role?: string;
}

/** Typography modifier. */
export interface TypographyPart {
  kind: 'typography';
  property: string;
  value?: unknown;
  role?: string;
}

/** Spacing modifier. */
export interface SpacingPart {
  kind: 'spacing';
  property: string;
  value: number;
}

/** Shadow modifier — level index or custom. */
export interface ShadowPart {
  kind: 'shadow';
  level?: number;
  value?: unknown;
}

/** Corner radius modifier. */
export interface RadiusPart {
  kind: 'radius';
  value?: number;
  scaleIndex?: number;
}

// ─── Constraint parts ───────────────────────────────────────

/** Attach an invariant to a node or scope — agent must honor it in all
 *  future ops. Persists across re-compiles via meta. */
export interface ConstraintPart {
  kind: 'constraint';
  rule: string;
  value?: unknown;
}

// ─── Control parts ──────────────────────────────────────────

/** Temporal undo — rewind N steps in ops history. */
export interface UndoPart {
  kind: 'undo';
  steps: number;
}

/** Temporal redo — replay N steps forward. */
export interface RedoPart {
  kind: 'redo';
  steps: number;
}

/** Branch from a historical op point. */
export interface BranchPart {
  kind: 'branch';
  from: string;
}

/** Compare two states (A/B). */
export interface ComparePart {
  kind: 'compare';
  against: string;
}

/** Ask agent to generate N exploration variants. */
export interface ExplorePart {
  kind: 'explore';
  count: number;
  dimension?: 'aesthetic' | 'layout' | 'typography' | 'color' | 'all';
}

/** Save the current intent parts as a named template. */
export interface SaveTemplatePart {
  kind: 'save-template';
  name: string;
  description?: string;
}

// ─── Union ──────────────────────────────────────────────────

export type IntentPart =
  | SelectPart | ScopePart | RolePart | QueryPart | ViewportPart
  | TextPart | AnnotatePart | GesturePart | VoicePart | PathPart
  | RefImagePart | RefUrlPart | RefNodePart | RefComponentPart
  | RefBrandPart | RefHistoryPart | RefMacroPart
  | DirectionPart | DegreePart | PreservePart | AvoidPart | PriorityPart
  | MovePart | ResizePart | DuplicatePart | SwapPart | RemovePart
  | GroupPart | UngroupPart | ReparentPart | ReorderPart
  | ExtractComponentPart | InstantiatePart | ApplyMacroPart | ApplyVariantPart
  | FixAuditPart | BindTokenPart | UnbindTokenPart
  | ColorPart | TypographyPart | SpacingPart | ShadowPart | RadiusPart
  | ConstraintPart
  | UndoPart | RedoPart | BranchPart | ComparePart | ExplorePart | SaveTemplatePart;

/** All known part kinds. Used for validation at commit time. */
export const KNOWN_PART_KINDS = new Set<IntentPart['kind']>([
  'select', 'scope', 'role', 'query', 'viewport',
  'text', 'annotate', 'gesture', 'voice', 'path',
  'ref-image', 'ref-url', 'ref-node', 'ref-component', 'ref-brand', 'ref-history', 'ref-macro',
  'direction', 'degree', 'preserve', 'avoid', 'priority',
  'move', 'resize', 'duplicate', 'swap', 'remove', 'group', 'ungroup', 'reparent', 'reorder',
  'extract-component', 'instantiate', 'apply-macro', 'apply-variant',
  'fix-audit', 'bind-token', 'unbind-token',
  'color', 'typography', 'spacing', 'shadow', 'radius',
  'constraint',
  'undo', 'redo', 'branch', 'compare', 'explore', 'save-template',
]);

// ─── Lifecycle ──────────────────────────────────────────────

/**
 * Intent lifecycle states. Transitions:
 *
 *   draft ──commit──▶ queued ──startProcessing──▶ processing ──proposeOps──▶ proposed
 *                                    │                              │
 *                                    │                              ├─accept──▶ accepted ─▶ archived
 *                                    │                              └─reject──▶ rejected ─▶ archived
 *                                    │
 *                                    └─(refine at any time)──▶ spawns child intent (parent → refined)
 *
 *   archived = terminal, intent removed from active queue but persisted in log
 */
export type IntentStatus =
  | 'draft'       // user is editing parts, not committed
  | 'queued'      // committed, waiting for agent
  | 'processing'  // agent is working on it
  | 'proposed'    // agent returned ops, waiting for human approval
  | 'accepted'    // ops applied
  | 'rejected'    // ops discarded
  | 'refined'     // superseded by a child intent
  | 'archived';   // moved out of active set

/** All valid `from → to` status transitions. Enforced at runtime. */
export const VALID_TRANSITIONS: Record<IntentStatus, IntentStatus[]> = {
  draft:      ['queued', 'archived'],
  queued:     ['processing', 'refined', 'archived'],
  processing: ['proposed', 'rejected', 'refined'],
  proposed:   ['accepted', 'rejected', 'refined'],
  accepted:   ['archived'],
  rejected:   ['archived'],
  refined:    ['archived'],
  archived:   [],
};

// ─── Intent ─────────────────────────────────────────────────

export interface Intent {
  /** Stable id. Format: `i-<timestamp36>-<counter36>`. */
  id: string;
  /** ISO timestamp of first save. */
  createdAt: string;
  /** ISO timestamp of last status/parts change. */
  updatedAt: string;
  /** Who created this intent. */
  author: IntentAuthor;
  /** Current lifecycle state. */
  status: IntentStatus;
  /** Parts making up the message. Order matters for some kinds (annotate
   *  points precede text for spatial context). */
  parts: IntentPart[];
  /** When this intent is a refinement, links back to the parent. */
  parentId?: string;
  /** Optional human label / title for the intent (shown in Queue UI). */
  label?: string;
  /** Scene slug this intent is primarily about (used for queue filtering). */
  sceneSlug?: string;

  // ── Phase 8: Thread model ──────────────────
  /** Primary anchor this intent targets. Usually an INode id; can be
   *  scene/project/region level. Used to group intents into conversation
   *  threads with annotations on the same anchor. Optional for legacy
   *  intents that don't target a specific node. */
  anchor?: string;
  /** Thread this intent belongs to. When set, the intent shares a
   *  conversation with other intents + annotations on the same anchor.
   *  Optional for legacy intents. */
  threadId?: string;

  // ── Lifecycle metadata ─────────────────────
  /** When the intent moved to `processing`. */
  processingStartedAt?: string;
  /** Which agent picked it up (session id / tool name). */
  processingBy?: string;
  /** Op ids the agent proposed while working on this intent. */
  proposedOpIds?: string[];
  /** Op ids that were accepted and merged into history. */
  acceptedOpIds?: string[];
  /** Human reason for rejection (optional). */
  rejectedReason?: string;
  /** Id of the child intent when this one is refined. */
  refinedIntoId?: string;
}

export interface IntentAuthor {
  /** High-level category. */
  kind: 'human' | 'agent' | 'audit' | 'macro' | 'template';
  /** Free-text id — session id, agent name, audit rule, template slug. */
  id?: string;
  /** Display name for UI. */
  label?: string;
}

// ─── Templates ──────────────────────────────────────────────

/**
 * A template is a re-usable set of intent parts. Applying a template creates
 * a new DRAFT intent pre-filled with those parts — user can tweak before
 * committing.
 *
 * Templates operate at intent level (one abstraction above macros which
 * operate at ops level). Template → creates intent → agent turns into ops →
 * ops may include macro applications → macro expands to concrete ops.
 */
export interface IntentTemplate {
  name: string;
  slug: string;
  description?: string;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Bumped on re-save. */
  revision: number;
  /** The parts blueprint. Cloned on apply. */
  parts: IntentPart[];
  /** Tags for filtering. */
  tags?: string[];
}

/** Result of committing / applying / accepting / rejecting an intent — used
 *  by the MCP tool and live UI to surface outcomes. */
export interface IntentActionResult {
  ok: boolean;
  intentId?: string;
  status?: IntentStatus;
  error?: string;
  warnings?: string[];
}
