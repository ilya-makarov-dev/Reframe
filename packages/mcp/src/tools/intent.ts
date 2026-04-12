/**
 * reframe_intent — Phase 7.0 MCP surface for the Intent Model.
 *
 * One tool, many actions. Rationale: mirror the `reframe_project` shape so
 * an agent can bundle intent operations without juggling 15 separate tool
 * calls. Each action maps 1:1 to an engine-level intents API function.
 *
 * Actions:
 *
 *   Authoring (human-driven from Platform UI or agent proposals):
 *     add              — create draft with parts
 *     add_part         — append a part to an existing draft
 *     remove_part      — delete a part from a draft by index
 *     commit           — draft → queued
 *     refine           — fork an intent into a child with extra parts
 *     clear            — wipe every active queue entry
 *
 *   Inspection (read-only):
 *     list             — filtered list of intents
 *     get              — single intent by id
 *     count            — aggregate counts per status
 *     history          — intents for a scene (includes archived)
 *
 *   Agent flow (MCP agent reads queue, returns ops):
 *     process          — atomic pop-n-transition (queued → processing)
 *     propose          — processing → proposed with generated op ids
 *     accept           — proposed → accepted
 *     reject           — proposed → rejected with reason
 *
 *   Templates:
 *     save_template    — persist parts as a reusable template
 *     list_templates   — enumerate
 *     load_template    — fetch one by name
 *     apply_template   — instantiate as a new draft
 *     delete_template  — remove
 *
 *   Maintenance:
 *     archive          — move terminal intents out of active queue
 */

import { z } from 'zod';
import {
  createDraft,
  addPartToDraft,
  removePartFromDraft,
  commitDraft,
  refineIntent,
  clearQueue,
  listIntents,
  getIntent,
  countByStatus,
  fetchNextBatch,
  proposeOps,
  acceptProposal,
  rejectProposal,
  maintainQueue,
  archiveTerminal,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  applyTemplate,
  type Intent,
  type IntentPart,
  type IntentStatus,
  type IntentAuthor,
} from '../../../core/src/project/intents/index.js';
import {
  transitionThread,
  attachAnnotation,
} from '../../../core/src/project/threads/index.js';
import {
  createAnnotation,
  listAnnotations,
  type Annotation,
} from '../../../core/src/project/annotations/index.js';
import { collectAnchorContext, cascadeResolveOnAccept } from '../../../core/src/project/hydrate.js';
import { getProjectDir } from './project.js';

// ─── Schema ──────────────────────────────────────────────────

