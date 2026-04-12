/**
 * Phase 7.0 — Intent templates.
 *
 * A template is a re-usable blueprint of intent parts. Applying a template
 * creates a fresh DRAFT intent with the template's parts copied in — the
 * user then tweaks (adds/removes parts) before committing.
 *
 * Templates live one abstraction layer above Phase 5 macros:
 *   - Macro = re-usable op sequence (agent-level action recipe)
 *   - Template = re-usable intent shape (user-level expression recipe)
 *
 * A template-driven workflow: user applies "Standard CTA improvement"
 * template → creates draft with (select:role=cta, text:"more dramatic",
 * preserve:[color], avoid:contrast-minimum) → user tweaks target scope
 * → commit → agent processes → proposes ops → some ops might BE macro
 * applications. Two layers cleanly separated.
 *
 * Persistence: `.reframe/intents/templates/<slug>.template.json`.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IntentTemplate, IntentPart, Intent, IntentAuthor } from './types.js';
import { KNOWN_PART_KINDS } from './types.js';
import { toSlug } from '../slug.js';
import { createDraft } from './lifecycle.js';

// ─── Paths ───────────────────────────────────────────────────

function templatesDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'intents', 'templates');
}

export function templateFilePath(projectDir: string, nameOrSlug: string): string {
  return path.join(templatesDir(projectDir), `${toSlug(nameOrSlug)}.template.json`);
}

// ─── CRUD ────────────────────────────────────────────────────

/**
 * Save a template. If one with the same slug exists, bump revision and
 * preserve created timestamp (matches the Phase 6 component CRUD contract).
 */
export function saveTemplate(
  projectDir: string,
  name: string,
  parts: IntentPart[],
  options: { description?: string; tags?: string[] } = {},
): IntentTemplate {
  const slug = toSlug(name);
  const filePath = templateFilePath(projectDir, slug);
  const now = new Date().toISOString();

  // Validate parts up front — same rules as the lifecycle layer.
  const validParts = parts.filter(p => p && KNOWN_PART_KINDS.has((p as IntentPart).kind));
  if (validParts.length === 0) {
    throw new Error('Cannot save an empty template (no valid parts)');
  }

  let file: IntentTemplate;
  if (fs.existsSync(filePath)) {
    const prev = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as IntentTemplate;
    file = {
      ...prev,
      name,
      slug,
      description: options.description ?? prev.description,
      tags: options.tags ?? prev.tags,
      updatedAt: now,
      revision: (prev.revision ?? 0) + 1,
      parts: validParts,
    };
  } else {
    file = {
      name,
      slug,
      description: options.description,
      tags: options.tags,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      parts: validParts,
    };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(file, null, 2), 'utf-8');
  return file;
}

/** Load a template by name or slug. Returns null when absent. */
export function loadTemplate(projectDir: string, nameOrSlug: string): IntentTemplate | null {
  const filePath = templateFilePath(projectDir, nameOrSlug);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as IntentTemplate;
  } catch {
    return null;
  }
}

/** List every template in the project, alphabetically by name. */
export function listTemplates(projectDir: string): IntentTemplate[] {
  const dir = templatesDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  const out: IntentTemplate[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.template.json')) continue;
    try {
      const content = fs.readFileSync(path.join(dir, entry), 'utf-8');
      out.push(JSON.parse(content) as IntentTemplate);
    } catch {
      // Skip corrupt — listing is best-effort.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Delete a template. Returns false when missing. */
export function deleteTemplate(projectDir: string, nameOrSlug: string): boolean {
  const filePath = templateFilePath(projectDir, nameOrSlug);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Apply ───────────────────────────────────────────────────

/**
 * Instantiate a template as a fresh DRAFT intent. The caller can then add
 * or remove parts via the lifecycle API before committing. Deep-clones
 * template parts so template edits don't leak into existing drafts.
 */
export function applyTemplate(
  projectDir: string,
  nameOrSlug: string,
  options: {
    author?: IntentAuthor;
    label?: string;
    sceneSlug?: string;
    /** Extra parts appended after the template's parts (e.g. specific
     *  `select` targeting the current selection). */
    extraParts?: IntentPart[];
  } = {},
): Intent | null {
  const template = loadTemplate(projectDir, nameOrSlug);
  if (!template) return null;

  // Deep-clone via JSON round-trip so the template file object isn't
  // mutated when the caller later edits the draft's parts.
  const clonedParts = JSON.parse(JSON.stringify(template.parts)) as IntentPart[];
  const extra = options.extraParts ?? [];
  const parts = [...clonedParts, ...extra];

  return createDraft(projectDir, parts, {
    author: options.author ?? {
      kind: 'template',
      id: template.slug,
      label: template.name,
    },
    label: options.label ?? `from template: ${template.name}`,
    sceneSlug: options.sceneSlug,
  });
}
