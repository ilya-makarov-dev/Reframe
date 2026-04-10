/**
 * Semantic auto-detection — node-property heuristics.
 *
 * Detects semantic roles from individual node properties using simple
 * predicates: "small frame with text child + cornerRadius = button",
 * "large text in top half = heading", etc. Operates on one node at a time
 * with minimal cross-node context — fast, deterministic, banner-agnostic.
 *
 * For frame-aware multi-slot classification (titles, CTAs, sections in
 * a long-form design) see {@link classify} in `./classify`.
 */

import type { SceneNode, SemanticRole, Fill } from '../engine/types';
import type { SceneGraph } from '../engine/scene-graph';

// ─── Auto-role detection ────────────────────────────────────

export interface DetectedRole {
  role: SemanticRole;
  confidence: number;  // 0-1
}

/**
 * Detect the most likely semantic role for a node.
 * Returns null if no role can be determined with sufficient confidence.
 */
export function detectSemanticRole(
  graph: SceneGraph,
  nodeId: string,
  rootId?: string,
): DetectedRole | null {
  const node = graph.getNode(nodeId);
  if (!node) return null;

  const children = graph.getChildren(nodeId);
  const parent = node.parentId ? graph.getNode(node.parentId) : null;
  const root = rootId ? graph.getNode(rootId) : null;

  // ── Text roles ──────────────────────────────
  if (node.type === 'TEXT') {
    // CTA text (inside a button-like parent)
    if (parent && isButtonLike(parent, graph)) {
      return { role: 'label', confidence: 0.8 };
    }
    // Heading: large text
    if (node.fontSize >= 32) return { role: 'heading', confidence: 0.9 };
    if (node.fontSize >= 24) return { role: 'heading', confidence: 0.7 };
    // Caption: small text
    if (node.fontSize <= 12) return { role: 'caption', confidence: 0.7 };
    // Link: text named "link" or with href
    const textName = node.name.toLowerCase();
    if (textName.includes('link') || textName.includes('href') || node.href) {
      return { role: 'link', confidence: 0.8 };
    }
    // Default text
    return { role: 'paragraph', confidence: 0.5 };
  }

  // ── Divider ─────────────────────────────────
  if ((node.type === 'RECTANGLE' || node.type === 'LINE') &&
      (node.height <= 4 || node.width <= 4) &&
      Math.max(node.width, node.height) / Math.min(node.width, node.height) > 10) {
    return { role: 'divider', confidence: 0.9 };
  }

  // ── Avatar ──────────────────────────────────
  if (node.type === 'ELLIPSE' && Math.abs(node.width - node.height) < 4 && node.width <= 80) {
    return { role: 'avatar', confidence: 0.7 };
  }
  if (node.type === 'FRAME' && Math.abs(node.width - node.height) < 4 && node.width <= 80 &&
      node.cornerRadius >= node.width * 0.4) {
    return { role: 'avatar', confidence: 0.7 };
  }

  // ── Badge ───────────────────────────────────
  if (isContainerType(node) && node.width <= 120 && node.height <= 40 &&
      node.cornerRadius >= node.height * 0.4 && children.length <= 2) {
    const hasText = children.some(c => c.type === 'TEXT' && c.text.length <= 20);
    if (hasText) return { role: 'badge', confidence: 0.7 };
  }

  // ── Button / CTA ────────────────────────────
  if (isButtonLike(node, graph)) {
    // Check for CTA text
    const textChild = children.find(c => c.type === 'TEXT');
    if (textChild && isCtaText(textChild.text)) {
      return { role: 'cta', confidence: 0.9 };
    }
    return { role: 'button', confidence: 0.8 };
  }

  // ── Card ────────────────────────────────────
  if (isContainerType(node) && node.fills.length > 0 &&
      (node.cornerRadius > 0 || node.effects.some(e => e.type === 'DROP_SHADOW')) &&
      children.length >= 2 && node.width >= 100 && node.height >= 100) {
    return { role: 'card', confidence: 0.7 };
  }

  // ── Nav ─────────────────────────────────────
  if (isContainerType(node) && node.layoutMode === 'HORIZONTAL' &&
      children.length >= 3 && root) {
    const relY = node.y / root.height;
    if (relY < 0.15) return { role: 'nav', confidence: 0.7 };
    if (relY > 0.85) return { role: 'footer', confidence: 0.6 };
  }

  // ── Hero ────────────────────────────────────
  if (isContainerType(node) && root && node.width >= root.width * 0.8 && node.height >= root.height * 0.4) {
    const hasLargeText = children.some(c => c.type === 'TEXT' && c.fontSize >= 32);
    if (hasLargeText && node.y < root.height * 0.3) {
      return { role: 'hero', confidence: 0.7 };
    }
  }

  // ── Icon ─────────────────────────────────────
  if ((node.type === 'VECTOR' || node.type === 'STAR' || node.type === 'POLYGON') &&
      node.width <= 48 && node.height <= 48 && Math.abs(node.width - node.height) < 8) {
    return { role: 'icon', confidence: 0.8 };
  }
  // Small frame with no text and near-square aspect → likely icon container
  if (isContainerType(node) && node.width <= 48 && node.height <= 48 &&
      Math.abs(node.width - node.height) < 8 && children.length <= 2 &&
      !children.some(c => c.type === 'TEXT') &&
      (node.name.toLowerCase().includes('icon') || node.type === 'COMPONENT' || node.type === 'INSTANCE')) {
    return { role: 'icon', confidence: 0.7 };
  }

  // ── Logo ────────────────────────────────────
  if (isContainerType(node) && node.width <= 200 && node.height <= 80 && root) {
    const name = node.name.toLowerCase();
    if (name.includes('logo') || name.includes('brand')) {
      return { role: 'logo', confidence: 0.9 };
    }
    // First child of nav-like parent, near top-left
    if (parent && parent.layoutMode === 'HORIZONTAL' && parent.y < (root.height * 0.15)) {
      const siblings = graph.getChildren(parent.id);
      if (siblings.length >= 2 && siblings[0].id === nodeId) {
        return { role: 'logo', confidence: 0.5 };
      }
    }
  }

  // ── Input ───────────────────────────────────
  if (isContainerType(node) && children.length <= 2 && node.height >= 32 && node.height <= 56 &&
      node.width >= 100 && node.strokes.length > 0 && node.cornerRadius > 0 && node.cornerRadius < 20) {
    const name = node.name.toLowerCase();
    if (name.includes('input') || name.includes('field') || name.includes('search')) {
      return { role: 'input', confidence: 0.9 };
    }
    // Stroke border + small radius + reasonable size → likely input
    const hasPlaceholderText = children.some(c => c.type === 'TEXT' && c.opacity < 1);
    if (hasPlaceholderText) return { role: 'input', confidence: 0.7 };
  }

  // ── Checkbox / Radio ────────────────────────
  if (isContainerType(node) && node.width <= 28 && node.height <= 28 &&
      Math.abs(node.width - node.height) < 4) {
    const name = node.name.toLowerCase();
    if (name.includes('check')) return { role: 'checkbox', confidence: 0.9 };
    if (name.includes('radio')) return { role: 'radio', confidence: 0.9 };
    // Square with border → checkbox, circle → radio
    if (node.strokes.length > 0 || node.fills.length > 0) {
      if (node.cornerRadius >= node.width * 0.45) {
        return { role: 'radio', confidence: 0.6 };
      }
      return { role: 'checkbox', confidence: 0.6 };
    }
  }

  // ── Select / Dropdown ───────────────────────
  if (isContainerType(node) && node.height >= 32 && node.height <= 56 &&
      node.width >= 100 && children.length >= 2) {
    const name = node.name.toLowerCase();
    if (name.includes('select') || name.includes('dropdown') || name.includes('picker')) {
      return { role: 'select', confidence: 0.9 };
    }
    // Has text + small triangle/chevron-like child
    const hasText = children.some(c => c.type === 'TEXT');
    const hasIcon = children.some(c => (c.type === 'VECTOR' || c.type === 'POLYGON') && c.width <= 16);
    if (hasText && hasIcon && node.strokes.length > 0) {
      return { role: 'select', confidence: 0.6 };
    }
  }

  // ── Tag (similar to badge but in content context) ──
  if (isContainerType(node) && node.width <= 150 && node.height <= 36 &&
      node.cornerRadius >= 4 && children.length <= 2) {
    const name = node.name.toLowerCase();
    if (name.includes('tag') || name.includes('chip') || name.includes('pill')) {
      return { role: 'tag', confidence: 0.8 };
    }
  }

  // ── Toast ───────────────────────────────────
  if (isContainerType(node) && node.width >= 200 && node.width <= 500 &&
      node.height >= 40 && node.height <= 100 && node.cornerRadius > 0 &&
      node.effects.some(e => e.type === 'DROP_SHADOW')) {
    const name = node.name.toLowerCase();
    if (name.includes('toast') || name.includes('snackbar') || name.includes('notification')) {
      return { role: 'toast', confidence: 0.9 };
    }
  }

  // ── Image ───────────────────────────────────
  if (node.type === 'RECTANGLE' && node.fills.some(f => f.type === 'IMAGE')) {
    return { role: 'image', confidence: 0.9 };
  }

  // ── Section ─────────────────────────────────
  if (isContainerType(node) && children.length >= 2 && node.layoutMode !== 'NONE') {
    return { role: 'section', confidence: 0.4 };
  }

  return null;
}

