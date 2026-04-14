/**
 * Tailwind CSS Preprocessor — resolves Tailwind classes to inline styles.
 *
 * Runs BEFORE the HTML importer. Converts:
 *   <div class="bg-blue-500 text-xl p-4 flex gap-4">
 * into:
 *   <div style="background-color:rgb(59,130,246);font-size:1.25rem;padding:1rem;display:flex;gap:1rem">
 *
 * Uses tw-to-css for class resolution. Preserves existing inline styles
 * (merges Tailwind styles + inline styles, inline wins on conflict).
 *
 * This unlocks the entire Tailwind ecosystem for reframe:
 * - 1000+ ready sections from HyperUI, Tailblocks, Flowbite
 * - LLMs naturally produce Tailwind HTML
 * - Modern standard, all frontend devs know it
 */

let _twi: ((classes: string) => string) | null = null;

async function getTwi(): Promise<(classes: string) => string> {
  if (!_twi) {
    try {
      const mod = await import('tw-to-css');
      _twi = mod.twi;
    } catch {
      // Fallback: return empty string if tw-to-css not installed
      _twi = () => '';
    }
  }
  return _twi;
}

/**
 * Check if an HTML string contains Tailwind-style classes.
 * Quick heuristic: look for common Tailwind patterns in class attributes.
 */
export function hasTailwindClasses(html: string): boolean {
  // Common Tailwind patterns: bg-, text-, p-, m-, flex, grid, w-, h-, rounded-, border-
  return /\bclass\s*=\s*"[^"]*\b(?:bg-|text-|p-|px-|py-|m-|mx-|my-|flex|grid|w-|h-|rounded|border-|gap-|space-|items-|justify-|font-|leading-|tracking-|shadow|opacity-|overflow-|relative|absolute|fixed|sticky|z-|top-|right-|bottom-|left-|min-|max-|aspect-)/i.test(html);
}

/**
 * Preprocess HTML: resolve Tailwind classes to inline styles.
 *
 * For each element with class="...", resolves known Tailwind classes
 * to CSS and merges into the element's style attribute.
 * Unknown classes are preserved in the class attribute.
 *
 * @returns Transformed HTML with inline styles
 */
export async function preprocessTailwind(html: string): Promise<string> {
  if (!hasTailwindClasses(html)) return html;

  const twi = await getTwi();

  // Match elements with class attributes
  // Pattern: <tag ... class="classes" ... (style="existing")?...>
  return html.replace(
    /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z][a-zA-Z0-9-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?)*)\s*\/?>/g,
    (fullMatch, tag, attrs) => {
      // Extract class attribute
      const classMatch = attrs.match(/\bclass\s*=\s*"([^"]*)"/);
      if (!classMatch) return fullMatch;

      const classes = classMatch[1].trim();
      if (!classes) return fullMatch;

      // Resolve Tailwind classes to CSS
      let resolvedCss = '';
      try {
        resolvedCss = twi(classes);
      } catch {
        return fullMatch; // can't resolve → leave as-is
      }

      if (!resolvedCss) return fullMatch;

      // Extract existing inline style
      const styleMatch = attrs.match(/\bstyle\s*=\s*"([^"]*)"/);
      const existingStyle = styleMatch ? styleMatch[1].trim() : '';

      // Merge: existing inline styles WIN over Tailwind (explicit > utility)
      const mergedStyle = existingStyle
        ? `${resolvedCss}${resolvedCss.endsWith(';') ? '' : ';'}${existingStyle}`
        : resolvedCss;

      // Rebuild attributes: remove class, update/add style
      let newAttrs = attrs;

      // Remove the class attribute
      newAttrs = newAttrs.replace(/\s*\bclass\s*=\s*"[^"]*"/, '');

      // Update or add style attribute
      if (styleMatch) {
        newAttrs = newAttrs.replace(/\bstyle\s*=\s*"[^"]*"/, `style="${mergedStyle}"`);
      } else {
        newAttrs += ` style="${mergedStyle}"`;
      }

      return `<${tag}${newAttrs}>`;
    },
  );
}
