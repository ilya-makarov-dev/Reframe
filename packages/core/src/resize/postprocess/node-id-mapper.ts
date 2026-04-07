import { type INode } from '../../host';
import { getHost } from '../../host/context';
import { collectAllDescendants } from './layout-utils';

export interface SourceResultIdMapMeta {
  map: Map<string, string>;
  /** true if parallel DFS did not match the clone tree and structural path matching was used */
  usedStructuralFallback: boolean;
}

/** Collects node ids in tree traversal order (depth-first), including INSTANCE children — needed for Remember and source→result map. */
export function collectIdsInOrder(node: INode, out: string[]): void {
  if (node.removed) return;
  out.push(node.id);
  if (node.children) {
    for (const child of node.children) {
      collectIdsInOrder(child, out);
    }
  }
}

/**
 * Stable key "path from root frame": type + index among children (no names — universal).
 * Needed when DFS order in clone and original diverges (common inside INSTANCE after clone).
 */
export function getStructuralPathKey(frame: INode, node: INode): string {
  const parts: string[] = [];
  let cur: INode | null = node;
  while (cur && cur !== frame) {
    if (!('type' in cur)) break;
    const sn = cur as INode;
    const par = sn.parent;
    let idx = 0;
    if (par && par.children) {
      const kids = par.children.filter((c: INode) => !c.removed);
      const i = kids.indexOf(sn);
      idx = i >= 0 ? i : 0;
    }
    parts.push(`${sn.type}#${idx}`);
    cur = par;
  }
  return parts.reverse().join('>');
}

/** dynamic-page: only getNodeByIdAsync allowed, sync getNodeById is forbidden. */
export async function pathsAlignWithParallelWalk(
  sourceFrame: INode,
  resultFrame: INode,
  sourceIds: string[],
  resultIds: string[]
): Promise<boolean> {
  if (sourceIds.length !== resultIds.length) return false;
  const n = sourceIds.length;
  const host = getHost();
  const resolved = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      Promise.all([
        host.getNodeByIdAsync?.(sourceIds[i]!) ?? Promise.resolve(null),
        host.getNodeByIdAsync?.(resultIds[i]!) ?? Promise.resolve(null)
      ])
    )
  );
  for (let i = 0; i < n; i++) {
    const [sBase, rBase] = resolved[i]!;
    const sNode = sBase as INode | null;
    const rNode = rBase as INode | null;
    if (!sNode || !rNode) return false;
    if (getStructuralPathKey(sourceFrame, sNode) !== getStructuralPathKey(resultFrame, rNode)) return false;
  }
  return true;
}

/**
 * If parallel DFS did not match the structure — match by pathKey, fill remaining via DFS without reusing result ids.
 */
export function buildSourceToResultNodeIdMapByStructure(
  sourceFrame: INode,
  resultFrame: INode,
  sourceIds: string[],
  resultIds: string[]
): Map<string, string> {
  const pathIndex = new Map<string, string>();
  for (const n of collectAllDescendants(resultFrame)) {
    if (n === resultFrame || ('removed' in n && n.removed)) continue;
    const k = getStructuralPathKey(resultFrame, n as INode);
    if (!pathIndex.has(k)) pathIndex.set(k, n.id);
  }
  const map = new Map<string, string>();
  map.set(sourceFrame.id, resultFrame.id);
  const usedResult = new Set<string>([resultFrame.id]);

  for (const n of collectAllDescendants(sourceFrame)) {
    if (n === resultFrame || ('removed' in n && n.removed)) continue;
    const k = getStructuralPathKey(sourceFrame, n as INode);
    const rid = pathIndex.get(k);
    if (rid && !usedResult.has(rid)) {
      map.set(n.id, rid);
      usedResult.add(rid);
    }
  }
  const len = Math.min(sourceIds.length, resultIds.length);
  for (let i = 0; i < len; i++) {
    const sid = sourceIds[i]!;
    const rid = resultIds[i]!;
    if (map.has(sid)) continue;
    if (usedResult.has(rid)) continue;
    map.set(sid, rid);
    usedResult.add(rid);
  }
  return map;
}

/**
 * Builds sourceId → resultId mapping for a frame pair (source — original, result — clone after resize).
 * Usually parallel DFS suffices; if tree sizes or structural paths diverge — match by pathKey,
 * otherwise Remember slots land on wrong nodes (logo↔stripe, text overlap, missing button).
 */
export async function buildSourceToResultNodeIdMapWithMeta(
  sourceFrame: INode,
  resultFrame: INode
): Promise<SourceResultIdMapMeta> {
  const sourceIds: string[] = [];
  const resultIds: string[] = [];
  collectIdsInOrder(sourceFrame, sourceIds);
  collectIdsInOrder(resultFrame, resultIds);

  const orderMap = new Map<string, string>();
  const len = Math.min(sourceIds.length, resultIds.length);
  for (let i = 0; i < len; i++) orderMap.set(sourceIds[i]!, resultIds[i]!);

  if (sourceIds.length !== resultIds.length) {
    return {
      map: buildSourceToResultNodeIdMapByStructure(sourceFrame, resultFrame, sourceIds, resultIds),
      usedStructuralFallback: true
    };
  }

  if (!(await pathsAlignWithParallelWalk(sourceFrame, resultFrame, sourceIds, resultIds))) {
    return {
      map: buildSourceToResultNodeIdMapByStructure(sourceFrame, resultFrame, sourceIds, resultIds),
      usedStructuralFallback: true
    };
  }

  return { map: orderMap, usedStructuralFallback: false };
}

export async function buildSourceToResultNodeIdMap(
  sourceFrame: INode,
  resultFrame: INode
): Promise<Map<string, string>> {
  const meta = await buildSourceToResultNodeIdMapWithMeta(sourceFrame, resultFrame);
  return meta.map;
}
