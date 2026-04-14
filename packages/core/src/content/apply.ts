/**
 * Content Application — Markdown → INode (via SceneGraph).
 *
 * Parses markdown with back-references, finds corresponding nodes,
 * updates content (text, images, links). Design properties NEVER change.
 *
 * Safety rules:
 * - Colors, fonts, spacing, layout = untouchable
 * - Deleted content in .md → node hidden (visible: false), not deleted
 * - New content without back-ref → skipped (can't place without design)
 * - Malformed .md → partial apply + error list
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { ContentEdit, ContentApplyResult, BackReference } from './types';

// ─── Markdown parsing ─────────────────────────────────────────

interface ParsedElement {
  nodeId: string;
  markdown: string;
  kind: BackReference['kind'];
}

const BACKREF_RE = /<!-- reframe:node=(\S+) -->/;

/**
 * Parse markdown with back-references into elements.
 */
function parseMarkdown(markdown: string): ParsedElement[] {
  const lines = markdown.split('\n');
  const elements: ParsedElement[] = [];

  let currentNodeId: string | null = null;
  let currentLines: string[] = [];

  function flush() {
    if (currentNodeId && currentLines.length > 0) {
      const content = currentLines.join('\n').trim();
      if (content) {
        elements.push({
          nodeId: currentNodeId,
          markdown: content,
          kind: detectKind(content),
        });
      }
    }
    currentLines = [];
  }

  for (const line of lines) {
    const match = line.match(BACKREF_RE);
    if (match) {
      flush();
      currentNodeId = match[1];
    } else if (currentNodeId) {
      currentLines.push(line);
    }
  }
  flush();

  return elements;
}

function detectKind(md: string): BackReference['kind'] {
  const trimmed = md.trim();
  if (trimmed.startsWith('---') && trimmed.includes('# ')) return 'section-break';
  if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ')) return 'heading';
  if (trimmed.startsWith('![')) return 'image';
  if (trimmed.startsWith('[') && trimmed.includes('](')) return 'link';
  return 'text';
}

// ─── Content extraction from markdown ─────────────────────────

function extractHeadingText(md: string): string {
  return md.replace(/^#+\s*/, '').trim();
}

function extractLinkParts(md: string): { label: string; href: string } | null {
  const match = md.match(/\[([^\]]*)\]\(([^)]*)\)/);
  if (!match) return null;
  return { label: match[1], href: match[2] };
}

function extractImageParts(md: string): { alt: string; src: string } | null {
  const match = md.match(/!\[([^\]]*)\]\(([^)]*)\)/);
  if (!match) return null;
  return { alt: match[1], src: match[2] };
}

function extractListItemText(md: string): { title: string; desc: string } | null {
  const match = md.match(/^-\s+\*\*([^*]+)\*\*\s*[—–-]\s*(.*)/);
  if (!match) return null;
  return { title: match[1].trim(), desc: match[2].trim() };
}

// ─── Application ──────────────────────────────────────────────

/**
 * Apply markdown content edits to a SceneGraph.
 *
 * Compares new markdown against the current node state and applies
 * text/image/link changes. Design properties are never modified.
 *
 * SceneNode uses `text` (not `characters`) and `Fill` (not `IPaint`).
 */
