/**
 * Operation types — first-class, replayable design mutations.
 *
 * Phase 3 centerpiece: every edit to a compiled scene is expressed as one of
 * these operations, appended to a per-scene JSONL history, and **replayed on
 * re-compile**. Combined with Phase 1 stable ids, this turns reframe from a
 * one-shot compiler into a programmable design runtime — the agent can keep
 * refining a scene over many iterations without losing intermediate edits
 * each time the source HTML is re-imported.
 *
 * Ops target nodes by stable id (`h:<hash>`), produced by the Phase 1 HTML
 * importer. When a replay hits an id that no longer exists (because the
 * source HTML removed that subtree), the op is a silent no-op with a
 * recorded warning — intentional graceful degradation rather than a throw.
 */

// ─── Base ────────────────────────────────────────────────────

export interface OperationBase {
  /** Unique op id. Defaults to `${timestamp}-${counter}` when created by appendOp. */
  id: string;
  /** ISO timestamp — recorded at append time, not replay time. */
  timestamp: string;
  /** Optional human-readable label surfaced in history listings / undo UI. */
  label?: string;
}

// ─── Concrete operations ────────────────────────────────────

/**
 * Set properties on a single node. This is the replay-friendly analogue of
 * `reframe_edit({op: 'update', path, props})` — difference is that the target
 * is a stable node id, not a mutable name path.
 */
export interface SetPropsOp extends OperationBase {
  type: 'setProps';
  nodeId: string;
  props: Record<string, unknown>;
}

/**
 * Explicitly bind a single node property to a design token. Idempotent: replay
 * overwrites any previous binding. This op is the manual lever — agents or
 * humans can pin `fills[0]` of a specific CTA to `primary` regardless of color
 * drift in the source HTML.
 */
export interface BindTokenOp extends OperationBase {
  type: 'bindToken';
  nodeId: string;
  /** Which property to bind. One of: fill | stroke | fontSize | fontFamily | cornerRadius. */
  property: 'fill' | 'stroke' | 'fontSize' | 'fontFamily' | 'cornerRadius';
  /** Token name — e.g. "primary", "hero", "heading", "accent". Resolved at apply time against the active DesignSystem. */
  token: string;
}

/**
 * Scan the scene (or a subtree) and bind every node's fill/stroke/fontSize/
 * fontFamily to the nearest design token within tolerance. Runs as a single
 * op so it's cheap to replay after re-compile — one entry in history instead
 * of hundreds of individual bindToken ops.
 *
 * This is where the "change a token, re-skin the project" magic comes from:
 * once nodes have `meta.tokenBindings` populated, exporters can emit CSS vars
 * and a single token edit propagates everywhere.
 */
export interface AutoBindTokensOp extends OperationBase {
  type: 'autoBindTokens';
  /** Optional subtree root — defaults to scene rootId. */
  rootId?: string;
  /** Euclidean RGB distance tolerance (0-441). Default 30. */
  colorTolerance?: number;
  /** Font size absolute tolerance in px. Default 2. */
  fontSizeTolerance?: number;
}

/**
 * Attach an interaction state (hover / active / focus / disabled) to a node.
 * Replay-safe: replacing an existing state, not deep-merging, so the op is
 * idempotent and ordering-insensitive for the same (nodeId, state) pair.
 */
export interface AddStateOp extends OperationBase {
  type: 'addState';
  nodeId: string;
  state: 'hover' | 'active' | 'focus' | 'disabled' | 'selected' | 'loading';
  props: Record<string, unknown>;
}

/**
 * Attach a responsive breakpoint override. Complements `addState` for viewport
 * adaptation — the responsive array already exists on SceneNode (populated
 * from @media queries in Phase 1); this op lets an agent add extra breakpoints
 * beyond what the source HTML carries.
 */
export interface SetResponsiveOp extends OperationBase {
  type: 'setResponsive';
  nodeId: string;
  maxWidth: number;
  props: Record<string, unknown>;
}

// ─── Phase 5: Animation ops ─────────────────────────────────

