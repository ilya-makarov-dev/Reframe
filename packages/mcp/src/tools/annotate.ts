/**
 * reframe_annotate — Phase 8 MCP surface for the Annotation subsystem.
 *
 * Annotations are persistent visual markers attached to scene-graph
 * anchors (usually INode ids). Unlike intents (messages the agent
 * consumes), annotations are THINGS ON THE PREVIEW that both humans and
 * agents can read + write. The same annotation layer carries:
 *
 *   - Human comments (Ask)
 *   - Pinned references (Pin)
 *   - Echo arrows (A → B with semantic mapping)
 *   - Region outlines (lasso)
 *   - Brush strokes (apply macro to painted nodes)
 *   - Standing constraints (Rule)
 *   - Agent ghost proposals (what a proposed change would look like)
 *   - Resonance overlays (similarity matches)
 *
 * Actions:
 *
 *   Authoring:
 *     add              — create a new annotation on an anchor
 *     update           — patch payload / status / metadata
 *     transition       — move through the lifecycle (active/orphaned/resolved/dismissed)
 *     re_anchor        — move an orphaned annotation to a new node
 *     dismiss          — terminal removal
 *
 *   Inspection:
 *     list             — filtered list
 *     get              — single annotation by id
 *     count            — aggregate counts per status
 *     on_anchor        — everything on a specific anchor
 *
 *   Maintenance:
 *     orphan_missing   — sweep: transition active annotations whose anchor is gone
 *     compact          — rewrite file with latest snapshot per id
 */

import { z } from 'zod';
import {
  createAnnotation,
  updateAnnotation,
  transitionAnnotation,
  reAnchorAnnotation,
  listAnnotations,
  getAnnotation,
  countByStatus,
  compactAnnotations,
  orphanMissingAnchors,
  type Annotation,
  type AnnotationAuthor,
  type AnnotationPayload,
  type AnnotationStatus,
} from '../../../core/src/project/annotations/index.js';
import { ensureThread } from '../../../core/src/project/threads/index.js';
import { getProjectDir } from './project.js';

// ─── Schema ──────────────────────────────────────────────────

