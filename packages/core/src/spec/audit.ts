/**
 * INode Conformance Spec — Audit Rule Specifications
 *
 * Each entry: a rule, a scene that passes, a scene that fails.
 * The runner verifies pass → 0 issues, fail → expected issue count.
 */

import type { AuditRuleSpec } from './types';
import type { AuditRule } from '../audit';
import { frame, rect, text, ellipse, solid } from '../builder';
import {
  textOverflow,
  nodeOverflow,
  minFontSize,
  noHiddenNodes,
  noEmptyText,
  noZeroSize,
  contrastMinimum,
  minTouchTarget,
  fontInPalette,
  colorInPalette,
  fontWeightCompliance,
  borderRadiusCompliance,
  spacingGridCompliance,
  fontSizeRoleMatch,
  visualHierarchy,
  contentDensity,
  visualBalance,
  ctaVisibility,
  exportFidelity,
} from '../audit';

export interface AuditRuleEntry extends AuditRuleSpec {
  /** Factory that creates the rule instance */
  factory: () => AuditRule;
}

export const AUDIT_SPECS: AuditRuleEntry[] = [
  {
    rule: 'textOverflow',
    factory: textOverflow,
    pass: frame({ width: 400, height: 200 },
      text('Short', { x: 10, y: 10, width: 200, height: 40, fontSize: 16 }),
    ),
    // Text extends beyond frame boundary (x:350 + width:200 = 550 > 400)
    fail: frame({ width: 400, height: 200 },
      text('Overflowing text', { x: 350, y: 10, width: 200, height: 40, fontSize: 16 }),
    ),
  },
  {
    rule: 'nodeOverflow',
    factory: nodeOverflow,
    pass: frame({ width: 400, height: 400 },
      rect({ x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    // Child extends beyond frame (x:350 + width:100 = 450 > 400)
    fail: frame({ width: 400, height: 400 },
      rect({ x: 350, y: 350, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
  },
  {
    rule: 'minFontSize',
    factory: () => minFontSize(10),
    pass: frame({ width: 400, height: 200 },
      text('Normal', { x: 10, y: 10, width: 200, height: 30, fontSize: 14 }),
    ),
    fail: frame({ width: 400, height: 200 },
      text('Tiny', { x: 10, y: 10, width: 200, height: 20, fontSize: 6 }),
    ),
  },
  {
    rule: 'noEmptyText',
    factory: noEmptyText,
    pass: frame({ width: 400, height: 200 },
      text('Has content', { x: 10, y: 10, width: 200, height: 30, fontSize: 14 }),
    ),
    fail: frame({ width: 400, height: 200 },
      text('', { x: 10, y: 10, width: 200, height: 30, fontSize: 14 }),
    ),
  },
  {
    rule: 'noZeroSize',
    factory: noZeroSize,
    pass: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    fail: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 0, height: 100, fills: [solid('#FF0000')] }),
    ),
  },
  {
    rule: 'noHiddenNodes',
    factory: noHiddenNodes,
    pass: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, visible: true, fills: [solid('#FF0000')] }),
    ),
    fail: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, visible: false, fills: [solid('#FF0000')] }),
    ),
  },
  {
    rule: 'minTouchTarget',
    factory: () => minTouchTarget(44),
    pass: frame({ width: 400, height: 200 },
      rect({ name: 'BigButton', x: 10, y: 10, width: 120, height: 48, fills: [solid('#0066FF')] }),
    ),
    fail: frame({ width: 400, height: 200 },
      rect({ name: 'TinyButton', x: 10, y: 10, width: 30, height: 30, fills: [solid('#0066FF')] }),
    ),
  },

  // ── Contrast Minimum ────────────────────────────────────
  {
    rule: 'contrastMinimum',
    factory: () => contrastMinimum(4.5),
    // Black text on white background → high contrast
    pass: frame({ width: 400, height: 200, fills: [solid('#FFFFFF')] },
      text('Readable', { x: 10, y: 10, width: 200, height: 30, fontSize: 16, fills: [solid('#000000')] }),
    ),
    // Light gray text on white background → low contrast
    fail: frame({ width: 400, height: 200, fills: [solid('#FFFFFF')] },
      text('Hard to read', { x: 10, y: 10, width: 200, height: 30, fontSize: 16, fills: [solid('#CCCCCC')] }),
    ),
  },

  // ── Visual Hierarchy ────────────────────────────────────
  {
    rule: 'visualHierarchy',
    factory: visualHierarchy,
    // Clear hierarchy: 32px title, 14px body
    pass: frame({ width: 400, height: 400 },
      text('Title', { x: 10, y: 10, width: 300, height: 50, fontSize: 32 }),
      text('Body text here', { x: 10, y: 200, width: 300, height: 30, fontSize: 14 }),
    ),
    // Flat hierarchy: all text same size, 3+ nodes
    fail: frame({ width: 400, height: 400 },
      text('Line A', { x: 10, y: 10, width: 300, height: 30, fontSize: 16 }),
      text('Line B', { x: 10, y: 50, width: 300, height: 30, fontSize: 16 }),
      text('Line C', { x: 10, y: 250, width: 300, height: 30, fontSize: 16 }),
    ),
  },

  // ── Content Density ─────────────────────────────────────
  {
    rule: 'contentDensity',
    factory: contentDensity,
    // Small format with minimal text
    pass: frame({ width: 150, height: 150 },
      text('OK', { x: 10, y: 10, width: 100, height: 30, fontSize: 14 }),
    ),
    // Tiny format stuffed with text (>30 chars in <200px)
    fail: frame({ width: 150, height: 150 },
      text('This has way too many characters for such a small area wow', { x: 5, y: 5, width: 140, height: 30, fontSize: 10 }),
    ),
  },

  // ── Visual Balance ──────────────────────────────────────
  {
    rule: 'visualBalance',
    factory: visualBalance,
    // Content spread across the frame
    pass: frame({ width: 400, height: 400 },
      rect({ x: 50, y: 50, width: 100, height: 100, fills: [solid('#FF0000')] }),
      rect({ x: 250, y: 250, width: 100, height: 100, fills: [solid('#0000FF')] }),
    ),
    // All 3 elements crammed in top-left corner
    fail: frame({ width: 400, height: 400 },
      rect({ x: 5, y: 5, width: 50, height: 50, fills: [solid('#FF0000')] }),
      rect({ x: 10, y: 60, width: 50, height: 50, fills: [solid('#00FF00')] }),
      rect({ x: 15, y: 115, width: 50, height: 50, fills: [solid('#0000FF')] }),
    ),
  },

  // ── CTA Visibility ──────────────────────────────────────
  {
    rule: 'ctaVisibility',
    factory: ctaVisibility,
    // Big, visible button frame containing text — well within bounds
    pass: frame({ width: 400, height: 400 },
      frame({ name: 'button-cta', x: 100, y: 300, width: 200, height: 50, fills: [solid('#0066FF')] },
        text('Click', { x: 0, y: 0, width: 200, height: 50, fontSize: 16 }),
      ),
    ),
    // Button frame extends outside the root frame
    fail: frame({ width: 400, height: 400 },
      frame({ name: 'button-cta', x: 350, y: 380, width: 200, height: 50, fills: [solid('#0066FF')] },
        text('Click', { x: 0, y: 0, width: 200, height: 50, fontSize: 16 }),
      ),
    ),
  },

  // ── Export Fidelity ─────────────────────────────────────
  {
    rule: 'exportFidelity',
    factory: exportFidelity,
    // Well-formed text node with content
    pass: frame({ width: 400, height: 200 },
      text('Hello', { x: 10, y: 10, width: 200, height: 30, fontSize: 16 }),
    ),
    // Text node with empty content
    fail: frame({ width: 400, height: 200 },
      text('', { x: 10, y: 10, width: 200, height: 30, fontSize: 16 }),
    ),
  },

  // ── Font In Palette (DS-dependent) ──────────────────────
  {
    rule: 'fontInPalette',
    factory: fontInPalette,
    designSystem: {
      typography: { hierarchy: [{ role: 'body', fontSize: 16, fontFamily: 'Inter', fontWeight: 400 }] },
    },
    pass: frame({ width: 400, height: 200 },
      text('On-brand', { x: 10, y: 10, width: 200, height: 30, fontSize: 16, fontFamily: 'Inter' }),
    ),
    fail: frame({ width: 400, height: 200 },
      text('Off-brand', { x: 10, y: 10, width: 200, height: 30, fontSize: 16, fontFamily: 'Comic Sans' }),
    ),
  },

  // ── Color In Palette (DS-dependent) ─────────────────────
  {
    rule: 'colorInPalette',
    factory: () => colorInPalette(0.05),
    designSystem: {
      colors: { roles: new Map([['primary', '#0066FF'], ['secondary', '#FF6600'], ['text', '#000000']]) },
    },
    pass: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, fills: [solid('#0066FF')] }),
    ),
    fail: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, fills: [solid('#FF00FF')] }),
    ),
  },

  // ── Font Weight Compliance (DS-dependent) ───────────────
  {
    rule: 'fontWeightCompliance',
    factory: fontWeightCompliance,
    designSystem: {
      typography: { hierarchy: [{ role: 'body', fontSize: 16, fontFamily: 'Inter', fontWeight: 400 }] },
    },
    pass: frame({ width: 400, height: 200 },
      text('Normal weight', { x: 10, y: 10, width: 200, height: 30, fontSize: 16 }),
    ),
    // fontWeight 900 when DS says 400 for this size range
    fail: frame({ width: 400, height: 200 },
      text('Wrong weight', { x: 10, y: 10, width: 200, height: 30, fontSize: 16, fontWeight: 900 }),
    ),
  },

  // ── Border Radius Compliance (DS-dependent) ─────────────
  {
    rule: 'borderRadiusCompliance',
    factory: borderRadiusCompliance,
    designSystem: {
      layout: { borderRadiusScale: [0, 4, 8, 12, 16] },
    },
    pass: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, cornerRadius: 8, fills: [solid('#FF0000')] }),
    ),
    // cornerRadius 10 is not in scale [0,4,8,12,16] and not within 1px of any
    fail: frame({ width: 400, height: 200 },
      rect({ x: 10, y: 10, width: 100, height: 100, cornerRadius: 10, fills: [solid('#FF0000')] }),
    ),
  },

  // ── Spacing Grid Compliance (DS-dependent) ──────────────
  {
    rule: 'spacingGridCompliance',
    factory: spacingGridCompliance,
    designSystem: {
      layout: { spacingUnit: 8 },
    },
    pass: frame({ width: 400, height: 200 },
      rect({ x: 16, y: 24, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
    // x=13 doesn't snap to 8px grid
    fail: frame({ width: 400, height: 200 },
      rect({ x: 13, y: 13, width: 100, height: 100, fills: [solid('#FF0000')] }),
    ),
  },

  // ── Font Size Role Match (DS-dependent) ─────────────────
  {
    rule: 'fontSizeRoleMatch',
    factory: fontSizeRoleMatch,
    designSystem: {
      typography: { hierarchy: [
        { role: 'hero', fontSize: 48, fontFamily: 'Inter', fontWeight: 700 },
        { role: 'body', fontSize: 16, fontFamily: 'Inter', fontWeight: 400 },
      ] },
    },
    pass: frame({ width: 400, height: 200 },
      text('Hero', { x: 10, y: 10, width: 300, height: 60, fontSize: 48 }),
    ),
    // 72px doesn't match any DS role (>25% deviation from 48)
    fail: frame({ width: 400, height: 200 },
      text('Weird size', { x: 10, y: 10, width: 300, height: 80, fontSize: 72 }),
    ),
  },
];
