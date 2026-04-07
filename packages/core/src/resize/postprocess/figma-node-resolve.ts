/**
 * Synchronous id resolve: with a stale id from Remember / another file, Figma may throw or return a "dead" node;
 * accessing `.parent` then yields `get_parent: node does not exist`.
 */
import { type INode } from '../../host';
import { getHost } from '../../host/context';

export function tryResolveNodeById(id: string): INode | null {
  try {
    const n = getHost().getNodeById(id) as INode | null | undefined;
    if (!n || ('removed' in n && (n as { removed?: boolean }).removed)) return null;
    return n;
  } catch {
    return null;
  }
}

export async function tryResolveNodeByIdAsync(id: string): Promise<INode | null> {
  try {
    const n = (await (getHost().getNodeByIdAsync?.(id) ?? Promise.resolve(null))) as INode | null | undefined;
    if (n && 'removed' in n && (n as { removed?: boolean }).removed) return null;
    return n ?? null;
  } catch {
    return null;
  }
}
