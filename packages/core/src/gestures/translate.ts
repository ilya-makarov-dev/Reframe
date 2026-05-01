/**
 * Phase 8 — Gesture translator.
 *
 * Pure function: Gesture → TranslatedGesture | null.
 *
 * Takes a user's gesture (captured by a UI client) and produces:
 *   - An anchor (what thread to group the result under)
 *   - An optional annotation payload (visible marker on the preview)
 *   - An optional list of intent parts (message to the agent)
 *   - A thread title (used when creating a new thread)
 *
 * The translator is the one place that knows how each gesture maps to
 * domain objects. Any surface that captures gestures (Platform UI,
 * VS Code plugin, CLI, tests) calls `translateGesture` and then writes
 * the result through the thread / annotation / intent stores.
 *
 * Ambient gestures (hover, select) return null — they are ephemeral
 * selection state, not persistent content.
 */

import type { AnnotationPayload, AnnotationAuthor } from '../project/annotations/types.js';
import type { IntentPart } from '../project/intents/types.js';
import type {
  Gesture,
  AskGesture,
  DragGesture,
  LassoGesture,
  BrushGesture,
  ResonanceGesture,
  EchoGesture,
  PinGesture,
  RuleGesture,
  TimeScrubGesture,
  FreeVectorGesture,
} from './types.js';

export interface TranslatedGesture {
  /** The anchor for the thread that should hold the resulting content. */
  anchor: string;
  /** Scene slug this translation belongs to. */
  sceneSlug: string;
  /** Author field suitable for both annotation and intent records. */
  author: AnnotationAuthor;
  /** Annotation payload to persist (if the gesture produces one). */
  annotation?: AnnotationPayload;
  /** Intent parts to enqueue (if the gesture produces any). */
  intentParts?: IntentPart[];
  /** Short label for the thread title (used when creating a new thread). */
  threadTitle?: string;
}

// ─── Public entry point ─────────────────────────────────────

export function translateGesture(g: Gesture): TranslatedGesture | null {
  switch (g.kind) {
    case 'hover':
    case 'select':
      return null;
    case 'ask':        return translateAsk(g);
    case 'drag':       return translateDrag(g);
    case 'lasso':      return translateLasso(g);
    case 'brush':      return translateBrush(g);
    case 'resonance':  return translateResonance(g);
    case 'echo':       return translateEcho(g);
    case 'pin':        return translatePin(g);
    case 'rule':       return translateRule(g);
    case 'time-scrub': return translateTimeScrub(g);
    case 'free-vector': return translateFreeVector(g);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function author(g: Gesture): AnnotationAuthor {
  return g.author.kind === 'human'
    ? { kind: 'human', id: g.author.id }
    : { kind: 'agent', id: g.author.id };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

// ─── Per-gesture translators ────────────────────────────────

function translateAsk(g: AskGesture): TranslatedGesture {
  return {
    anchor: g.anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'comment',
      text: g.text,
    },
    intentParts: [
      { kind: 'select', nodes: [g.anchor] },
      { kind: 'text', value: g.text },
    ],
    threadTitle: truncate(g.text, 60),
  };
}

function translateDrag(g: DragGesture): TranslatedGesture {
  let move: IntentPart;
  switch (g.destination.kind) {
    case 'delta':
      move = { kind: 'move', delta: { dx: g.destination.dx, dy: g.destination.dy } };
      break;
    case 'before':
      move = { kind: 'move', destination: { before: g.destination.anchor } };
      break;
    case 'after':
      move = { kind: 'move', destination: { after: g.destination.anchor } };
      break;
    case 'into':
      move = { kind: 'move', destination: { into: g.destination.anchor } };
      break;
  }
  return {
    anchor: g.anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    intentParts: [
      { kind: 'select', nodes: [g.anchor] },
      move,
    ],
    threadTitle: `move ${g.anchor}`,
  };
}

function translateLasso(g: LassoGesture): TranslatedGesture {
  // The thread anchor is the common ancestor if we have one; otherwise
  // the first contained anchor; otherwise a region-level anchor tag.
  const anchor =
    g.ancestor ??
    g.containedAnchors[0] ??
    `region:${g.at}`;
  return {
    anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'region',
      anchors: g.containedAnchors,
      ancestor: g.ancestor,
      shape: 'freehand',
      points: g.points,
    },
    intentParts: [
      { kind: 'select', nodes: g.containedAnchors, scope: 'scene' },
    ],
    threadTitle: `region (${g.containedAnchors.length} nodes)`,
  };
}

function translateBrush(g: BrushGesture): TranslatedGesture {
  const anchor = g.anchors[0] ?? `region:${g.at}`;
  return {
    anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'brush-stroke',
      anchors: g.anchors,
      macro: g.macro,
    },
    intentParts: [
      { kind: 'select', nodes: g.anchors },
      { kind: 'apply-macro', macro: g.macro },
    ],
    threadTitle: `brush: ${g.macro}`,
  };
}