export const annotateInputSchema = {
  action: z
    .enum([
      'add', 'update', 'transition', 're_anchor', 'dismiss',
      'list', 'get', 'count', 'on_anchor',
      'orphan_missing', 'compact',
    ])
    .describe(
      'Action: add, update, transition (lifecycle state change), re_anchor (move orphaned to new anchor), dismiss (terminal remove), list, get, count, on_anchor (all annotations on one anchor), orphan_missing (sweep), compact',
    ),

  // Targeting
  annotationId: z.string().optional().describe('Annotation id — required for update/transition/re_anchor/dismiss/get'),
  anchor: z.string().optional().describe('Anchor id — usually an INode id (e.g. "n-btn-cta"), or "scene:<slug>" / "region:<hash>" / "project". Required for add and on_anchor.'),
  newAnchor: z.string().optional().describe('New anchor for re_anchor action'),
  threadId: z.string().optional().describe('Thread this annotation belongs to. If omitted on add, auto-creates or finds one via ensureThread on the given anchor.'),

  // Scope
  sceneSlug: z.string().optional().describe('Scene slug this annotation lives on (for filtering and thread scoping)'),

  // Authoring
  payload: z.any().optional().describe('Annotation payload — discriminated by kind. Examples: {kind:"comment",text:"..."}, {kind:"pin",style:"question"}, {kind:"rule",rule:"min-contrast",value:4.5,enforced:true}, {kind:"echo-arrow",fromAnchor:"n-a",toAnchor:"n-b",axis:"visual-style"}, {kind:"region",anchors:[...],shape:"freehand",points:[[0,0],[1,1]]}, {kind:"brush-stroke",anchors:[...],macro:"brutalize"}, {kind:"reference",source:{type:"brand",brand:"stripe"}}, {kind:"ghost-proposal",intentId:"i-xyz",summary:"..."}, {kind:"resonance-overlay",seed:"n-a",axes:["role","style"],matches:[...]}'),
  author: z.object({
    kind: z.enum(['human', 'agent', 'system']),
    id: z.string().optional(),
  }).optional().describe('Author metadata — defaults to {kind:"human"}'),

  // Lifecycle
  toStatus: z.enum(['active', 'orphaned', 'resolved', 'dismissed']).optional().describe('Target status for transition'),
  reason: z.string().optional().describe('Optional reason for transition / orphan sweep'),

  // Filters
  status: z.union([
    z.enum(['active', 'orphaned', 'resolved', 'dismissed']),
    z.array(z.enum(['active', 'orphaned', 'resolved', 'dismissed'])),
  ]).optional().describe('Status filter for list'),
  kind: z.enum([
    'comment', 'pin', 'echo-arrow', 'region', 'brush-stroke',
    'reference', 'rule', 'ghost-proposal', 'resonance-overlay',
  ]).optional().describe('Payload kind filter for list'),
  authorKind: z.enum(['human', 'agent', 'system']).optional().describe('Author kind filter for list'),
  limit: z.number().optional().describe('Max results for list'),

  // Orphan sweep
  liveAnchors: z.array(z.string()).optional().describe('Set of anchor ids currently alive in the scene graph. Used by orphan_missing to mark annotations whose anchor is no longer in this set.'),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleAnnotate(input: {
  action: string;
  annotationId?: string;
  anchor?: string;
  newAnchor?: string;
  threadId?: string;
  sceneSlug?: string;
  payload?: AnnotationPayload;
  author?: AnnotationAuthor;
  toStatus?: AnnotationStatus;
  reason?: string;
  status?: AnnotationStatus | AnnotationStatus[];
  kind?: AnnotationPayload['kind'];
  authorKind?: AnnotationAuthor['kind'];
  limit?: number;
  liveAnchors?: string[];
}) {
  try {
    const projectDir = getProjectDir();
    if (!projectDir) {
      return err('No project open. Use reframe_project init or open first.');
    }

    switch (input.action) {
      // ── Authoring ──────────────────────
      case 'add': {
        if (!input.anchor) return err('anchor is required for add');
        if (!input.payload) return err('payload is required for add');
        // Auto-thread: if no threadId provided, ensure one exists on this anchor.
        const threadId = input.threadId ?? ensureThread(
          projectDir,
          input.anchor,
          input.sceneSlug,
          deriveThreadTitle(input.payload),
        ).id;
        const annotation = createAnnotation(projectDir, {
          anchor: input.anchor,
          sceneSlug: input.sceneSlug,
          threadId,
          author: input.author ?? { kind: 'human' },
          payload: input.payload,
        });
        return ok(formatAnnotation(annotation, { verbose: true }));
      }

      case 'update': {
        if (!input.annotationId) return err('annotationId is required for update');
        const patch: Partial<Annotation> = {};
        if (input.payload) patch.payload = input.payload;
        if (input.author) patch.author = input.author;
        const updated = updateAnnotation(projectDir, input.annotationId, patch);
        if (!updated) return err(`Annotation ${input.annotationId} not found`);
        return ok(formatAnnotation(updated));
      }

      case 'transition': {
        if (!input.annotationId) return err('annotationId is required for transition');
        if (!input.toStatus) return err('toStatus is required for transition');
        const result = transitionAnnotation(projectDir, input.annotationId, input.toStatus, {
          reason: input.reason,
        });
        if (!result.ok) return err(result.error ?? 'transition failed');
        return ok(`Annotation ${input.annotationId} → ${input.toStatus}`);
      }

      case 're_anchor': {
        if (!input.annotationId) return err('annotationId is required for re_anchor');
        if (!input.newAnchor) return err('newAnchor is required for re_anchor');
        const result = reAnchorAnnotation(projectDir, input.annotationId, input.newAnchor);
        if (!result.ok) return err(result.error ?? 're_anchor failed');
        return ok(`Annotation ${input.annotationId} re-anchored to ${input.newAnchor} → active`);
      }

      case 'dismiss': {
        if (!input.annotationId) return err('annotationId is required for dismiss');
        const result = transitionAnnotation(projectDir, input.annotationId, 'dismissed', {
          reason: input.reason,
        });
        if (!result.ok) return err(result.error ?? 'dismiss failed');
        return ok(`Annotation ${input.annotationId} dismissed`);
      }

      // ── Inspection ─────────────────────
      case 'list': {
        const annotations = listAnnotations(projectDir, {
          status: input.status,
          sceneSlug: input.sceneSlug,
          kind: input.kind,
          authorKind: input.authorKind,
          limit: input.limit,
        });
        if (annotations.length === 0) return ok('No annotations match the filter.');
        const lines = [`${annotations.length} annotation(s):`];
        for (const a of annotations) lines.push('  ' + formatAnnotation(a));
        return ok(lines.join('\n'));
      }

      case 'get': {
        if (!input.annotationId) return err('annotationId is required for get');
        const annotation = getAnnotation(projectDir, input.annotationId);
        if (!annotation) return err(`Annotation ${input.annotationId} not found`);
        return ok(formatAnnotation(annotation, { verbose: true }));
      }

      case 'count': {
        const counts = countByStatus(projectDir);
        const lines = ['Annotation counts by status:'];
        for (const [status, n] of Object.entries(counts)) {
          if (n > 0) lines.push(`  ${status}: ${n}`);
        }
        if (lines.length === 1) lines.push('  (no annotations)');
        return ok(lines.join('\n'));
      }

      case 'on_anchor': {
        if (!input.anchor) return err('anchor is required for on_anchor');
        const annotations = listAnnotations(projectDir, {
          anchor: input.anchor,
          sceneSlug: input.sceneSlug,
        });
        if (annotations.length === 0) return ok(`No annotations on anchor "${input.anchor}".`);
        const lines = [`${annotations.length} annotation(s) on "${input.anchor}":`];
        for (const a of annotations) lines.push('  ' + formatAnnotation(a, { verbose: true }));
        return ok(lines.join('\n'));
      }

      // ── Maintenance ────────────────────
      case 'orphan_missing': {
        if (!input.liveAnchors) return err('liveAnchors[] is required for orphan_missing');
        const live = new Set(input.liveAnchors);
        const orphaned = orphanMissingAnchors(projectDir, live, input.sceneSlug, input.reason);
        return ok(`${orphaned.length} annotation(s) orphaned.`);
      }

      case 'compact': {
        const saved = compactAnnotations(projectDir);
        return ok(`Compacted annotations file: ${saved} duplicate lines removed.`);
      }

      default:
        return err(`Unknown action "${input.action}"`);
    }
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
}

// ─── Formatting ──────────────────────────────────────────────

function formatAnnotation(a: Annotation, options: { verbose?: boolean } = {}): string {
  const kind = a.payload.kind;
  const author = a.author.kind;
  const orphaned = a.status === 'orphaned' ? ` (orphaned: ${a.orphanedReason ?? '?'})` : '';
  const head = `${a.id} · ${a.status} · ${kind} · @${a.anchor} · by ${author}${orphaned}`;
  if (!options.verbose) return head;

  const detail = describePayload(a.payload);
  return `${head}\n  thread: ${a.threadId}\n  scene:  ${a.sceneSlug ?? '(none)'}\n  ${detail}`;
}

function describePayload(p: AnnotationPayload): string {
  switch (p.kind) {
    case 'comment':           return `text: "${p.text.slice(0, 80)}${p.text.length > 80 ? '…' : ''}"`;
    case 'pin':               return `pin${p.style ? ` style=${p.style}` : ''}${p.note ? ` note="${p.note.slice(0, 40)}"` : ''}`;
    case 'echo-arrow':        return `echo ${p.fromAnchor} → ${p.toAnchor} axis=${p.axis}${p.note ? ` mod=${p.note}` : ''}`;
    case 'region':            return `region ${p.anchors.length} nodes${p.ancestor ? ` ancestor=${p.ancestor}` : ''} shape=${p.shape}`;
    case 'brush-stroke':      return `brush ${p.anchors.length} nodes macro=${p.macro}`;
    case 'reference':         return `reference type=${p.source.type}${'brand' in p.source ? ` brand=${p.source.brand}` : ''}${'url' in p.source && p.source.url ? ` url=${p.source.url}` : ''}`;
    case 'rule':              return `rule "${p.rule}" enforced=${p.enforced}${p.value !== undefined ? ` value=${JSON.stringify(p.value)}` : ''}`;
    case 'ghost-proposal':    return `ghost intent=${p.intentId} "${p.summary}"`;
    case 'resonance-overlay': return `resonance seed=${p.seed} axes=[${p.axes.join(',')}] matches=${p.matches.length}`;
  }
}

function deriveThreadTitle(payload: AnnotationPayload): string {
  switch (payload.kind) {
    case 'comment':           return payload.text.slice(0, 60);
    case 'pin':               return payload.note?.slice(0, 60) ?? 'pin';
    case 'echo-arrow':        return `echo ${payload.axis}`;
    case 'region':            return `region (${payload.anchors.length} nodes)`;
    case 'brush-stroke':      return `brush: ${payload.macro}`;
    case 'reference':         return `ref: ${payload.source.type}`;
    case 'rule':              return `rule: ${payload.rule}`;
    case 'ghost-proposal':    return payload.summary.slice(0, 60);
    case 'resonance-overlay': return `resonance (${payload.matches.length} matches)`;
  }
}

function ok(text: string) { return { content: [{ type: 'text' as const, text }] }; }
function err(text: string) { return { content: [{ type: 'text' as const, text: `Error: ${text}` }] }; }
