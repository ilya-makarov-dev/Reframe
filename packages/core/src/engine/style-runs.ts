/**
 * Reframe Standalone Engine — Style Runs
 *
 * Efficient representation & manipulation of character-level text styles.
 * Range-based operations: apply, remove, toggle, adjust for insert/delete.
 */

import type { StyleRun, CharacterStyleOverride, TextDecoration } from './types';

// ─── Helpers ────────────────────────────────────────────────────

function stylesEqual(a: CharacterStyleOverride, b: CharacterStyleOverride): boolean {
  const keysA = Object.keys(a) as (keyof CharacterStyleOverride)[];
  const keysB = Object.keys(b) as (keyof CharacterStyleOverride)[];
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      // Deep compare for objects (fillColor)
      if (typeof a[key] === 'object' && typeof b[key] === 'object') {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

function isEmptyStyle(style: CharacterStyleOverride): boolean {
  return Object.keys(style).length === 0;
}

// ─── Expand / Compact ───────────────────────────────────────────

/**
 * Expand sparse StyleRun[] to a dense per-character array.
 */
function expandRuns(
  runs: StyleRun[],
  textLength: number,
): (CharacterStyleOverride | null)[] {
  const chars: (CharacterStyleOverride | null)[] = new Array(textLength).fill(null);
  for (const run of runs) {
    for (let i = run.start; i < run.start + run.length && i < textLength; i++) {
      chars[i] = { ...(chars[i] ?? {}), ...run.style };
    }
  }
  return chars;
}

/**
 * Compact a dense per-character array back to StyleRun[].
 */
function compactRuns(chars: (CharacterStyleOverride | null)[]): StyleRun[] {
  const runs: StyleRun[] = [];
  let i = 0;
  while (i < chars.length) {
    const style = chars[i];
    if (!style || isEmptyStyle(style)) {
      i++;
      continue;
    }
    const start = i;
    while (i < chars.length && chars[i] && stylesEqual(chars[i]!, style)) {
      i++;
    }
    runs.push({ start, length: i - start, style: { ...style } });
  }
  return runs;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get the computed style at a specific character index.
 */
export function getStyleAt(runs: StyleRun[], index: number): CharacterStyleOverride {
  const result: CharacterStyleOverride = {};
  for (const run of runs) {
    if (index >= run.start && index < run.start + run.length) {
      Object.assign(result, run.style);
    }
  }
  return result;
}

/**
 * Apply a style patch to a character range [start, end).
 */
export function applyStyleToRange(
  runs: StyleRun[],
  start: number,
  end: number,
  patch: CharacterStyleOverride,
  textLength: number,
): StyleRun[] {
  const chars = expandRuns(runs, textLength);
  for (let i = start; i < end && i < textLength; i++) {
    chars[i] = { ...(chars[i] ?? {}), ...patch };
  }
  return compactRuns(chars);
}

/**
 * Remove specific style properties from a range [start, end).
 */
export function removeStyleFromRange(
  runs: StyleRun[],
  start: number,
  end: number,
  keys: (keyof CharacterStyleOverride)[],
  textLength: number,
): StyleRun[] {
  const chars = expandRuns(runs, textLength);
  for (let i = start; i < end && i < textLength; i++) {
    if (chars[i]) {
      for (const key of keys) {
        delete chars[i]![key];
      }
      if (isEmptyStyle(chars[i]!)) {
        chars[i] = null;
      }
    }
  }
  return compactRuns(chars);
}

/**
 * Check if ALL characters in [start, end) have a specific style value.
 */
export function selectionHasStyle(
  runs: StyleRun[],
  start: number,
  end: number,
  key: keyof CharacterStyleOverride,
  value: unknown,
): boolean {
  for (let i = start; i < end; i++) {
    const style = getStyleAt(runs, i);
    if (style[key] !== value) return false;
  }
  return true;
}

/**
 * Adjust run positions when text is inserted at `pos`.
 */
export function adjustRunsForInsert(
  runs: StyleRun[],
  pos: number,
  insertLength: number,
): StyleRun[] {
  return runs.map(run => {
    if (pos <= run.start) {
      // Insert before run — shift
      return { ...run, start: run.start + insertLength };
    }
    if (pos < run.start + run.length) {
      // Insert inside run — extend
      return { ...run, length: run.length + insertLength };
    }
    // Insert after run — no change
    return run;
  });
}

/**
 * Adjust run positions when text is deleted from [start, start+deleteLength).
 */
export function adjustRunsForDelete(
  runs: StyleRun[],
  start: number,
  deleteLength: number,
): StyleRun[] {
  const end = start + deleteLength;
  const result: StyleRun[] = [];

  for (const run of runs) {
    const runEnd = run.start + run.length;

    if (runEnd <= start) {
      // Run entirely before deletion
      result.push(run);
    } else if (run.start >= end) {
      // Run entirely after deletion — shift
      result.push({ ...run, start: run.start - deleteLength });
    } else {
      // Run overlaps deletion
      const newStart = Math.min(run.start, start);
      const beforeDelete = Math.max(0, start - run.start);
      const afterDelete = Math.max(0, runEnd - end);
      const newLength = beforeDelete + afterDelete;
      if (newLength > 0) {
        result.push({ ...run, start: newStart, length: newLength });
      }
    }
  }

  return result;
}

// ─── Toggle Helpers ─────────────────────────────────────────────

/**
 * Toggle bold in range. Returns updated runs and new weight.
 */
export function toggleBoldInRange(
  runs: StyleRun[],
  start: number,
  end: number,
  nodeWeight: number,
  textLength: number,
): { runs: StyleRun[]; newWeight: number } {
  const allBold = selectionHasStyle(runs, start, end, 'fontWeight', 700);
  if (allBold) {
    return {
      runs: removeStyleFromRange(runs, start, end, ['fontWeight'], textLength),
      newWeight: nodeWeight === 700 ? 400 : nodeWeight,
    };
  }
  return {
    runs: applyStyleToRange(runs, start, end, { fontWeight: 700 }, textLength),
    newWeight: 700,
  };
}

/**
 * Toggle italic in range. Returns updated runs and new italic state.
 */
export function toggleItalicInRange(
  runs: StyleRun[],
  start: number,
  end: number,
  nodeItalic: boolean,
  textLength: number,
): { runs: StyleRun[]; newItalic: boolean } {
  const allItalic = selectionHasStyle(runs, start, end, 'italic', true);
  if (allItalic) {
    return {
      runs: removeStyleFromRange(runs, start, end, ['italic'], textLength),
      newItalic: false,
    };
  }
  return {
    runs: applyStyleToRange(runs, start, end, { italic: true }, textLength),
    newItalic: true,
  };
}

/**
 * Toggle text decoration in range.
 */
export function toggleDecorationInRange(
  runs: StyleRun[],
  start: number,
  end: number,
  deco: TextDecoration,
  nodeDeco: TextDecoration,
  textLength: number,
): { runs: StyleRun[]; newDeco: TextDecoration } {
  const allHave = selectionHasStyle(runs, start, end, 'textDecoration', deco);
  if (allHave) {
    return {
      runs: removeStyleFromRange(runs, start, end, ['textDecoration'], textLength),
      newDeco: 'NONE',
    };
  }
  return {
    runs: applyStyleToRange(runs, start, end, { textDecoration: deco }, textLength),
    newDeco: deco,
  };
}
