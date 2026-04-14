/**
 * Site Constructor — one template × many .md files = many pages.
 *
 * Flow:
 *   1. Agent creates template design (HTML → compile → INode)
 *   2. extractContent() → template.md with back-references
 *   3. User/client copies template.md, edits content for each page
 *   4. createPageFromTemplate() → clone template + apply .md = new page
 *   5. exportSite() → multi-page site with routing
 *
 * Design is immutable. Only content changes per page.
 */

import type { SceneGraph } from '../engine/scene-graph';
import { serializeGraph, deserializeScene, migrateSceneJSON } from '../serialize';
import type { SceneJSON } from '../serialize';
import { applyContent } from './apply';
import { extractContent } from './extract';
import { StandaloneNode } from '../adapters/standalone/node';
import type { ContentApplyResult } from './types';

// ─── Types ────────────────────────────────────────────────────

export interface PageResult {
  /** New page slug. */
  slug: string;
  /** New page name. */
  name: string;
  /** Cloned SceneGraph with content applied. */
  graph: SceneGraph;
  /** Root node ID. */
  rootId: string;
  /** Content application result. */
  contentResult: ContentApplyResult;
}

export interface SiteBuildResult {
  /** Pages created. */
  pages: PageResult[];
  /** Template scene ID used. */
  templateId: string;
  /** Extracted template markdown (for reference). */
  templateMarkdown: string;
  /** Pages that failed. */
  errors: Array<{ slug: string; error: string }>;
}

export interface SitePageInput {
  /** Page slug (used in URL hash: "features" → #features). */
  slug: string;
  /** Display name ("Features"). */
  name: string;
  /** Markdown content with back-references. */
  markdown: string;
}

// ─── Core ─────────────────────────────────────────────────────

/**
 * Clone a template scene and apply markdown content to create a new page.
 *
 * The template's design (colors, fonts, layout) is preserved.
 * Only content (text, images, links) is replaced from the markdown.
 */
export function createPageFromTemplate(
  templateGraph: SceneGraph,
  templateRootId: string,
  pageSlug: string,
  pageName: string,
  markdown: string,
): PageResult {
  // Clone via serialize/deserialize (deep copy — preserves node IDs
  // so .md back-references still match)
  const serialized = serializeGraph(templateGraph, templateRootId);

  // Deserialize creates a fresh graph with identical structure and IDs
  const migrated = migrateSceneJSON(serialized);
  const { graph: newGraph, rootId: newRootId } = deserializeScene(migrated);

  // Update root name
  newGraph.updateNode(newRootId, { name: pageName });

  // Apply markdown content
  const contentResult = applyContent(newGraph, markdown);

  return {
    slug: pageSlug,
    name: pageName,
    graph: newGraph,
    rootId: newRootId,
    contentResult,
  };
}

/**
 * Build a complete site from a template + array of page markdown files.
 *
 * One template design × N content files = N-page site.
 */
export function buildSite(
  templateGraph: SceneGraph,
  templateRootId: string,
  pages: SitePageInput[],
): SiteBuildResult {
  // Extract template markdown for reference
  const templateRoot = templateGraph.getNode(templateRootId);
  const wrappedRoot = templateRoot
    ? new StandaloneNode(templateGraph, templateRoot)
    : null;
  const templateMarkdown = wrappedRoot
    ? extractContent(wrappedRoot as any, 'template').markdown
    : '';

  const results: PageResult[] = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const page of pages) {
    try {
      const result = createPageFromTemplate(
        templateGraph,
        templateRootId,
        page.slug,
        page.name,
        page.markdown,
      );
      results.push(result);
    } catch (e: any) {
      errors.push({ slug: page.slug, error: e.message });
    }
  }

  return {
    pages: results,
    templateId: templateRootId,
    templateMarkdown,
    errors,
  };
}

/** Format build result for text output. */
export function formatBuildSiteResult(result: SiteBuildResult): string {
  const lines: string[] = [];
  lines.push(`Site built: ${result.pages.length} pages from template`);
  lines.push('');

  for (const page of result.pages) {
    const cr = page.contentResult;
    lines.push(`  ${page.slug} "${page.name}" — ${cr.updated} edits applied, ${cr.skipped.length} skipped`);
  }

  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const e of result.errors) {
      lines.push(`  ${e.slug}: ${e.error}`);
    }
  }

  lines.push('');
  lines.push('Next: reframe_export({ format: "site" }) to bundle all pages.');

  return lines.join('\n');
}
