/**
 * Slug utilities — human-friendly, filesystem-safe scene identifiers.
 *
 * Properties: lowercase, hyphen-separated, no special chars, max 48 chars.
 */

/** Convert a name to a filesystem-safe slug. */
export function toSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
    .slice(0, 48);

  return slug || 'untitled';
}

/** Return a unique slug by appending -2, -3, etc. if base already exists. */
export function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let i = 2; i <= 999; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
