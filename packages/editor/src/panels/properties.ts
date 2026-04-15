/**
 * Properties Panel — node inspector for the selected node.
 *
 * Shows both OpenPencil properties (fills, strokes, layout, text)
 * and reframe extensions (semantic role, states, responsive, tokens).
 *
 * Renders as HTML string (server-side compatible, no framework).
 * The app.ts mounts this into a side panel DOM element.
 */

import type { SceneNode as OPSceneNode } from '@open-pencil/core';
import type { ReframeExtension } from '../bridge/node-bridge.js';

export interface PropertiesPanelData {
  node: OPSceneNode | null;
  extension: ReframeExtension | null;
  tokenBindings?: Record<string, string>;
}

/** Render the properties panel as HTML string. */
export function renderPropertiesPanel(data: PropertiesPanelData): string {
  if (!data.node) {
    return `<div class="panel-empty">
      <p style="color:#666;font-size:12px;text-align:center;padding:24px;">
        Select a node to inspect
      </p>
    </div>`;
  }

  const n = data.node;
  const ext = data.extension;
  const sections: string[] = [];

  // ── Identity ──
  sections.push(section('Identity', [
    row('Name', n.name),
    row('Type', n.type),
    row('ID', `<code style="font-size:10px;color:#888;">${n.id}</code>`),
  ]));

  // ── Transform ──
  sections.push(section('Position & Size', [
    rowPair('X', fmt(n.x), 'Y', fmt(n.y)),
    rowPair('W', fmt(n.width), 'H', fmt(n.height)),
    n.rotation !== 0 ? row('Rotation', `${fmt(n.rotation)}deg`) : '',
  ]));

  // ── Layout ──
  if (n.layoutMode !== 'NONE') {
    sections.push(section('Layout', [
      row('Mode', n.layoutMode),
      row('Primary', n.primaryAxisAlign),
      row('Counter', n.counterAxisAlign),
      row('Sizing', `${n.primaryAxisSizing} / ${n.counterAxisSizing}`),
      row('Gap', `${n.itemSpacing}px`),
      row('Padding', `${n.paddingTop} ${n.paddingRight} ${n.paddingBottom} ${n.paddingLeft}`),
      n.layoutWrap === 'WRAP' ? row('Wrap', 'Yes') : '',
    ]));
  }

  // ── Fills ──
  if (n.fills.length > 0) {
    const fillRows = n.fills.filter(f => f.visible).map((f, i) => {
      if (f.type === 'SOLID') {
        const hex = colorToHex(f.color);
        return row(`Fill ${i + 1}`, `<span style="display:inline-flex;align-items:center;gap:6px;">
          <span style="width:14px;height:14px;border-radius:3px;background:${hex};border:1px solid #333;"></span>
          ${hex} @ ${Math.round(f.opacity * 100)}%
        </span>`);
      }
      return row(`Fill ${i + 1}`, f.type);
    });
    sections.push(section('Fills', fillRows));
  }

  // ── Strokes ──
  if (n.strokes.length > 0) {
    const strokeRows = n.strokes.filter(s => s.visible).map((s, i) => {
      const hex = colorToHex(s.color);
      return row(`Stroke ${i + 1}`, `${hex} ${s.weight}px ${s.align}`);
    });
    sections.push(section('Strokes', strokeRows));
  }

  // ── Text ──
  if (n.text) {
    sections.push(section('Text', [
      row('Content', `<span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${escHtml(n.text.slice(0, 60))}</span>`),
      row('Font', `${n.fontFamily} ${n.fontWeight}`),
      row('Size', `${n.fontSize}px`),
      n.lineHeight != null ? row('Line H', `${n.lineHeight}`) : '',
      n.letterSpacing !== 0 ? row('Tracking', `${n.letterSpacing}px`) : '',
      row('Align', n.textAlignHorizontal),
    ]));
  }

  // ── Effects ──
  if (n.effects.length > 0) {
    const effectRows = n.effects.filter(e => e.visible).map((e, i) =>
      row(`Effect ${i + 1}`, `${e.type} r=${e.radius} s=${e.spread}`)
    );
    sections.push(section('Effects', effectRows));
  }

  // ── Corner Radius ──
  if (n.cornerRadius > 0 || n.independentCorners) {
    sections.push(section('Corners', [
      n.independentCorners
        ? row('Radius', `${n.topLeftRadius} ${n.topRightRadius} ${n.bottomRightRadius} ${n.bottomLeftRadius}`)
        : row('Radius', `${n.cornerRadius}px`),
    ]));
  }

  // ── Reframe Extensions ──
  if (ext) {
    const extRows: string[] = [];
    if (ext.semanticRole) extRows.push(row('Role', `<span style="color:#22c55e;">${ext.semanticRole}</span>`));
    if (ext.href) extRows.push(row('Link', ext.href));
    if (ext.states && Object.keys(ext.states).length > 0) {
      extRows.push(row('States', Object.keys(ext.states).join(', ')));
    }
    if (ext.responsive && ext.responsive.length > 0) {
      extRows.push(row('Responsive', `${ext.responsive.length} breakpoint(s)`));
    }
    if (ext.fontFeatureSettings && ext.fontFeatureSettings.length > 0) {
      extRows.push(row('OpenType', ext.fontFeatureSettings.join(', ')));
    }
    if (ext.meta?.tokenBindings) {
      const bindings = Object.entries(ext.meta.tokenBindings)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
      if (bindings.length > 0) extRows.push(row('Tokens', bindings.join(', ')));
    }
    if (ext.meta?.sourceTag) {
      extRows.push(row('Source', `&lt;${ext.meta.sourceTag}&gt;${ext.meta.sourceClass ? ` .${ext.meta.sourceClass}` : ''}`));
    }
    if (extRows.length > 0) {
      sections.push(section('reframe', extRows));
    }
  }

  return sections.filter(Boolean).join('');
}

// ─── Helpers ──────────────────────────────────────────────

function section(title: string, rows: string[]): string {
  const content = rows.filter(Boolean).join('');
  if (!content) return '';
  return `<div style="border-bottom:1px solid #222;padding:12px 0;">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${title}</div>
    ${content}
  </div>`;
}

function row(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;">
    <span style="color:#888;">${label}</span>
    <span style="color:#e5e5e5;">${value}</span>
  </div>`;
}

function rowPair(l1: string, v1: string, l2: string, v2: string): string {
  return `<div style="display:flex;gap:12px;">
    <div style="flex:1;display:flex;justify-content:space-between;font-size:12px;">
      <span style="color:#888;">${l1}</span><span style="color:#e5e5e5;">${v1}</span>
    </div>
    <div style="flex:1;display:flex;justify-content:space-between;font-size:12px;">
      <span style="color:#888;">${l2}</span><span style="color:#e5e5e5;">${v2}</span>
    </div>
  </div>`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function colorToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
