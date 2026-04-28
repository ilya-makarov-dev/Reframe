/**
 * Brand vocabulary pre-pass (Week 5 #4).
 *
 * Walks input HTML, wraps power-word matches in `<strong class="reframe-vocab"
 * style="font-weight:N;color:X">word</strong>`. Industry terms are not
 * wrapped — only counted for inspect surfacing. Runs BEFORE the main
 * importer so wrapped `<strong>` produces real styled runs in the
 * resulting INode tree (font-weight + color carried via inline style →
 * importer's `buildInlineRuns` picks them up automatically).
 *
 * Skip rules (pin 4 + 5 of brief):
 *   - Don't recurse into `<strong>`, `<em>`, `<code>`, `<pre>` (existing
 *     emphasis or verbatim text). Prevents double-wrapping when a user
 *     authored emphasis themselves OR re-imports a previously-exported
 *     scene.
 *   - Don't recurse into any element with `[data-no-vocab]` (or any
 *     descendant of one). Opt-out for legalese, tech specs, raw text.
 *   - Don't recurse into `<script>`, `<style>` — never interpret
 *     code/CSS as natural-language content.
 *
 * Match rules (pin 3 + 4):
 *   - Word boundary `\b` so "Built" doesn't match inside "Builty".
 *   - Case-insensitive (`/i`), case PRESERVED in output (the captured
 *     match is retained, not the vocab list literal).
 *   - Multi-word phrases supported (sorted longest-first to avoid
 *     "Built for" being matched as "Built" + " for" separately).
 *
 * Determinism: same HTML + same vocabulary → byte-identical output.
 * Idempotent: re-running on already-wrapped HTML is a no-op (existing
 * `<strong>` is in the skip set).
 */

import type { BrandVocabulary } from '../design-system/types.js';

// ─── Configuration ───────────────────────────────────────────

const SKIP_TAGS = new Set(['strong', 'em', 'b', 'i', 'code', 'pre', 'script', 'style', 'kbd', 'samp', 'var']);
const SKIP_ATTR = 'data-no-vocab';

export interface WrapResult {
  html: string;
  /** Per-word occurrence count (case-folded key, original-case sample). */
  powerWordMatches: Array<{ word: string; occurrences: number }>;
  industryTermMatches: Array<{ term: string; occurrences: number }>;
}

/**
 * Wrap power-word matches in HTML. When `vocab` is undefined or has no
 * power-words, returns the input unchanged with empty match arrays.
 *
 * Output style attrs are computed once from `vocab.style` + the supplied
 * `accentColor` (hex string resolved by the caller from the brand
 * DesignSystem; the wrap pass doesn't know about colors itself).
 */
export async function wrapVocabulary(
  html: string,
  vocab: BrandVocabulary | undefined,
  accentColor: string,
): Promise<WrapResult> {
  if (!vocab || (vocab.powerWords.length === 0 && vocab.industryTerms.length === 0)) {
    return { html, powerWordMatches: [], industryTermMatches: [] };
  }

  // linkedom's parseHTML wraps the input in <html><head><body> — we feed
  // the raw fragment + re-extract the body content at the end. This
  // avoids importer double-wrap surprises when the source was already a
  // fragment (no <html>/<body>).
  const { parseHTML } = await import('linkedom');
  const wasFragment = !/<html\b/i.test(html);
  const docSource = wasFragment
    ? `<!DOCTYPE html><html><body>${html}</body></html>`
    : html;
  const { document } = parseHTML(docSource);

  const styleStr = buildStyleString(vocab.style, accentColor);

  const powerCounts = new Map<string, number>();
  const industryCounts = new Map<string, number>();

  // Sorted longest-first so "Built for" is tried before "Built".
  const powerSorted = [...vocab.powerWords].sort((a, b) => b.length - a.length);
  const industrySorted = [...vocab.industryTerms].sort((a, b) => b.length - a.length);

  function isInsideSkip(node: Node): boolean {
    let cur: Node | null = node.parentNode;
    while (cur && cur.nodeType === 1 /* ELEMENT_NODE */) {
      const el = cur as Element;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return true;
      if (el.hasAttribute(SKIP_ATTR)) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  function processTextNode(textNode: Text): void {
    if (isInsideSkip(textNode)) return;
    const original = textNode.nodeValue ?? '';
    if (!original.trim()) return;

    // Build a single combined regex with all power-words (sorted
    // longest-first) — captures the literal text so we preserve case.
    // Industry terms run as a separate pass: count only, no wrap.
    let mutated = original;
    let producedReplacements = false;

    if (powerSorted.length > 0) {
      const powerRe = new RegExp(`\\b(${powerSorted.map(escapeRegex).join('|')})\\b`, 'gi');
      mutated = mutated.replace(powerRe, (match) => {
        const key = match.toLowerCase();
        powerCounts.set(key, (powerCounts.get(key) ?? 0) + 1);
        producedReplacements = true;
        return `<strong class="reframe-vocab" data-vocab-original="${escapeAttr(match)}" style="${styleStr}">${escapeHtml(match)}</strong>`;
      });
    }

    if (industrySorted.length > 0) {
      // Count only — no replacement, no mutation flag flip.
      const industryRe = new RegExp(`\\b(${industrySorted.map(escapeRegex).join('|')})\\b`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = industryRe.exec(original)) !== null) {
        const key = m[1].toLowerCase();
        industryCounts.set(key, (industryCounts.get(key) ?? 0) + 1);
      }
    }

    if (!producedReplacements) return;
    // Replace text node with parsed fragment containing the new <strong>s.
    const tmpl = document.createElement('span');
    tmpl.innerHTML = mutated;
    const parent = textNode.parentNode;
    if (!parent) return;
    while (tmpl.firstChild) {
      parent.insertBefore(tmpl.firstChild, textNode);
    }
    parent.removeChild(textNode);
  }

  // Walk all text nodes. Collect upfront because we mutate the tree.
  const walker = document.createTreeWalker(document.body, /* NodeFilter.SHOW_TEXT */ 4);
  const textNodes: Text[] = [];
  let cur = walker.nextNode();
  while (cur) {
    textNodes.push(cur as Text);
    cur = walker.nextNode();
  }
  for (const t of textNodes) processTextNode(t);

  const outBody = document.body.innerHTML;
  const finalHtml = wasFragment ? outBody : document.documentElement.outerHTML;

  return {
    html: finalHtml,
    powerWordMatches: [...powerCounts.entries()].map(([word, occurrences]) => ({ word, occurrences })),
    industryTermMatches: [...industryCounts.entries()].map(([term, occurrences]) => ({ term, occurrences })),
  };
}

// ─── Style + escape helpers ──────────────────────────────────

function buildStyleString(style: BrandVocabulary['style'], accentColor: string): string {
  // `color: accent` → resolve to brand accent hex. Other recognized
  // shorthands fall back to the accent color too (Phase 0 keeps this
  // simple — full token resolution awaits a future signal).
  const color = style.color === 'accent' || !/^#?[A-Za-z0-9]+$/.test(style.color)
    ? accentColor
    : style.color.startsWith('#') ? style.color : accentColor;

  const parts = [`font-weight:${style.weight}`, `color:${color}`];
  if (style.decoration === 'underline') parts.push('text-decoration:underline');
  // 'highlight' renders as a low-alpha background of the same color.
  // Keep CSS simple: rgba() needs hex parse. For phase 0 use color-mix
  // is broadly supported; fallback to color with opacity-like alpha.
  if (style.decoration === 'highlight') parts.push(`background:color-mix(in srgb, ${color} 18%, transparent)`);
  return parts.join(';');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