/**
 * Auto-detect and apply semantic roles to all nodes in a subtree.
 * Only sets roles on nodes that don't already have one.
 * Returns count of roles assigned.
 */
export function autoDetectRoles(
  graph: SceneGraph,
  rootId: string,
  minConfidence = 0.6,
): number {
  let count = 0;

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    if (!node.semanticRole) {
      const detected = detectSemanticRole(graph, nodeId, rootId);
      if (detected && detected.confidence >= minConfidence) {
        graph.updateNode(nodeId, { semanticRole: detected.role });
        count++;
      }
    }

    for (const childId of node.childIds) walk(childId);
  }

  walk(rootId);
  return count;
}

// ─── HTML tag mapping ───────────────────────────────────────

const ROLE_TO_TAG: Record<string, string> = {
  button: 'button',
  cta: 'button',
  link: 'a',
  input: 'input',
  select: 'select',
  checkbox: 'input',
  radio: 'input',
  heading: 'h2',
  paragraph: 'p',
  label: 'span',
  caption: 'small',
  nav: 'nav',
  header: 'header',
  footer: 'footer',
  sidebar: 'aside',
  main: 'main',
  section: 'section',
  list: 'ul',
  listItem: 'li',
  image: 'img',
  icon: 'span',
  logo: 'div',
  tag: 'span',
};

