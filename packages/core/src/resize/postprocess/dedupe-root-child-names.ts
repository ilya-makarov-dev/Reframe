import { type INode } from '../../host';

/**
 * Universal fallback: direct children of a frame should not have two layers with the same name —
 * otherwise cross/semantic matching and name-based debugging break. Duplicates get `Name (1)`, `Name (2)` …
 * avoiding collisions with already existing sibling names.
 */
export function ensureUniqueDirectChildNames(frame: INode): number {
  const children = (frame as any).children.filter((c: any) => !('removed' in c && c.removed)) as INode[];
  const usedNames = new Set<string>();
  for (const c of children) {
    if (!('name' in c)) continue;
    usedNames.add(String((c as { name?: string }).name ?? ''));
  }

  const byName = new Map<string, INode[]>();
  for (const c of children) {
    if (!('name' in c)) continue;
    const raw = String((c as { name?: string }).name ?? '');
    if (!byName.has(raw)) byName.set(raw, []);
    byName.get(raw)!.push(c);
  }

  let renamed = 0;
  for (const [baseName, nodes] of byName) {
    if (nodes.length <= 1) continue;
    for (let i = 1; i < nodes.length; i++) {
      const node = nodes[i]!;
      let k = 1;
      let candidate = `${baseName} (${k})`;
      while (usedNames.has(candidate)) {
        k += 1;
        candidate = `${baseName} (${k})`;
      }
      try {
        (node as { name: string }).name = candidate;
        usedNames.add(candidate);
        renamed += 1;
      } catch (_) {}
    }
  }
  return renamed;
}