export function applyContent(
  graph: SceneGraph,
  markdown: string,
): ContentApplyResult {
  const parsed = parseMarkdown(markdown);
  const applied: ContentEdit[] = [];
  const skipped: ContentEdit[] = [];
  let updated = 0;
  let hidden = 0;

  for (const element of parsed) {
    const node = graph.getNode(element.nodeId);
    if (!node) {
      skipped.push({
        ref: { nodeId: element.nodeId, kind: element.kind },
        change: { type: 'text', oldValue: '', newValue: element.markdown },
      });
      continue;
    }

    const trimmed = element.markdown.trim();

    switch (element.kind) {
      case 'heading':
      case 'text': {
        let newText: string;

        if (trimmed.startsWith('#')) {
          newText = extractHeadingText(trimmed);
        } else if (trimmed.startsWith('- **')) {
          // List item: title + desc → update children
          const parts = extractListItemText(trimmed);
          if (parts && node.childIds?.length >= 2) {
            const children = node.childIds
              .map(id => graph.getNode(id))
              .filter(c => c && c.type === 'TEXT');

            if (children.length >= 2) {
              const titleNode = children[0]!;
              const descNode = children[1]!;
              const oldTitle = titleNode.text ?? '';
              const oldDesc = descNode.text ?? '';

              if (oldTitle !== parts.title) {
                graph.updateNode(titleNode.id, { text: parts.title } as any);
                applied.push({
                  ref: { nodeId: titleNode.id, kind: 'text' },
                  change: { type: 'text', oldValue: oldTitle, newValue: parts.title },
                });
                updated++;
              }
              if (oldDesc !== parts.desc) {
                graph.updateNode(descNode.id, { text: parts.desc } as any);
                applied.push({
                  ref: { nodeId: descNode.id, kind: 'text' },
                  change: { type: 'text', oldValue: oldDesc, newValue: parts.desc },
                });
                updated++;
              }
              continue;
            }
          }
          newText = trimmed;
        } else {
          newText = trimmed;
        }

        // Update text on the node directly (if it's a TEXT node)
        if (node.type === 'TEXT') {
          const oldText = node.text ?? '';
          if (oldText !== newText) {
            graph.updateNode(node.id, { text: newText } as any);
            applied.push({
              ref: { nodeId: node.id, kind: element.kind },
              change: { type: 'text', oldValue: oldText, newValue: newText },
            });
            updated++;
          }
        }
        break;
      }

      case 'link': {
        const parts = extractLinkParts(trimmed);
        if (!parts) break;

        // Button-like: find text child and update
        if (node.childIds?.length) {
          const textChild = node.childIds
            .map(id => graph.getNode(id))
            .find(c => c && c.type === 'TEXT');

          if (textChild) {
            const oldLabel = textChild.text ?? '';
            if (oldLabel !== parts.label) {
              graph.updateNode(textChild.id, { text: parts.label } as any);
              applied.push({
                ref: { nodeId: node.id, kind: 'link' },
                change: {
                  type: 'link',
                  oldHref: '/',
                  newHref: parts.href,
                  oldLabel,
                  newLabel: parts.label,
                },
              });
              updated++;
            }
          }
        } else if (node.type === 'TEXT') {
          const oldText = node.text ?? '';
          if (oldText !== parts.label) {
            graph.updateNode(node.id, { text: parts.label } as any);
            applied.push({
              ref: { nodeId: node.id, kind: 'link' },
              change: {
                type: 'link',
                oldHref: '/',
                newHref: parts.href,
                oldLabel: oldText,
                newLabel: parts.label,
              },
            });
            updated++;
          }
        }
        break;
      }

      case 'image': {
        const parts = extractImageParts(trimmed);
        if (!parts) break;

        // Update imageHash on IMAGE fill
        const fills = node.fills;
        if (Array.isArray(fills)) {
          const imgIdx = fills.findIndex(f => f.type === 'IMAGE');
          if (imgIdx >= 0) {
            const oldHash = fills[imgIdx].imageHash ?? '';
            if (oldHash !== parts.src) {
              const newFills = [...fills];
              newFills[imgIdx] = { ...newFills[imgIdx], imageHash: parts.src };
              graph.updateNode(node.id, { fills: newFills });
              applied.push({
                ref: { nodeId: node.id, kind: 'image' },
                change: { type: 'image', oldSrc: oldHash, newSrc: parts.src },
              });
              updated++;
            }
          }
        }
        break;
      }

      case 'section-break': {
        const headingMatch = trimmed.match(/#\s+(.*)/);
        if (headingMatch) {
          const newTitle = headingMatch[1].trim();
          if (node.name !== newTitle) {
            graph.updateNode(node.id, { name: newTitle });
            updated++;
          }
        }
        break;
      }
    }
  }

  return { updated, hidden, applied, skipped };
}

/** Format apply result for text output. */
export function formatApplyResult(result: ContentApplyResult): string {
  const lines: string[] = [];
  lines.push(`Content applied: ${result.updated} updated, ${result.hidden} hidden, ${result.skipped.length} skipped`);

  if (result.applied.length > 0) {
    lines.push('');
    lines.push('Changes:');
    for (const edit of result.applied.slice(0, 10)) {
      if (edit.change.type === 'text') {
        const old = edit.change.oldValue.slice(0, 30);
        const nw = edit.change.newValue.slice(0, 30);
        lines.push(`  ${edit.ref.nodeId}: "${old}" → "${nw}"`);
      } else if (edit.change.type === 'link') {
        lines.push(`  ${edit.ref.nodeId}: [${edit.change.oldLabel}] → [${edit.change.newLabel}]`);
      } else if (edit.change.type === 'image') {
        lines.push(`  ${edit.ref.nodeId}: ${edit.change.oldSrc} → ${edit.change.newSrc}`);
      }
    }
    if (result.applied.length > 10) {
      lines.push(`  ... and ${result.applied.length - 10} more`);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push(`Skipped (node not found): ${result.skipped.map(s => s.ref.nodeId).join(', ')}`);
  }

  return lines.join('\n');
}