/**
 * Attach a preset animation to a node. Preset name is looked up against the
 * animation/presets module at apply time. Config is forwarded to the preset's
 * create() function (duration, distance, easing, etc.). This is the ergonomic
 * path — "fadeIn the hero" is one op, not a 6-line keyframe definition.
 */
export interface AddPresetAnimationOp extends OperationBase {
  type: 'addPresetAnimation';
  nodeId: string;
  /** Preset name — fadeIn, slideInUp, popIn, pulse, etc. See animation/presets.ts. */
  preset: string;
  /** Optional config forwarded to preset.create(). */
  config?: Record<string, unknown>;
  /** Optional delay in ms, added after preset.duration if absent. */
  delay?: number;
}

/**
 * Attach a fully custom animation to a node — raw keyframes + duration. For
 * agents that want precise control (e.g. shape-morphing or multi-stage reveals)
 * without going through the preset library.
 */
export interface AddAnimationOp extends OperationBase {
  type: 'addAnimation';
  nodeId: string;
  /** INodeAnimation-shaped payload. Unknown fields are preserved. */
  animation: Record<string, unknown>;
}

/**
 * Remove every animation targeting this node from the scene's timeline.
 * Useful for "start over" flows where an agent wants to replace a node's
 * animation without appending to the existing one.
 */
export interface ClearAnimationsOp extends OperationBase {
  type: 'clearAnimations';
  nodeId: string;
}

// ─── Phase 6: Component ops ─────────────────────────────────

/**
 * Extract a subtree as a reusable component master and replace the subtree
 * with an INSTANCE placeholder. After this op, the scene on disk carries
 * only the placeholder (componentName + overrides) and the master lives in
 * `.reframe/components/<slug>.component.json`. Expansion happens on load.
 *
 * The replay contract is "best-effort": if the named component already
 * exists from a previous extract, replay overwrites the master with the
 * current subtree. This makes re-extracting idempotent under history
 * replay.
 */
export interface ExtractComponentOp extends OperationBase {
  type: 'extractComponent';
  /** Node whose subtree becomes the master. */
  nodeId: string;
  /** Component name — also the slug key on disk. */
  name: string;
  /** Optional human description stored alongside the master. */
  description?: string;
}

/**
 * Create an INSTANCE placeholder under a parent. Overrides are keyed by
 * slot names (matched against `node.slot` inside the master tree). The
 * placeholder is hydrated with master content at the next expandInstances
 * pass — which is automatically called after load and after replay.
 */
export interface InstantiateComponentOp extends OperationBase {
  type: 'instantiateComponent';
  parentId: string;
  componentName: string;
  overrides?: Record<string, Record<string, unknown>>;
  /** Instance node name (defaults to componentName). */
  name?: string;
}

/**
 * Break the link between an instance and its master. The cloned children
 * stay in place but the instance loses `meta.componentName`, and
 * collapse/expand passes stop touching them. Use when the author wants a
 * fork: a one-off variation that should diverge from the shared master.
 */
export interface UnlinkInstanceOp extends OperationBase {
  type: 'unlinkInstance';
  nodeId: string;
}

// ─── Union + results ────────────────────────────────────────

export type Operation =
  | SetPropsOp
  | BindTokenOp
  | AutoBindTokensOp
  | AddStateOp
  | SetResponsiveOp
  | AddPresetAnimationOp
  | AddAnimationOp
  | ClearAnimationsOp
  | ExtractComponentOp
  | InstantiateComponentOp
  | UnlinkInstanceOp;

export interface OperationResult {
  /** Whether the op successfully applied. Missing-node cases return ok=false but do not throw. */
  ok: boolean;
  /** List of node ids touched by the op. Empty when ok=false. */
  affectedNodeIds: string[];
  /** Reason when ok=false. */
  error?: string;
  /** Human-readable one-line summary for logging / history listings. */
  summary?: string;
}

export interface ReplayResult {
  applied: number;
  failed: number;
  /** Per-op results, parallel to the input ops array. */
  results: OperationResult[];
}
