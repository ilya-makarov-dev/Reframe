/**
 * Section Refinement — extract/replace a single section from a composed page.
 *
 * Supports the agent per-section refinement workflow:
 * 1. Extract HTML of one section (by index)
 * 2. Agent rewrites it
 * 3. Replace that section's subtree with newly compiled HTML
 * 4. Preview updates
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { NodeType } from '../engine/types';
import { exportToHtml } from '../exporters/html';

// ─── Types ────────────────────────────────────────────────────

export interface SectionInfo {
  index: number;
  nodeId: string;
  name: string;
  type: string;
  childCount: number;
}

export interface ExtractedSection {
  info: SectionInfo;
  /** Exported HTML for this section subtree. */
  html: string;
}

export interface RefineContext {
  /** Full page section list. */
  sections: SectionInfo[];
  /** The extracted section to refine. */
  section: ExtractedSection;
  /** Brand design system markdown (if available). */
  designMd?: string;
  /** Agent prompt from user. */
  prompt: string;
}

// ─── Functions ────────────────────────────────────────────────

/**
 * List all top-level sections in a composed page.
 */
export function listPageSections(graph: SceneGraph, rootId: string): SectionInfo[] {
  const root = graph.getNode(rootId);
  if (!root) return [];

  // Root is CANVAS. Its children are pages. The composed page is usually the first (or only) page.
  // Pages contain sections as their top-level children.
  let pageNode = root;
  // If root is CANVAS with one child FRAME, go into that frame
  if (root.type === 'CANVAS' && root.childIds.length > 0) {
    const firstChild = graph.getNode(root.childIds[0]);
    if (firstChild && (firstChild.type === 'FRAME' || firstChild.type === 'COMPONENT')) {
      pageNode = firstChild;
    }
  }

  const results: SectionInfo[] = [];
  for (let i = 0; i < pageNode.childIds.length; i++) {
    const childId = pageNode.childIds[i];
    const child = graph.getNode(childId);
    if (!child) continue;
    results.push({
      index: i,
      nodeId: childId,
      name: child.name || `Section ${i + 1}`,
      type: child.type as string,
      childCount: child.childIds?.length ?? 0,
    });
  }
  return results;
}

/**
 * Extract HTML for a single section by index.
 */
export function extractSectionHtml(
  graph: SceneGraph,
  rootId: string,
  sectionIndex: number,
): ExtractedSection | null {
  const sections = listPageSections(graph, rootId);
  if (sectionIndex < 0 || sectionIndex >= sections.length) return null;

  const info = sections[sectionIndex];
  const html = exportToHtml(graph, info.nodeId);

  return { info, html };
}

/**
 * Replace a section's subtree with a new compiled graph.
 *
 * Steps:
 * 1. Delete all children of the section node
 * 2. Copy children from newSectionGraph into the section node
 *
 * Returns true if successful.
 */
export function replaceSectionSubtree(
  pageGraph: SceneGraph,
  rootId: string,
  sectionIndex: number,
  newSectionGraph: SceneGraph,
  newSectionRootId: string,
): boolean {
  const sections = listPageSections(pageGraph, rootId);
  if (sectionIndex < 0 || sectionIndex >= sections.length) return false;

  const sectionInfo = sections[sectionIndex];
  const sectionNode = pageGraph.getNode(sectionInfo.nodeId);
  if (!sectionNode) return false;

  // Get the new section root
  const newRoot = newSectionGraph.getNode(newSectionRootId);
  if (!newRoot) return false;

  // Delete existing children of the section
  for (const childId of [...sectionNode.childIds]) {
    pageGraph.deleteNode(childId);
  }

  // Copy properties from new root to existing section node (preserve ID)
  const skipKeys = new Set(['id', 'parentId', 'childIds']);
  const props: Record<string, any> = {};
  for (const [key, value] of Object.entries(newRoot)) {
    if (!skipKeys.has(key)) props[key] = value;
  }
  pageGraph.updateNode(sectionInfo.nodeId, props);

  // Deep-copy children from new graph into page graph
  for (const childId of newRoot.childIds) {
    deepCopyNode(newSectionGraph, childId, pageGraph, sectionInfo.nodeId);
  }

  return true;
}

function deepCopyNode(
  source: SceneGraph,
  sourceNodeId: string,
  target: SceneGraph,
  targetParentId: string,
): void {
  const sourceNode = source.getNode(sourceNodeId);
  if (!sourceNode) return;

  const skipKeys = new Set(['id', 'parentId', 'childIds']);
  const props: Record<string, any> = {};
  for (const [key, value] of Object.entries(sourceNode)) {
    if (!skipKeys.has(key)) props[key] = value;
  }

  const newNode = target.createNode(sourceNode.type as any, targetParentId, props);

  for (const childId of sourceNode.childIds) {
    deepCopyNode(source, childId, target, newNode.id);
  }
}

/**
 * Build the context payload that gets sent to the agent for section refinement.
 */
export function buildRefineContext(
  graph: SceneGraph,
  rootId: string,
  sectionIndex: number,
  prompt: string,
  designMd?: string,
): RefineContext | null {
  const sections = listPageSections(graph, rootId);
  const extracted = extractSectionHtml(graph, rootId, sectionIndex);
  if (!extracted) return null;

  return {
    sections,
    section: extracted,
    designMd,
    prompt,
  };
}

/** Format refine context as a prompt for the agent. */
export function formatRefinePrompt(ctx: RefineContext): string {
  const lines: string[] = [];

  lines.push(`## Section Refinement Request`);
  lines.push('');
  lines.push(`**Page structure:** ${ctx.sections.length} sections`);
  ctx.sections.forEach((s, i) => {
    const marker = i === ctx.section.info.index ? ' ← THIS ONE' : '';
    lines.push(`  ${i + 1}. ${s.name} (${s.childCount} children)${marker}`);
  });
  lines.push('');
  lines.push(`**Section to refine:** "${ctx.section.info.name}" (index ${ctx.section.info.index})`);
  lines.push('');
  lines.push(`**User request:** ${ctx.prompt}`);
  lines.push('');
  if (ctx.designMd) {
    lines.push(`**Brand:** Available via reframe_design. Use the brand's exact colors, typography, and spacing.`);
    lines.push('');
  }
  lines.push(`**Current HTML:**`);
  lines.push('```html');
  lines.push(ctx.section.html);
  lines.push('```');
  lines.push('');
  lines.push(`**Instructions:** Rewrite this section's HTML. Keep the same general structure (it's a ${ctx.section.info.name} section). Apply the user's request. Use Tailwind classes or inline styles. Return ONLY the HTML for this one section.`);

  return lines.join('\n');
}