const ROLE_TO_ARIA: Record<string, string> = {
  card: 'article',
  badge: 'status',
  tag: 'status',
  toast: 'alert',
  modal: 'dialog',
  tooltip: 'tooltip',
  dropdown: 'menu',
  select: 'listbox',
  checkbox: 'checkbox',
  radio: 'radio',
  input: 'textbox',
  icon: 'img',
  logo: 'img',
  cta: 'button',
  hero: 'banner',
  nav: 'navigation',
  header: 'banner',
  footer: 'contentinfo',
  sidebar: 'complementary',
  main: 'main',
};

/**
 * Get the HTML tag for a semantic role.
 * Falls back to 'div' for containers or 'span' for text.
 */
export function semanticTag(role: SemanticRole | null | undefined, nodeType: string): string {
  if (role && ROLE_TO_TAG[role]) return ROLE_TO_TAG[role];
  return nodeType === 'TEXT' ? 'span' : 'div';
}

/**
 * Get the ARIA role attribute for a semantic role.
 * Returns null if no ARIA role needed (tag is semantic enough).
 */
export function ariaRole(role: SemanticRole | null | undefined): string | null {
  if (!role) return null;
  return ROLE_TO_ARIA[role] ?? null;
}

/**
 * Determine heading level from font size.
 * Returns 'h1' through 'h6' for headings, null otherwise.
 */
export function headingLevel(fontSize: number): string | null {
  if (fontSize >= 48) return 'h1';
  if (fontSize >= 36) return 'h2';
  if (fontSize >= 28) return 'h3';
  if (fontSize >= 22) return 'h4';
  if (fontSize >= 18) return 'h5';
  if (fontSize >= 14) return 'h6';
  return null;
}

// ─── Helpers ────────────────────────────────────────────────

function isContainerType(node: SceneNode): boolean {
  return ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE', 'SECTION'].includes(node.type);
}

function isButtonLike(node: SceneNode, graph: SceneGraph): boolean {
  if (!isContainerType(node)) return false;
  const children = graph.getChildren(node.id);

  // Must have at least one text child
  const hasText = children.some(c => c.type === 'TEXT');
  if (!hasText) return false;

  // Reasonable button size
  if (node.width > 400 || node.height > 80) return false;
  if (node.width < 40 || node.height < 24) return false;

  // Has fills and/or corner radius
  const hasFill = node.fills.some(f => f.visible && f.type === 'SOLID');
  const hasRadius = node.cornerRadius > 0;

  // Score
  let score = 0;
  if (hasFill) score += 2;
  if (hasRadius) score += 2;
  if (children.length <= 3) score += 1;
  if (node.name.toLowerCase().includes('button') || node.name.toLowerCase().includes('cta')) score += 3;
  if (node.layoutMode !== 'NONE') score += 1;

  return score >= 3;
}

const CTA_PATTERNS = /^(get started|sign up|subscribe|buy|shop|learn more|try|start|join|download|install|contact|book|order|add to cart|checkout|register|create|explore|view|see|read more|apply|submit|continue|next|go|launch)/i;

function isCtaText(text: string): boolean {
  return CTA_PATTERNS.test(text.trim());
}