function translateResonance(g: ResonanceGesture): TranslatedGesture {
  return {
    anchor: g.seed,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'resonance-overlay',
      seed: g.seed,
      axes: g.axes,
      matches: g.matches,
    },
    intentParts: [
      { kind: 'select', nodes: g.matches },
      { kind: 'query', selector: `resonance:${g.axes.join('+')}:from:${g.seed}` },
    ],
    threadTitle: `resonance (${g.matches.length} matches)`,
  };
}

function translateEcho(g: EchoGesture): TranslatedGesture {
  // Map the gesture's semantic axis to the ref-node aspect vocabulary.
  const aspect: 'style' | 'layout' | 'text' | 'all' =
    g.axis === 'visual-style' ? 'style'
    : g.axis === 'structure'  ? 'layout'
    : /* role or all */         'all';

  const parts: IntentPart[] = [
    { kind: 'select', nodes: [g.toAnchor] },
    { kind: 'ref-node', nodeId: g.fromAnchor, aspect },
  ];
  if (g.modifier) {
    parts.push({ kind: 'text', value: g.modifier });
  }
  return {
    anchor: g.toAnchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'echo-arrow',
      fromAnchor: g.fromAnchor,
      toAnchor: g.toAnchor,
      axis: g.axis,
      note: g.modifier,
    },
    intentParts: parts,
    threadTitle: `echo ${g.axis}`,
  };
}

function translatePin(g: PinGesture): TranslatedGesture {
  let refPart: IntentPart;
  switch (g.reference.type) {
    case 'image':
      refPart = { kind: 'ref-image', url: g.reference.url, hash: g.reference.hash };
      break;
    case 'url':
      refPart = { kind: 'ref-url', url: g.reference.url };
      break;
    case 'brand':
      refPart = { kind: 'ref-brand', brand: g.reference.brand };
      break;
    case 'node':
      refPart = {
        kind: 'ref-node',
        nodeId: g.reference.anchor,
        aspect: g.reference.aspect === 'style' ? 'style'
              : g.reference.aspect === 'structure' ? 'layout'
              : 'all',
      };
      break;
  }
  const parts: IntentPart[] = [
    { kind: 'select', nodes: [g.anchor] },
    refPart,
  ];
  if (g.note) parts.push({ kind: 'text', value: g.note });
  return {
    anchor: g.anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'reference',
      source: g.reference,
      note: g.note,
    },
    intentParts: parts,
    threadTitle: `pin: ${g.reference.type}`,
  };
}

function translateRule(g: RuleGesture): TranslatedGesture {
  // Enforced rules are standing orders — the annotation is the source of
  // truth and the audit system reads it. No one-shot intent.
  // Non-enforced rules also nudge the next proposal via a constraint part.
  const intentParts: IntentPart[] | undefined = g.enforced
    ? undefined
    : [
        { kind: 'select', nodes: [g.anchor] },
        { kind: 'constraint', rule: g.rule, value: g.value },
      ];
  return {
    anchor: g.anchor,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'rule',
      rule: g.rule,
      value: g.value,
      enforced: g.enforced,
    },
    intentParts,
    threadTitle: `rule: ${g.rule}`,
  };
}

function translateFreeVector(g: FreeVectorGesture): TranslatedGesture {
  // Free-vector floats above the scene without anchoring to any node, so it
  // hangs off a scene-level pseudo-anchor. Threading is still ensured by the
  // gesture-API caller — the resulting thread groups any further conversation
  // about the stroke (replies, edits) under the same scene anchor.
  return {
    anchor: `scene:${g.sceneSlug}`,
    sceneSlug: g.sceneSlug,
    author: author(g),
    annotation: {
      kind: 'free-vector',
      points: g.points,
      stroke: g.stroke,
      width: g.width,
      opacity: g.opacity,
      smooth: g.smooth,
    },
    threadTitle: `pen stroke (${g.points.length} pts)`,
  };
}

function translateTimeScrub(g: TimeScrubGesture): TranslatedGesture {
  let parts: IntentPart[];
  switch (g.action) {
    case 'branch':
      parts = [{ kind: 'branch', from: g.opId }];
      break;
    case 'cherry-pick':
      parts = [{ kind: 'ref-history', opId: g.opId, action: 'cherry-pick' }];
      break;
    case 'compare':
      parts = [{ kind: 'compare', against: g.opId }];
      break;
    case 'revive':
      parts = [{ kind: 'ref-history', opId: g.opId, action: 'branch' }];
      break;
  }
  return {
    anchor: `scene:${g.sceneSlug}`,
    sceneSlug: g.sceneSlug,
    author: author(g),
    intentParts: parts,
    threadTitle: `time: ${g.action}`,
  };
}