export const intentInputSchema = {
  action: z
    .enum([
      'add', 'add_part', 'remove_part', 'commit', 'refine', 'clear',
      'list', 'get', 'count', 'history',
      'process', 'propose', 'accept', 'reject',
      'save_template', 'list_templates', 'load_template', 'apply_template', 'delete_template',
      'archive',
    ])
    .describe(
      'Action: add (new draft), add_part, remove_part, commit (draft→queued), refine (fork with extra parts), clear, list, get, count, history, process (agent batch pop), propose (agent reports ops), accept, reject, save_template, list_templates, load_template, apply_template, delete_template, archive',
    ),

  // Targeting
  intentId: z.string().optional().describe('Intent id — required for add_part, remove_part, commit, refine, get, propose, accept, reject'),
  partIndex: z.number().optional().describe('Part index for remove_part'),

  // Authoring
  parts: z.array(z.any()).optional().describe('Array of intent parts. Required for add, add_part, save_template, apply_template.extraParts'),
  part: z.any().optional().describe('Single intent part for add_part (shortcut instead of parts[0])'),
  label: z.string().optional().describe('Optional human label'),
  sceneSlug: z.string().optional().describe('Scene slug this intent targets (for queue filtering)'),
  author: z.object({
    kind: z.enum(['human', 'agent', 'audit', 'macro', 'template']),
    id: z.string().optional(),
    label: z.string().optional(),
  }).optional().describe('Author metadata — defaults to {kind:"human"}'),

  // List/filter
  status: z.union([
    z.enum(['draft', 'queued', 'processing', 'proposed', 'accepted', 'rejected', 'refined', 'archived']),
    z.array(z.enum(['draft', 'queued', 'processing', 'proposed', 'accepted', 'rejected', 'refined', 'archived'])),
  ]).optional().describe('Status filter for list/history'),
  limit: z.number().optional().describe('Max results for list/process'),
  includeArchive: z.boolean().optional().describe('Scan archive file too (list only, slower)'),

  // Agent flow
  processorId: z.string().optional().describe('Identifier for the agent fetching a batch (for audit trail)'),
  batchSize: z.number().optional().describe('How many queued intents to fetch at once (process action, default 10)'),
  opIds: z.array(z.string()).optional().describe('Op ids the agent generated for propose/accept'),
  reason: z.string().optional().describe('Reason for reject'),

  // Templates
  name: z.string().optional().describe('Template name for save/load/apply/delete_template'),
  description: z.string().optional().describe('Template description'),
  tags: z.array(z.string()).optional().describe('Template tags'),
  extraParts: z.array(z.any()).optional().describe('Extra parts to append when applying a template'),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleIntent(input: {
  action: string;
  intentId?: string;
  partIndex?: number;
  parts?: IntentPart[];
  part?: IntentPart;
  label?: string;
  sceneSlug?: string;
  author?: IntentAuthor;
  status?: IntentStatus | IntentStatus[];
  limit?: number;
  includeArchive?: boolean;
  processorId?: string;
  batchSize?: number;
  opIds?: string[];
  reason?: string;
  name?: string;
  description?: string;
  tags?: string[];
  extraParts?: IntentPart[];
}) {
  try {
    const projectDir = getProjectDir();
    if (!projectDir) {
      return err('No project open. Use reframe_project init or open first.');
    }

    switch (input.action) {
      // ── Authoring ──────────────────────
      case 'add': {
        const parts = input.parts ?? [];
        const intent = createDraft(projectDir, parts, {
          author: input.author,
          label: input.label,
          sceneSlug: input.sceneSlug,
        });
        return ok(formatIntent(intent, { verbose: true }));
      }

      case 'add_part': {
        if (!input.intentId) return err('intentId is required for add_part');
        const part = input.part ?? (input.parts?.[0]);
        if (!part) return err('part (or parts[0]) is required for add_part');
        const result = addPartToDraft(projectDir, input.intentId, part);
        if (!result.ok) return err(result.error ?? 'add_part failed');
        const updated = getIntent(projectDir, input.intentId);
        return ok(updated ? formatIntent(updated) : 'Part added');
      }

      case 'remove_part': {
        if (!input.intentId) return err('intentId is required for remove_part');
        if (typeof input.partIndex !== 'number') return err('partIndex is required for remove_part');
        const result = removePartFromDraft(projectDir, input.intentId, input.partIndex);
        if (!result.ok) return err(result.error ?? 'remove_part failed');
        const updated = getIntent(projectDir, input.intentId);
        return ok(updated ? formatIntent(updated) : 'Part removed');
      }

      case 'commit': {
        if (!input.intentId) return err('intentId is required for commit');
        const result = commitDraft(projectDir, input.intentId);
        if (!result.ok) return err(result.error ?? 'commit failed');
        maintainQueue(projectDir);
        return ok(`Intent ${input.intentId} committed → queued`);
      }

      case 'refine': {
        if (!input.intentId) return err('intentId (parent) is required for refine');
        const newParts = input.parts ?? [];
        const result = refineIntent(projectDir, input.intentId, newParts, {
          author: input.author,
          label: input.label,
        });
        if (!result.parent.ok) return err(result.parent.error ?? 'refine failed');
        return ok(
          `Parent ${input.intentId} → refined.\n` +
          `Child ${result.child?.id} created with ${result.child?.parts.length} parts (draft).`,
        );
      }

      case 'clear': {
        const count = clearQueue(projectDir);
        return ok(`Cleared ${count} active intent(s). Archive untouched.`);
      }

      // ── Inspection ─────────────────────
      case 'list': {
        const intents = listIntents(projectDir, {
          status: input.status,
          sceneSlug: input.sceneSlug,
          limit: input.limit,
          includeArchive: input.includeArchive,
        });
        if (intents.length === 0) return ok('No intents match the filter.');
        const lines = [`${intents.length} intent(s):`];
        for (const i of intents) lines.push('  ' + formatIntent(i));
        return ok(lines.join('\n'));
      }

      case 'get': {
        if (!input.intentId) return err('intentId is required for get');
        const intent = getIntent(projectDir, input.intentId);
        if (!intent) return err(`Intent ${input.intentId} not found`);
        return ok(formatIntent(intent, { verbose: true }));
      }

      case 'count': {
        const counts = countByStatus(projectDir);
        const lines = ['Intent counts by status:'];
        for (const [status, n] of Object.entries(counts)) {
          if (n > 0) lines.push(`  ${status}: ${n}`);
        }
        if (lines.length === 1) lines.push('  (active queue empty)');
        return ok(lines.join('\n'));
      }

      case 'history': {
        if (!input.sceneSlug) return err('sceneSlug is required for history');
        const intents = listIntents(projectDir, {
          sceneSlug: input.sceneSlug,
          includeArchive: true,
          limit: input.limit ?? 50,
        });
        if (intents.length === 0) return ok(`No intents for scene "${input.sceneSlug}".`);
        const lines = [`Intent history for "${input.sceneSlug}" (${intents.length}):`];
        for (const i of intents) lines.push('  ' + formatIntent(i));
        return ok(lines.join('\n'));
      }

      // ── Agent flow ─────────────────────
      case 'process': {
        const processorId = input.processorId ?? 'mcp-agent';
        const batchSize = input.batchSize ?? 10;
        const batch = fetchNextBatch(projectDir, processorId, batchSize);
        if (batch.length === 0) return ok('No queued intents to process.');

        // Phase 8: enrich the batch with thread + annotation context so
        // the agent sees the full conversation on each anchor in ONE
        // call instead of needing follow-up queries to reframe_thread +
        // reframe_annotate.
        //
        // The response ships TWO formats so the agent can pick:
        //   1. Human-readable text (default — for agents parsing prose)
        //   2. A ```reframe-context``` JSON block at the end, with a
        //      typed schema that agents can parse mechanically without
        //      regex-scraping the text.
        const lines = [`Fetched ${batch.length} intent(s) for agent processing:`];
        const structured: Array<{
          intentId: string;
          anchor: string | null;
          sceneSlug: string | null;
          parts: IntentPart[];
          context: {
            rules: Array<{ rule: string; value?: unknown; enforced: boolean }>;
            references: Array<{ type: string; summary: string }>;
            comments: Array<{ author: string; text: string; at: string }>;
            siblingThreads: number;
          };
        }> = [];

        for (const intent of batch) {
          lines.push('');
          lines.push(`[${intent.id}] (${intent.parts.length} parts)${intent.anchor ? ` @${intent.anchor}` : ''}`);
          for (let i = 0; i < intent.parts.length; i++) {
            lines.push(`  ${i}. ${describePart(intent.parts[i])}`);
          }

          const structuredEntry = {
            intentId: intent.id,
            anchor: intent.anchor ?? null,
            sceneSlug: intent.sceneSlug ?? null,
            parts: intent.parts,
            context: {
              rules: [] as Array<{ rule: string; value?: unknown; enforced: boolean }>,
              references: [] as Array<{ type: string; summary: string }>,
              comments: [] as Array<{ author: string; text: string; at: string }>,
              siblingThreads: 0,
            },
          };

          // Thread / annotation context on this anchor.
          if (intent.anchor) {
            try {
              const ctx = collectAnchorContext(projectDir, intent.anchor, intent.sceneSlug);
              // Enforced rules → agent must obey these as guardrails.
              const enforcedRules = ctx.annotations.filter(
                (a: Annotation) => a.payload.kind === 'rule' && (a.payload as any).enforced === true,
              );
              if (enforcedRules.length > 0) {
                lines.push(`  RULES (enforced on ${intent.anchor}):`);
                for (const r of enforcedRules) {
                  const p = r.payload as any;
                  lines.push(`    · ${p.rule}${p.value !== undefined ? ` = ${JSON.stringify(p.value)}` : ''}`);
                  structuredEntry.context.rules.push({
                    rule: p.rule,
                    value: p.value,
                    enforced: true,
                  });
                }
              }
              // Pinned references → agent should honor these.
              const refs = ctx.annotations.filter(a => a.payload.kind === 'reference');
              if (refs.length > 0) {
                lines.push(`  REFERENCES (pinned on ${intent.anchor}):`);
                for (const r of refs) {
                  const p = r.payload as any;
                  const src = p.source ?? {};
                  const summary = src.brand || src.url || src.anchor || '?';
                  lines.push(`    · ${src.type}: ${summary}`);
                  structuredEntry.context.references.push({
                    type: String(src.type || '?'),
                    summary: String(summary),
                  });
                }
              }
              // Past comments on this anchor → conversation context.
              const comments = ctx.annotations.filter(a => a.payload.kind === 'comment');
              if (comments.length > 0) {
                lines.push(`  COMMENTS on ${intent.anchor} (${comments.length}):`);
                for (const c of comments.slice(-5)) {
                  const p = c.payload as any;
                  const author = c.author.kind === 'human' ? 'user' : c.author.kind;
                  lines.push(`    [${author}] "${String(p.text || '').slice(0, 80)}"`);
                  structuredEntry.context.comments.push({
                    author,
                    text: String(p.text || ''),
                    at: c.createdAt,
                  });
                }
              }
              // Sibling active threads → other work in progress.
              if (ctx.threads.length > 1) {
                lines.push(`  ${ctx.threads.length - 1} sibling thread(s) active on same anchor`);
                structuredEntry.context.siblingThreads = ctx.threads.length - 1;
              }
            } catch { /* enrichment is best-effort */ }
          }

          structured.push(structuredEntry);
        }

        lines.push('');
        lines.push('Next: call reframe_intent with action="propose" + intentId + opIds for each intent.');
        lines.push('When proposing a visual change, ALSO call reframe_annotate action="add" with kind="ghost-proposal" to surface the proposal as a visible marker on the preview. The human will see it in context and can Accept/Dismiss inline.');

        // Typed JSON context block — agents that prefer structured input
        // can parse this without regex-scraping the prose above. Schema
        // is stable: { version, intents: [{intentId, anchor, sceneSlug,
        // parts, context: { rules, references, comments, siblingThreads }}] }
        lines.push('');
        lines.push('```reframe-context');
        lines.push(JSON.stringify({ version: 1, intents: structured }, null, 2));
        lines.push('```');

        return ok(lines.join('\n'));
      }

      case 'propose': {
        if (!input.intentId) return err('intentId is required for propose');
        if (!input.opIds) return err('opIds is required for propose');
        const result = proposeOps(projectDir, input.intentId, input.opIds);
        if (!result.ok) return err(result.error ?? 'propose failed');
        return ok(`Intent ${input.intentId} → proposed with ${input.opIds.length} op(s). Waiting for human approval.`);
      }

      case 'accept': {
        if (!input.intentId) return err('intentId is required for accept');
        const result = acceptProposal(projectDir, input.intentId, input.opIds);
        if (!result.ok) return err(result.error ?? 'accept failed');

        // Phase 8: when an intent is accepted, cascade the resolution.
        //   1. Resolve / dismiss annotations on the thread per policy.
        //      (rules stay active; ghost-proposals for this intent get
        //       dismissed; everything else moves to resolved.)
        //   2. Auto-resolve the thread itself with a system marker.
        // This closes the loop in one call — the agent / UI does not
        // need follow-up reframe_thread + reframe_annotate calls.
        const tail: string[] = [];
        try {
          const intent = getIntent(projectDir, input.intentId);
          if (intent?.threadId) {
            const cascade = cascadeResolveOnAccept(projectDir, intent.threadId, intent.id);
            if (cascade.resolved.length > 0) {
              tail.push(`${cascade.resolved.length} annotation(s) resolved.`);
            }
            if (cascade.dismissed.length > 0) {
              tail.push(`${cascade.dismissed.length} ghost-proposal(s) dismissed.`);
            }
            const tr = transitionThread(projectDir, intent.threadId, 'resolved', {
              resolvedBy: { kind: 'system' },
              resolution: `intent ${intent.id} accepted`,
            });
            if (tr.ok) tail.push(`Thread ${intent.threadId} auto-resolved.`);
          }
        } catch { /* best-effort */ }

        return ok(
          `Intent ${input.intentId} → accepted. Ops will be replayed on next compile.` +
          (tail.length > 0 ? '\n' + tail.join('\n') : ''),
        );
      }

      case 'reject': {
        if (!input.intentId) return err('intentId is required for reject');
        const result = rejectProposal(projectDir, input.intentId, input.reason);
        if (!result.ok) return err(result.error ?? 'reject failed');

        // Phase 8: attach a system comment annotation to the thread
        // explaining why the proposal was rejected. The human sees this
        // inline on the preview as context for future iterations.
        const tail: string[] = [];
        try {
          const intent = getIntent(projectDir, input.intentId);
          if (intent?.threadId && intent?.anchor) {
            const ann = createAnnotation(projectDir, {
              anchor: intent.anchor,
              sceneSlug: intent.sceneSlug,
              threadId: intent.threadId,
              author: { kind: 'system' },
              payload: {
                kind: 'comment',
                text: `Rejected: ${input.reason || 'no reason given'}`,
              },
            });
            attachAnnotation(projectDir, intent.threadId, ann.id);
            tail.push(`System annotation ${ann.id} attached to thread.`);
          }
        } catch { /* best-effort */ }

        return ok(
          `Intent ${input.intentId} → rejected${input.reason ? `: ${input.reason}` : ''}` +
          (tail.length > 0 ? '\n' + tail.join('\n') : ''),
        );
      }

      // ── Templates ──────────────────────
      case 'save_template': {
        if (!input.name) return err('name is required for save_template');
        const parts = input.parts ?? [];
        if (parts.length === 0) return err('parts[] is required for save_template');
        const tpl = saveTemplate(projectDir, input.name, parts, {
          description: input.description,
          tags: input.tags,
        });
        return ok(
          `Template "${tpl.name}" (${tpl.slug}) saved with ${tpl.parts.length} part(s), rev=${tpl.revision}.`,
        );
      }

      case 'list_templates': {
        const templates = listTemplates(projectDir);
        if (templates.length === 0) return ok('No templates saved.');
        const lines = [`${templates.length} template(s):`];
        for (const t of templates) {
          const desc = t.description ? ` — ${t.description}` : '';
          lines.push(`  ${t.name} (${t.slug}) rev${t.revision} · ${t.parts.length} parts${desc}`);
        }
        return ok(lines.join('\n'));
      }

      case 'load_template': {
        if (!input.name) return err('name is required for load_template');
        const tpl = loadTemplate(projectDir, input.name);
        if (!tpl) return err(`Template "${input.name}" not found`);
        const lines = [
          `Template "${tpl.name}" (${tpl.slug}) rev${tpl.revision}`,
          tpl.description ?? '',
          `Parts (${tpl.parts.length}):`,
        ];
        for (let i = 0; i < tpl.parts.length; i++) {
          lines.push(`  ${i}. ${describePart(tpl.parts[i])}`);
        }
        return ok(lines.filter(Boolean).join('\n'));
      }

      case 'apply_template': {
        if (!input.name) return err('name is required for apply_template');
        const intent = applyTemplate(projectDir, input.name, {
          author: input.author,
          label: input.label,
          sceneSlug: input.sceneSlug,
          extraParts: input.extraParts,
        });
        if (!intent) return err(`Template "${input.name}" not found`);
        return ok([
          `Template "${input.name}" applied as new draft ${intent.id}`,
          `Parts: ${intent.parts.length}`,
          'Edit with add_part/remove_part, then commit when ready.',
        ].join('\n'));
      }

      case 'delete_template': {
        if (!input.name) return err('name is required for delete_template');
        const deleted = deleteTemplate(projectDir, input.name);
        return deleted
          ? ok(`Template "${input.name}" deleted.`)
          : err(`Template "${input.name}" not found.`);
      }

      // ── Maintenance ────────────────────
      case 'archive': {
        const result = archiveTerminal(projectDir);
        return ok(`Archive complete: ${result.archived} moved, ${result.compacted} compacted from active queue.`);
      }

      default:
        return err(`Unknown action "${input.action}"`);
    }
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
}

// ─── Formatting helpers ──────────────────────────────────────

function formatIntent(intent: Intent, options: { verbose?: boolean } = {}): string {
  const parts = options.verbose
    ? intent.parts.map((p, i) => `  ${i}. ${describePart(p)}`).join('\n')
    : `${intent.parts.length} parts`;
  const label = intent.label ? ` "${intent.label}"` : '';
  const scene = intent.sceneSlug ? ` [${intent.sceneSlug}]` : '';
  const parent = intent.parentId ? ` ← ${intent.parentId}` : '';
  const head = `${intent.id} · ${intent.status}${label}${scene}${parent}`;
  return options.verbose ? `${head}\n${parts}` : `${head} · ${parts}`;
}

function describePart(part: IntentPart): string {
  const p = part as any;
  switch (p.kind) {
    case 'select': return `select ${p.nodes?.length ?? 0} node(s)${p.scope ? ` in ${p.scope}` : ''}`;
    case 'scope': return `scope=${p.value}${p.sceneId ? `:${p.sceneId}` : ''}`;
    case 'role': return `role=${p.role}${typeof p.index === 'number' ? `[${p.index}]` : ''}`;
    case 'query': return `query: ${p.selector}`;
    case 'viewport': return `viewport=${p.name}`;
    case 'text': return `text "${p.value.slice(0, 60)}${p.value.length > 60 ? '…' : ''}"`;
    case 'annotate': return `annotate ${p.shape}${p.points ? ` (${p.points.length}pts)` : ''}`;
    case 'ref-brand': return `ref-brand ${p.brand}`;
    case 'ref-image': return `ref-image ${p.url ?? p.hash ?? 'attached'}`;
    case 'ref-node': return `ref-node ${p.nodeId}`;
    case 'ref-component': return `ref-component ${p.componentName}`;
    case 'ref-macro': return `ref-macro ${p.macro}`;
    case 'apply-macro': return `apply-macro ${p.macro}`;
    case 'apply-variant': return `apply-variant ${p.variant}`;
    case 'extract-component': return `extract-component ${p.name}`;
    case 'instantiate': return `instantiate ${p.componentName}`;
    case 'direction': return `direction=${p.value}`;
    case 'degree': return `degree=${p.value}`;
    case 'move': return `move ${p.delta ? `delta(${p.delta.dx},${p.delta.dy})` : JSON.stringify(p.destination)}`;
    case 'resize': return `resize ${p.axis} ${p.mode}=${p.value}`;
    case 'constraint': return `constraint ${p.rule}=${JSON.stringify(p.value)}`;
    case 'fix-audit': return `fix-audit ${p.rule}`;
    case 'bind-token': return `bind-token ${p.property}→${p.role}`;
    case 'unbind-token': return `unbind-token ${p.property}`;
    default: return p.kind;
  }
}

function ok(text: string) { return { content: [{ type: 'text' as const, text }] }; }
function err(text: string) { return { content: [{ type: 'text' as const, text: `Error: ${text}` }] }; }
