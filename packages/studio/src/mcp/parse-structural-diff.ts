/**
 * Parse second MCP content block from reframe_inspect when diffStructured: true.
 */

export interface StructuralDiffPayload {
  kind: 'reframe.structuralDiff';
  version: number;
  detail?: 'full' | 'summary';
  sceneA?: string;
  sceneB?: string;
  sceneNames?: { a?: string | null; b?: string | null };
  result?: {
    entries?: unknown[];
    summary?: { added: number; removed: number; modified: number; moved: number };
  };
}

/** If content[1] is JSON structural diff, return parsed object; else null. */
export function parseStructuralDiffFromInspectContent(
  content: Array<{ type: string; text?: string }> | undefined,
): StructuralDiffPayload | null {
  if (!content || content.length < 2) return null;
  const raw = content[1]?.text;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw) as StructuralDiffPayload;
    if (o?.kind !== 'reframe.structuralDiff') return null;
    return o;
  } catch {
    return null;
  }
}
