/**
 * SRI / crossorigin attribute stripping for inline operation.
 *
 * Pin (#18 / Week 3): SRI is stripped only on resources we successfully
 * INLINE. External-remaining links keep their `integrity` untouched —
 * never sweep-remove from html structure. The `integrity` attr referenced
 * the original external CSS bytes; once we've replaced that link with an
 * inline <style> block carrying the resolved + base64'd content, the
 * original hash no longer matches. Browser would block the inline element
 * for hash mismatch (or, in some implementations, ignore the integrity
 * attr on a non-loaded resource — undefined behavior either way).
 *
 * `crossorigin` is dropped for the same reason: it controls CORS request
 * mode, irrelevant once content is inline.
 *
 * This is a per-call utility, not a sweep. Callers (font inliner, image
 * inliner) invoke it once per inlined element with the element's full
 * outer HTML as input, get back the rewritten markup ready to be replaced
 * with the inline form.
 */

const SRI_ATTRS = ['integrity', 'crossorigin'] as const;

/**
 * Remove `integrity` and `crossorigin` attrs from a single element's
 * markup. Both single- and double-quoted values are handled. The element's
 * tag, other attrs, and content are preserved.
 *
 * @example
 *   stripSriAttrs('<link rel="stylesheet" integrity="sha384-x" href="..." crossorigin>')
 *   → '<link rel="stylesheet" href="...">'
 */
export function stripSriAttrs(elementHtml: string): string {
  let out = elementHtml;
  for (const attr of SRI_ATTRS) {
    // Match `attr="value"`, `attr='value'`, or boolean `attr` (no value).
    // Allow leading/trailing whitespace so we don't leave double spaces.
    const patterns = [
      new RegExp(`\\s+${attr}\\s*=\\s*"[^"]*"`, 'gi'),
      new RegExp(`\\s+${attr}\\s*=\\s*'[^']*'`, 'gi'),
      new RegExp(`\\s+${attr}(?=[\\s/>])`, 'gi'),
    ];
    for (const p of patterns) out = out.replace(p, '');
  }
  return out;
}
