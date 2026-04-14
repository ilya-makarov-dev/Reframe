/**
 * Content Extraction — INode → Markdown.
 *
 * Walks the INode tree, extracts content into markdown with back-references.
 * Each element gets a `<!-- reframe:node=ID -->` comment so edits can be
 * mapped back to the exact INode.
 *
 * Rules:
 * - Top-level FRAME children of root → sections (# Heading)
 * - TEXT with large fontSize → ## heading
 * - TEXT with body fontSize → paragraph
 * - Button-like nodes → [label](/)
 * - IMAGE fills → ![alt](src)
 * - Section boundaries → ---
 *
 * Design properties are NEVER included. Only content.
 */

import type { INode, IPaint, IImagePaint } from '../host/types';
import { NodeType, MIXED } from '../host/types';
import type { ContentElement, ContentProjection, BackReference } from './types';

// ─── Thresholds ───────────────────────────────────────────────

/** Font sizes above this are headings. */
const HEADING_MIN_SIZE = 20;
/** Font sizes above this are hero/display headings. */
const DISPLAY_MIN_SIZE = 32;

// ─── Helpers ──────────────────────────────────────────────────

function backRef(nodeId: string): string {
  return `<!-- reframe:node=${nodeId} -->`;
}

function isVisible(node: INode): boolean {
  return node.visible !== false;
}

function isTextNode(node: INode): boolean {
  return node.type === NodeType.Text;
}

function isFrameNode(node: INode): boolean {
  return node.type === NodeType.Frame || node.type === NodeType.Component || node.type === NodeType.Instance;
}

function getCharacters(node: INode): string {
  return (node.characters ?? (node as any).text ?? '') as string;
}

function getFontSize(node: INode): number {
  const fs = node.fontSize;
  if (typeof fs === 'number') return fs;
  return 0;
}

function getImageSrc(node: INode): string | null {
  const fills = node.fills;
  if (!fills || fills === MIXED) return null;
  for (const fill of fills as IPaint[]) {
    if (fill.type === 'IMAGE') {
      const imgFill = fill as IImagePaint;
      return (imgFill as any).src ?? (imgFill as any).url ?? (imgFill as any).imageRef ?? null;
    }
  }
  return null;
}

function isButtonLike(node: INode): boolean {
  const name = (node.name || '').toLowerCase();
  const role = (node as any).semanticRole as string | undefined;
  if (role === 'button') return true;
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return true;
  // Small frame with single text child and corner radius
  if (isFrameNode(node) && node.children?.length === 1 && isTextNode(node.children[0])) {
    if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) return true;
  }
  return false;
}

function isSection(node: INode): boolean {
  const name = (node.name || '').toLowerCase();
  const role = (node as any).semanticRole as string | undefined;
  // Section-level frame: direct child of root with vertical layout or large height
  if (role === 'section' || role === 'hero' || role === 'footer' || role === 'navigation') return true;
  if (name.includes('section') || name.includes('hero') || name.includes('footer') ||
      name.includes('features') || name.includes('pricing') || name.includes('testimonial') ||
      name.includes('cta') || name.includes('faq') || name.includes('contact') ||
      name.includes('nav') || name.includes('header')) return true;
  return false;
}

function sectionTitle(node: INode): string {
  // Use name, or first text child, cleaned up
  const name = node.name || 'Section';
  // Clean up kebab/snake/camel to readable
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function escapeMarkdown(text: string): string {
  // Light escape — don't break readable markdown
  return text.replace(/\n{3,}/g, '\n\n');
}

// ─── Extraction ───────────────────────────────────────────────

function extractNode(
  node: INode,
  depth: number,
  elements: ContentElement[],
  isRootChild: boolean,
): void {
  if (!isVisible(node)) return;

  // ── Button-like → [label](/)
  if (isButtonLike(node) && isFrameNode(node) && node.children?.length) {
    const textChild = node.children.find(c => isTextNode(c));
    if (textChild) {
      const label = getCharacters(textChild).trim();
      if (label) {
        elements.push({
          ref: { nodeId: node.id, kind: 'link' },
          markdown: `[${label}](/)`,
          depth,
        });
        return; // Don't descend into button children
      }
    }
  }

  // ── Text node
  if (isTextNode(node)) {
    const text = getCharacters(node).trim();
    if (!text) return;

    const fontSize = getFontSize(node);
    let md: string;
    let kind: BackReference['kind'];

    if (fontSize >= DISPLAY_MIN_SIZE) {
      md = `## ${text}`;
      kind = 'heading';
    } else if (fontSize >= HEADING_MIN_SIZE) {
      md = `### ${text}`;
      kind = 'heading';
    } else {
      md = escapeMarkdown(text);
      kind = 'text';
    }

    elements.push({ ref: { nodeId: node.id, kind }, markdown: md, depth });
    return;
  }

  // ── Image node (RECTANGLE/FRAME with IMAGE fill)
  const imgSrc = getImageSrc(node);
  if (imgSrc) {
    const alt = node.name || 'image';
    elements.push({
      ref: { nodeId: node.id, kind: 'image' },
      markdown: `![${alt}](${imgSrc})`,
      depth,
    });
    return;
  }

  // ── Section-level frame (direct child of root)
  if (isRootChild && isFrameNode(node)) {
    const title = sectionTitle(node);
    elements.push({
      ref: { nodeId: node.id, kind: 'section-break' },
      markdown: `\n---\n\n# ${title}`,
      depth: 0,
    });

    // Descend into children
    if (node.children) {
      for (const child of node.children) {
        extractNode(child, depth + 1, elements, false);
      }
    }
    return;
  }

  // ── Container frame (card, feature block, etc.)
  if (isFrameNode(node) && node.children) {
    // Check if this is a list-like container (multiple similar children)
    const textChildren = node.children.filter(c => isTextNode(c) && isVisible(c));
    const isListItem = textChildren.length >= 1 && textChildren.length <= 3 && depth >= 2;

    if (isListItem && textChildren.length === 2) {
      // Card-like: title + description → `- **title** — description`
      const title = getCharacters(textChildren[0]).trim();
      const desc = getCharacters(textChildren[1]).trim();
      if (title && desc) {
        elements.push({
          ref: { nodeId: node.id, kind: 'text' },
          markdown: `- **${title}** — ${desc}`,
          depth,
        });
        return;
      }
    }

    // Recurse children
    for (const child of node.children) {
      extractNode(child, depth + 1, elements, false);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────

/**
 * Extract content from an INode tree into markdown.
 *
 * Returns a ContentProjection with:
 * - All content elements with back-references
 * - Full markdown string ready for editing
 */
export function extractContent(
  root: INode,
  sceneId: string = 'unknown',
): ContentProjection {
  const elements: ContentElement[] = [];

  // Add scene title
  const sceneName = root.name || 'Untitled';

  // Walk root children as sections
  if (root.children) {
    for (const child of root.children) {
      if (!isVisible(child)) continue;
      extractNode(child, 0, elements, true);
    }
  }

  // Build full markdown with back-references
  const lines: string[] = [];
  const stats = { sections: 0, headings: 0, paragraphs: 0, links: 0, images: 0 };

  for (const el of elements) {
    lines.push(backRef(el.ref.nodeId));
    lines.push(el.markdown);
    lines.push('');

    switch (el.ref.kind) {
      case 'section-break': stats.sections++; break;
      case 'heading': stats.headings++; break;
      case 'text': stats.paragraphs++; break;
      case 'link': stats.links++; break;
      case 'image': stats.images++; break;
    }
  }

  return {
    sceneId,
    sceneName,
    elements,
    markdown: lines.join('\n').trim(),
    stats,
  };
}
