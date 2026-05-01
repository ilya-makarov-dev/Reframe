/**
 * Skill registry — Phase 3.5 Pin #3.
 *
 * Reads .claude/skills/<name>/SKILL.md files at sidecar boot, parses
 * the YAML frontmatter, and exposes a typed Map for the bus router
 * to validate invocation requests against.
 *
 * Parser is purpose-built — reframe doesn't depend on js-yaml and the
 * frontmatter shape is small + predictable. The block is delimited by
 * `---` at the start of file and a closing `---`. Inside: simple
 * `key: value` lines, optionally `key:` followed by `  - item` array
 * lines. We only extract the fields we care about — anything else in
 * frontmatter is preserved as raw text, ignored by the registry.
 *
 * Registry is read-only at runtime. To add bus-* metadata to a skill,
 * the author edits SKILL.md and restarts the sidecar. No live reload —
 * skills are stable artefacts; rebooting the sidecar is the existing
 * iteration cadence anyway.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SkillEntry {
  /** From frontmatter `name:`. Used as the bus invocation identifier. */
  name: string;
  /** From frontmatter `description:`. Surfaced to humans + skill discovery. */
  description: string;
  /** Phase 3.5 bus-specific fields — all optional. Skills without them
   *  remain manually invocable but won't auto-discover from context-type
   *  filtering. */
  busContextTypes?: string[];
  busResultKinds?: string[];
  busStreaming?: boolean;
  /** Existing field — list of MCP/native tools the skill is allowed to call. */
  allowedTools?: string[];
  /** Path on disk for diagnostics + log lines. */
  filePath: string;
}

// ─── Frontmatter parser ────────────────────────────────────────

interface ParsedFrontmatter {
  scalars: Map<string, string>;
  lists: Map<string, string[]>;
}

function extractFrontmatter(text: string): string | null {
  // Frontmatter must start at byte 0 with `---` followed by a newline.
  if (!text.startsWith('---')) return null;
  const afterOpening = text.indexOf('\n', 3);
  if (afterOpening < 0) return null;
  // Closing `---` line. Search for `\n---` that's followed by a newline
  // or EOF — not a `---` inside body content.
  const closeRe = /\n---[ \t]*\r?\n/;
  const closing = closeRe.exec(text.slice(afterOpening + 1));
  if (!closing) return null;
  return text.slice(afterOpening + 1, afterOpening + 1 + closing.index);
}

function parseFrontmatter(block: string): ParsedFrontmatter {
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const lines = block.split(/\r?\n/);
  let pendingListKey: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      pendingListKey = null;
      continue;
    }
    // List continuation: indented `- item` after a `key:` line.
    if (pendingListKey && /^\s+-\s+/.test(line)) {
      const item = line.replace(/^\s+-\s+/, '').trim();
      const cleaned = stripQuotes(item);
      const arr = lists.get(pendingListKey) ?? [];
      arr.push(cleaned);
      lists.set(pendingListKey, arr);
      continue;
    }
    // `key: value` or `key:` (list opening).
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      pendingListKey = null;
      continue;
    }
    const key = m[1];
    const value = m[2];
    if (value === '') {
      pendingListKey = key;
    } else if (/^\[.*\]$/.test(value)) {
      // Inline array form: `key: [a, b, c]`.
      const items = value.slice(1, -1).split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
      lists.set(key, items);
      pendingListKey = null;
    } else {
      scalars.set(key, stripQuotes(value));
      pendingListKey = null;
    }
  }
  return { scalars, lists };
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseBoolean(s: string | undefined): boolean | undefined {
  if (s === undefined) return undefined;
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'yes') return true;
  if (lower === 'false' || lower === 'no') return false;
  return undefined;
}

function parseSkillFile(filePath: string): SkillEntry | null {
  let text: string;
  try { text = fs.readFileSync(filePath, 'utf-8'); }
  catch { return null; }

  const fm = extractFrontmatter(text);
  if (!fm) return null;
  const parsed = parseFrontmatter(fm);

  const name = parsed.scalars.get('name');
  if (!name) return null;
  const description = parsed.scalars.get('description') ?? '';

  return {
    name,
    description,
    busContextTypes: parsed.lists.get('bus-context-types'),
    busResultKinds: parsed.lists.get('bus-result-kinds'),
    busStreaming: parseBoolean(parsed.scalars.get('bus-streaming')),
    allowedTools: parsed.lists.get('allowed-tools'),
    filePath,
  };
}

// ─── Public API ────────────────────────────────────────────────

export class SkillRegistry {
  private skills: Map<string, SkillEntry>;
  private skillsRoot: string;

  constructor(skillsDir: string) {
    this.skillsRoot = skillsDir;
    this.skills = new Map();
    this.loadAll();
  }

  /** Walk skillsDir, parse every SKILL.md, register entries by name. */
  private loadAll(): void {
    if (!fs.existsSync(this.skillsRoot)) return;
    let entries: string[];
    try { entries = fs.readdirSync(this.skillsRoot); }
    catch { return; }
    for (const entry of entries) {
      const skillFile = path.join(this.skillsRoot, entry, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const parsed = parseSkillFile(skillFile);
      if (parsed) this.skills.set(parsed.name, parsed);
    }
  }

  get(name: string): SkillEntry | null {
    return this.skills.get(name) ?? null;
  }

  list(): SkillEntry[] {
    return Array.from(this.skills.values());
  }

  /** Find skills whose bus-context-types declaration includes the given
   *  type. Used by surfaces that want to discover applicable skills for
   *  a given context (e.g. workbench listing /critic + /verify-fidelity
   *  when the active context is `brand-edit`). Empty result is a valid
   *  state — caller decides whether to fall back to manual invocation. */
  matchByContextType(type: string): SkillEntry[] {
    return this.list().filter(
      (s) => Array.isArray(s.busContextTypes) && s.busContextTypes.includes(type),
    );
  }

  /** Diagnostic — total skills + how many declared bus-* metadata. */
  stats(): { total: number; busAware: number } {
    let busAware = 0;
    for (const s of this.skills.values()) {
      if (s.busContextTypes || s.busResultKinds || s.busStreaming !== undefined) {
        busAware++;
      }
    }
    return { total: this.skills.size, busAware };
  }
}

// ─── Singleton instance — sidecar consumes via getSkillRegistry() ──

let _registry: SkillRegistry | null = null;

/** Resolve `.claude/skills/` relative to the sidecar's working directory.
 *  Path is hard-coded since reframe's skill convention puts skills under
 *  the project's `.claude/` directory; this matches every existing client. */
export function getSkillRegistry(workspaceDir: string): SkillRegistry {
  if (!_registry) {
    _registry = new SkillRegistry(path.join(workspaceDir, '.claude', 'skills'));
  }
  return _registry;
}

/** Test hook — clear the singleton so tests can construct fresh registries
 *  pointed at temp dirs. Production never calls this. */
export function _resetSkillRegistry(): void {
  _registry = null;
}
