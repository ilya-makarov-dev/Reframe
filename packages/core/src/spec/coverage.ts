/**
 * INode Conformance Spec — Coverage Matrix Generator
 *
 * Analyzes spec entries and generates a property × target coverage table.
 * Shows which properties are tested in which export formats.
 */

import type { PropertySpec, PropertyCategory, CoverageRow, CoverageStatus } from './types';

export function generateCoverageMatrix(specs: PropertySpec[]): CoverageRow[] {
  return specs.map(spec => ({
    name: spec.name,
    category: spec.category,
    html: spec.html !== undefined ? '✓' : '-' as CoverageStatus,
    svg: spec.svg !== undefined ? '✓' : '-' as CoverageStatus,
    react: spec.react !== undefined ? '✓' : '-' as CoverageStatus,
    roundtrip: spec.roundtrip ? '✓' : '-' as CoverageStatus,
  }));
}

export function formatCoverageMatrix(rows: CoverageRow[]): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push('INode Conformance Coverage Matrix');
  lines.push('═'.repeat(78));
  lines.push(
    pad('Property', 36) +
    pad('Category', 14) +
    pad('HTML', 6) +
    pad('SVG', 6) +
    pad('React', 7) +
    pad('RT', 4)
  );
  lines.push('─'.repeat(78));

  // Group by category
  const categories: PropertyCategory[] = [
    'geometry', 'fill', 'stroke', 'shape', 'effect',
    'opacity', 'text', 'layout', 'composition',
  ];

  for (const cat of categories) {
    const catRows = rows.filter(r => r.category === cat);
    if (catRows.length === 0) continue;

    for (const row of catRows) {
      lines.push(
        pad(row.name, 36) +
        pad(row.category, 14) +
        pad(row.html, 6) +
        pad(row.svg, 6) +
        pad(row.react, 7) +
        pad(row.roundtrip, 4)
      );
    }
    lines.push('');
  }

  // Summary
  const total = rows.length;
  const htmlCount = rows.filter(r => r.html === '✓').length;
  const svgCount = rows.filter(r => r.svg === '✓').length;
  const reactCount = rows.filter(r => r.react === '✓').length;
  const rtCount = rows.filter(r => r.roundtrip === '✓').length;

  lines.push('─'.repeat(78));
  lines.push(
    pad(`TOTAL (${total} specs)`, 36) +
    pad('', 14) +
    pad(`${htmlCount}`, 6) +
    pad(`${svgCount}`, 6) +
    pad(`${reactCount}`, 7) +
    pad(`${rtCount}`, 4)
  );
  lines.push('═'.repeat(78));

  return lines.join('\n');
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

// ─── Coverage Stats ───────────────────────────────────────────

export interface CoverageStats {
  total: number;
  byCategory: Record<string, number>;
  byTarget: { html: number; svg: number; react: number; roundtrip: number };
  gaps: { name: string; missing: string[] }[];
}

export function analyzeCoverage(rows: CoverageRow[]): CoverageStats {
  const byCategory: Record<string, number> = {};
  const gaps: { name: string; missing: string[] }[] = [];

  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;

    const missing: string[] = [];
    if (row.html === '-') missing.push('html');
    if (row.svg === '-') missing.push('svg');
    if (row.react === '-') missing.push('react');
    if (row.roundtrip === '-') missing.push('roundtrip');
    if (missing.length > 0 && missing.length < 4) {
      gaps.push({ name: row.name, missing });
    }
  }

  return {
    total: rows.length,
    byCategory,
    byTarget: {
      html: rows.filter(r => r.html === '✓').length,
      svg: rows.filter(r => r.svg === '✓').length,
      react: rows.filter(r => r.react === '✓').length,
      roundtrip: rows.filter(r => r.roundtrip === '✓').length,
    },
    gaps,
  };
}
