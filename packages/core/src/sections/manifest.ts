/**
 * Section Manifest — universal format for section bank.
 *
 * Every section from any source (Tailblocks, Kometa, HyperUI, user HTML)
 * is normalized into this format. The manifest enables:
 * - Browsing by category
 * - Constructor UI block picker
 * - Agent section selection
 * - Compile + audit validation
 *
 * Sections are stored as .html files in packages/core/src/sections/.
 * This module reads them, categorizes, and exposes the registry.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ─── Types ────────────────────────────────────────────────────

export type SectionCategory =
  | 'hero' | 'feature' | 'pricing' | 'testimonial' | 'cta'
  | 'footer' | 'header' | 'nav' | 'contact' | 'blog'
  | 'content' | 'ecommerce' | 'gallery' | 'statistic' | 'step'
  | 'team' | 'faq' | 'other';

export interface SectionEntry {
  /** Unique ID: "tailblocks/hero-a" or "kometa/hero-centered". */
  id: string;
  /** Source library. */
  library: string;
  /** Section category. */
  category: SectionCategory;
  /** Short variant label (a, b, c or descriptive). */
  variant: string;
  /** Human-readable display name. */
  name: string;
  /** Path to .html file. */
  htmlPath: string;
  /** Raw HTML content (loaded lazily). */
  html?: string;
}

export interface SectionRegistry {
  /** Total sections. */
  count: number;
  /** All categories with section counts. */
  categories: Array<{ name: SectionCategory; count: number }>;
  /** All sections. */
  sections: SectionEntry[];
}

// ─── Category detection ───────────────────────────────────────

const CATEGORY_MAP: Record<string, SectionCategory> = {
  hero: 'hero',
  feature: 'feature',
  features: 'feature',
  pricing: 'pricing',
  testimonial: 'testimonial',
  testimonials: 'testimonial',
  cta: 'cta',
  footer: 'footer',
  header: 'header',
  nav: 'nav',
  navigation: 'nav',
  contact: 'contact',
  blog: 'blog',
  content: 'content',
  ecommerce: 'ecommerce',
  gallery: 'gallery',
  statistic: 'statistic',
  stats: 'statistic',
  step: 'step',
  steps: 'step',
  team: 'team',
  faq: 'faq',
};

function detectCategory(filename: string): SectionCategory {
  // Filename format: "hero-a.html", "pricing-3col.html", etc.
  const base = filename.replace('.html', '');
  const parts = base.split('-');
  const prefix = parts[0].toLowerCase();
  return CATEGORY_MAP[prefix] ?? 'other';
}

function detectVariant(filename: string): string {
  const base = filename.replace('.html', '');
  const parts = base.split('-');
  return parts.slice(1).join('-') || 'default';
}

function generateName(category: SectionCategory, variant: string): string {
  const catName = category.charAt(0).toUpperCase() + category.slice(1);
  const varName = variant.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return `${catName} ${varName}`;
}

// ─── Registry ─────────────────────────────────────────────────

let _registry: SectionRegistry | null = null;

/**
 * Load section registry from the sections directory.
 * Scans .html files, categorizes, and builds the registry.
 */
export function loadSectionRegistry(sectionsDir?: string): SectionRegistry {
  if (_registry) return _registry;

  const dir = sectionsDir ?? join(__dirname);
  if (!existsSync(dir)) {
    _registry = { count: 0, categories: [], sections: [] };
    return _registry;
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.html'));
  const sections: SectionEntry[] = [];

  for (const file of files) {
    const category = detectCategory(file);
    const variant = detectVariant(file);
    sections.push({
      id: `tailblocks/${file.replace('.html', '')}`,
      library: 'tailblocks',
      category,
      variant,
      name: generateName(category, variant),
      htmlPath: join(dir, file),
    });
  }

  // Build category counts
  const catCounts = new Map<SectionCategory, number>();
  for (const s of sections) {
    catCounts.set(s.category, (catCounts.get(s.category) ?? 0) + 1);
  }
  const categories = [...catCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  _registry = { count: sections.length, categories, sections };
  return _registry;
}

/**
 * Get a section's HTML content by ID.
 */
export function getSectionHtml(id: string, sectionsDir?: string): string | null {
  const registry = loadSectionRegistry(sectionsDir);
  const entry = registry.sections.find(s => s.id === id);
  if (!entry) return null;
  try {
    return readFileSync(entry.htmlPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * List sections by category.
 */
export function listSectionsByCategory(
  category?: SectionCategory,
  sectionsDir?: string,
): SectionEntry[] {
  const registry = loadSectionRegistry(sectionsDir);
  if (!category) return registry.sections;
  return registry.sections.filter(s => s.category === category);
}

/**
 * Search sections by query.
 */
export function searchSections(query: string, sectionsDir?: string): SectionEntry[] {
  const registry = loadSectionRegistry(sectionsDir);
  const q = query.toLowerCase();
  return registry.sections.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.category.includes(q) ||
    s.id.includes(q),
  );
}

/**
 * Reset registry (for testing or after adding new sections).
 */
export function resetSectionRegistry(): void {
  _registry = null;
}
