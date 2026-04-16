/**
 * Properties Panel — interactive node inspector for the selected node.
 *
 * Shows both OpenPencil properties (fills, strokes, layout, text)
 * and reframe extensions (semantic role, states, responsive, tokens).
 *
 * All numeric/text/color inputs call editor.updateNode() on change.
 */

import type { SceneNode as OPSceneNode } from '@open-pencil/core';
import type { ReframeExtension } from '../bridge/node-bridge.js';

export interface PropertiesPanelData {
  node: OPSceneNode | null;
  extension: ReframeExtension | null;
  tokenBindings?: Record<string, string>;
}

/** Render the properties panel as HTML string with editable inputs. */
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
    inputRow('Name', 'name', n.name, 'text'),
    readonlyRow('Type', n.type),
    readonlyRow('ID', `<code style="font-size:10px;color:#888;">${n.id}</code>`),
  ]));

  // ── Transform ──
  sections.push(section('Position & Size', [
    inputPairRow('X', 'x', n.x, 'Y', 'y', n.y),
    inputPairRow('W', 'width', n.width, 'H', 'height', n.height),
    inputRow('Rotation', 'rotation', n.rotation, 'number', '°'),
  ]));

  // ── Opacity ──
  sections.push(section('Appearance', [
    inputRow('Opacity', 'opacity', Math.round(n.opacity * 100), 'number', '%'),
    n.visible !== undefined
      ? checkboxRow('Visible', 'visible', n.visible)
      : '',
  ]));

  // ── Corner Radius ──
  if (n.cornerRadius > 0 || n.independentCorners) {
    sections.push(section('Corners', [
      n.independentCorners
        ? [
            inputPairRow('TL', 'topLeftRadius', n.topLeftRadius, 'TR', 'topRightRadius', n.topRightRadius),
            inputPairRow('BL', 'bottomLeftRadius', n.bottomLeftRadius, 'BR', 'bottomRightRadius', n.bottomRightRadius),
          ].join('')
        : inputRow('Radius', 'cornerRadius', n.cornerRadius, 'number', 'px'),
    ]));
  }

  // ── Layout ──
  if (n.layoutMode !== 'NONE') {
    sections.push(section('Layout', [
      selectRow('Mode', 'layoutMode', n.layoutMode, ['HORIZONTAL', 'VERTICAL', 'NONE']),
      selectRow('Main Axis', 'primaryAxisAlign', n.primaryAxisAlign, ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN']),
      selectRow('Cross Axis', 'counterAxisAlign', n.counterAxisAlign, ['MIN', 'CENTER', 'MAX', 'STRETCH']),
      inputRow('Gap', 'itemSpacing', n.itemSpacing, 'number', 'px'),
      paddingRow(n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft),
      checkboxRow('Wrap', 'layoutWrap', n.layoutWrap === 'WRAP'),
    ]));
  }

  // ── Fills ──
  if (n.fills.length > 0) {
    const fillRows = n.fills.filter(f => f.visible).map((f, i) => {
      if (f.type === 'SOLID') {
        const hex = colorToHex(f.color);
        return colorRow(`Fill ${i + 1}`, `fill-${i}-color`, hex, `fill-${i}-opacity`, Math.round(f.opacity * 100));
      }
      return readonlyRow(`Fill ${i + 1}`, f.type);
    });
    sections.push(section('Fills', fillRows));
  }

  // ── Strokes ──
  if (n.strokes.length > 0) {
    const strokeRows = n.strokes.filter(s => s.visible).map((s, i) => {
      const hex = colorToHex(s.color);
      return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;">
        <span style="color:#888;flex-shrink:0;">Stroke ${i + 1}</span>
        <input type="color" value="${hex}" data-prop="stroke-${i}-color"
          style="width:24px;height:20px;border:none;background:transparent;cursor:pointer;padding:0;">
        <input type="number" value="${s.weight ?? 1}" data-prop="stroke-${i}-weight"
          class="prop-input" style="width:40px;" step="1" min="0">
      </div>`;
    });
    sections.push(section('Strokes', strokeRows));
  }

  // ── Text ──
  if (n.text) {
    sections.push(section('Text', [
      textAreaRow('Content', 'text', n.text.slice(0, 200)),
      inputRow('Size', 'fontSize', n.fontSize, 'number', 'px'),
      inputRow('Font', 'fontFamily', n.fontFamily, 'text'),
      selectRow('Weight', 'fontWeight', String(n.fontWeight), ['100','200','300','400','500','600','700','800','900']),
      n.lineHeight != null ? inputRow('Line H', 'lineHeight', n.lineHeight, 'number') : '',
      n.letterSpacing !== 0 || true ? inputRow('Tracking', 'letterSpacing', n.letterSpacing, 'number', 'px') : '',
      selectRow('Align', 'textAlignHorizontal', n.textAlignHorizontal, ['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED']),
    ]));
  }

  // ── Effects ──
  if (n.effects.length > 0) {
    const effectRows = n.effects.filter(e => e.visible).map((e, i) =>
      readonlyRow(`Effect ${i + 1}`, `${e.type} r=${e.radius} s=${e.spread}`)
    );
    sections.push(section('Effects', effectRows));
  }

  // ── Reframe Extensions ──
  if (ext) {
    const extRows: string[] = [];
    if (ext.semanticRole) extRows.push(readonlyRow('Role', `<span style="color:#22c55e;">${ext.semanticRole}</span>`));
    if (ext.href) extRows.push(inputRow('Link', 'ext-href', ext.href, 'text'));
    if (ext.states && Object.keys(ext.states).length > 0) {
      extRows.push(readonlyRow('States', Object.keys(ext.states).join(', ')));
    }
    if (ext.responsive && ext.responsive.length > 0) {
      extRows.push(readonlyRow('Responsive', `${ext.responsive.length} breakpoint(s)`));
    }
    if (ext.fontFeatureSettings && ext.fontFeatureSettings.length > 0) {
      extRows.push(readonlyRow('OpenType', ext.fontFeatureSettings.join(', ')));
    }
    if (ext.meta?.tokenBindings) {
      const bindings = Object.entries(ext.meta.tokenBindings)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`);
      if (bindings.length > 0) extRows.push(readonlyRow('Tokens', bindings.join(', ')));
    }
    if (ext.meta?.sourceTag) {
      extRows.push(readonlyRow('Source', `&lt;${ext.meta.sourceTag}&gt;${ext.meta.sourceClass ? ` .${ext.meta.sourceClass}` : ''}`));
    }
    if (extRows.length > 0) {
      sections.push(section('reframe', extRows));
    }
  }

  return `<div data-node-id="${n.id}">${sections.filter(Boolean).join('')}</div>`;
}

// ─── Input Row Helpers ───────────────────────────────────

function inputRow(label: string, prop: string, value: string | number, type: 'text' | 'number', suffix?: string): string {
  const inputType = type === 'number' ? 'number' : 'text';
  const displayVal = type === 'number' ? fmt(value as number) : escHtml(String(value));
  const step = type === 'number' ? ' step="1"' : '';
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;">
    <span style="color:#888;flex-shrink:0;">${label}</span>
    <div style="display:flex;align-items:center;gap:2px;">
      <input type="${inputType}" value="${displayVal}" data-prop="${prop}"
        class="prop-input" style="width:${type === 'number' ? '60px' : '100px'};"${step}>
      ${suffix ? `<span style="color:#555;font-size:10px;">${suffix}</span>` : ''}
    </div>
  </div>`;
}

function inputPairRow(l1: string, p1: string, v1: number, l2: string, p2: string, v2: number): string {
  return `<div style="display:flex;gap:8px;">
    <div style="flex:1;display:flex;align-items:center;gap:4px;font-size:12px;">
      <span style="color:#888;width:14px;flex-shrink:0;">${l1}</span>
      <input type="number" value="${fmt(v1)}" data-prop="${p1}" class="prop-input" style="width:100%;" step="1">
    </div>
    <div style="flex:1;display:flex;align-items:center;gap:4px;font-size:12px;">
      <span style="color:#888;width:14px;flex-shrink:0;">${l2}</span>
      <input type="number" value="${fmt(v2)}" data-prop="${p2}" class="prop-input" style="width:100%;" step="1">
    </div>
  </div>`;
}

function selectRow(label: string, prop: string, current: string, options: string[]): string {
  const opts = options.map(o =>
    `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`
  ).join('');
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;">
    <span style="color:#888;">${label}</span>
    <select data-prop="${prop}" class="prop-select">${opts}</select>
  </div>`;
}

function colorRow(label: string, colorProp: string, hex: string, opacityProp: string, opacityVal: number): string {
  return `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;">
    <span style="color:#888;flex-shrink:0;">${label}</span>
    <div style="display:flex;align-items:center;gap:4px;margin-left:auto;">
      <input type="color" value="${hex}" data-prop="${colorProp}"
        style="width:24px;height:20px;border:none;background:transparent;cursor:pointer;padding:0;">
      <input type="text" value="${hex}" data-prop="${colorProp}" data-color-text="1"
        class="prop-input" style="width:62px;font-family:var(--mono);font-size:10px;">
      <input type="number" value="${opacityVal}" data-prop="${opacityProp}"
        class="prop-input" style="width:36px;" min="0" max="100" step="1">
      <span style="color:#555;font-size:10px;">%</span>
    </div>
  </div>`;
}

function checkboxRow(label: string, prop: string, checked: boolean): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;">
    <span style="color:#888;">${label}</span>
    <input type="checkbox" data-prop="${prop}" ${checked ? 'checked' : ''}
      style="accent-color:var(--accent);cursor:pointer;">
  </div>`;
}

function textAreaRow(label: string, prop: string, value: string): string {
  return `<div style="padding:2px 0;font-size:12px;">
    <div style="color:#888;margin-bottom:4px;">${label}</div>
    <textarea data-prop="${prop}" class="prop-textarea" rows="2">${escHtml(value)}</textarea>
  </div>`;
}

function paddingRow(top: number, right: number, bottom: number, left: number): string {
  return `<div style="font-size:12px;padding:2px 0;">
    <span style="color:#888;">Padding</span>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-top:4px;">
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <span style="color:#555;font-size:9px;">T</span>
        <input type="number" value="${top}" data-prop="paddingTop" class="prop-input" style="width:100%;text-align:center;" step="1" min="0">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <span style="color:#555;font-size:9px;">R</span>
        <input type="number" value="${right}" data-prop="paddingRight" class="prop-input" style="width:100%;text-align:center;" step="1" min="0">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <span style="color:#555;font-size:9px;">B</span>
        <input type="number" value="${bottom}" data-prop="paddingBottom" class="prop-input" style="width:100%;text-align:center;" step="1" min="0">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <span style="color:#555;font-size:9px;">L</span>
        <input type="number" value="${left}" data-prop="paddingLeft" class="prop-input" style="width:100%;text-align:center;" step="1" min="0">
      </div>
    </div>
  </div>`;
}

function readonlyRow(label: string, value: string): string {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:12px;">
    <span style="color:#888;">${label}</span>
    <span style="color:#e5e5e5;">${value}</span>
  </div>`;
}

// ─── Section Wrapper ─────────────────────────────────────

function section(title: string, rows: string[]): string {
  const content = rows.filter(Boolean).join('');
  if (!content) return '';
  return `<div style="border-bottom:1px solid #222;padding:12px 0;">
    <div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${title}</div>
    ${content}
  </div>`;
}

// ─── Helpers ─────────────────────────────────────────────

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function colorToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: 1,
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Event Handler Setup ─────────────────────────────────

export interface PropertiesHandlerContext {
  getSelectedNode: () => OPSceneNode | null;
  updateNode: (id: string, props: Record<string, any>) => void;
  requestRender: () => void;
  onGraphChanged?: () => void;
}

/**
 * Attach change/input event listeners to the properties panel.
 * Call this after setting innerHTML with renderPropertiesPanel().
 */
export function setupPropertiesHandlers(
  container: HTMLElement,
  ctx: PropertiesHandlerContext,
): void {
  const panelRoot = container.querySelector<HTMLElement>('[data-node-id]');
  if (!panelRoot) return;
  const nodeId = panelRoot.dataset.nodeId!;

  // Debounce helper for continuous inputs (drag color picker, etc.)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function debounceUpdate(props: Record<string, any>) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      ctx.updateNode(nodeId, props);
      ctx.requestRender();
      ctx.onGraphChanged?.();
    }, 16);
  }

  // ── Number inputs (x, y, width, height, rotation, fontSize, etc.) ──
  container.querySelectorAll<HTMLInputElement>('input[type="number"][data-prop]').forEach(input => {
    const prop = input.dataset.prop!;

    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      if (isNaN(val)) return;

      const update = resolveNumericProp(prop, val, nodeId, ctx);
      if (update) {
        ctx.updateNode(nodeId, update);
        ctx.requestRender();
        ctx.onGraphChanged?.();
      }
    });

    // Arrow key nudge: update on keydown for responsive feel
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Let the browser update the value first
        requestAnimationFrame(() => {
          const val = parseFloat(input.value);
          if (isNaN(val)) return;
          const update = resolveNumericProp(prop, val, nodeId, ctx);
          if (update) debounceUpdate(update);
        });
      }
    });
  });

  // ── Text inputs (name, fontFamily) ──
  container.querySelectorAll<HTMLInputElement>('input[type="text"][data-prop]').forEach(input => {
    const prop = input.dataset.prop!;
    if (input.dataset.colorText) return; // handled by color section

    input.addEventListener('change', () => {
      const val = input.value;
      ctx.updateNode(nodeId, { [prop]: val });
      ctx.requestRender();
      ctx.onGraphChanged?.();
    });
  });

  // ── Textarea (text content) ──
  container.querySelectorAll<HTMLTextAreaElement>('textarea[data-prop]').forEach(ta => {
    const prop = ta.dataset.prop!;

    ta.addEventListener('change', () => {
      ctx.updateNode(nodeId, { [prop]: ta.value });
      ctx.requestRender();
      ctx.onGraphChanged?.();
    });
  });

  // ── Select dropdowns ──
  container.querySelectorAll<HTMLSelectElement>('select[data-prop]').forEach(sel => {
    const prop = sel.dataset.prop!;

    sel.addEventListener('change', () => {
      let val: string | number = sel.value;
      // fontWeight should be numeric
      if (prop === 'fontWeight') val = parseInt(val, 10);
      // layoutWrap is boolean-ish
      if (prop === 'layoutWrap') {
        ctx.updateNode(nodeId, { layoutWrap: sel.value });
      } else {
        ctx.updateNode(nodeId, { [prop]: val });
      }
      ctx.requestRender();
      ctx.onGraphChanged?.();
    });
  });

  // ── Checkboxes (visible, layoutWrap) ──
  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-prop]').forEach(cb => {
    const prop = cb.dataset.prop!;

    cb.addEventListener('change', () => {
      let val: any = cb.checked;
      if (prop === 'layoutWrap') val = cb.checked ? 'WRAP' : 'NO_WRAP';
      ctx.updateNode(nodeId, { [prop]: val });
      ctx.requestRender();
      ctx.onGraphChanged?.();
    });
  });

  // ── Color pickers ──
  container.querySelectorAll<HTMLInputElement>('input[type="color"][data-prop]').forEach(picker => {
    const prop = picker.dataset.prop!;

    picker.addEventListener('input', () => {
      const hex = picker.value;
      // Sync the text input sibling
      const textInput = container.querySelector<HTMLInputElement>(
        `input[type="text"][data-prop="${prop}"][data-color-text]`
      );
      if (textInput) textInput.value = hex;

      const update = resolveColorProp(prop, hex, nodeId, ctx);
      if (update) debounceUpdate(update);
    });
  });

  // ── Color text inputs (hex value typed manually) ──
  container.querySelectorAll<HTMLInputElement>('input[type="text"][data-color-text]').forEach(input => {
    const prop = input.dataset.prop!;

    input.addEventListener('change', () => {
      let hex = input.value.trim();
      if (!hex.startsWith('#')) hex = '#' + hex;
      if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return; // invalid hex

      // Sync color picker
      const picker = container.querySelector<HTMLInputElement>(
        `input[type="color"][data-prop="${prop}"]`
      );
      if (picker) picker.value = hex;

      const update = resolveColorProp(prop, hex, nodeId, ctx);
      if (update) {
        ctx.updateNode(nodeId, update);
        ctx.requestRender();
        ctx.onGraphChanged?.();
      }
    });
  });

  // ── Fill/Stroke opacity ──
  container.querySelectorAll<HTMLInputElement>('input[type="number"][data-prop$="-opacity"]').forEach(input => {
    const prop = input.dataset.prop!;

    // Override the generic handler — remove and re-add
    input.addEventListener('change', () => {
      const val = parseFloat(input.value);
      if (isNaN(val)) return;

      const update = resolveOpacityProp(prop, val, nodeId, ctx);
      if (update) {
        ctx.updateNode(nodeId, update);
        ctx.requestRender();
        ctx.onGraphChanged?.();
      }
    });
  });
}

// ─── Property Resolution ─────────────────────────────────

/** Resolve a numeric property change into an updateNode props object. */
function resolveNumericProp(
  prop: string,
  val: number,
  nodeId: string,
  ctx: PropertiesHandlerContext,
): Record<string, any> | null {
  // Node-level opacity is stored as 0..1 but shown as 0..100
  if (prop === 'opacity') {
    return { opacity: Math.max(0, Math.min(1, val / 100)) };
  }

  // Fill/stroke weight
  const strokeWeightMatch = prop.match(/^stroke-(\d+)-weight$/);
  if (strokeWeightMatch) {
    const idx = parseInt(strokeWeightMatch[1]);
    const node = ctx.getSelectedNode();
    if (!node) return null;
    const strokes = [...node.strokes];
    if (strokes[idx]) {
      strokes[idx] = { ...strokes[idx], weight: val };
      return { strokes };
    }
    return null;
  }

  // Direct numeric props
  const directNumeric = [
    'x', 'y', 'width', 'height', 'rotation',
    'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
    'fontSize', 'lineHeight', 'letterSpacing',
    'itemSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  ];
  if (directNumeric.includes(prop)) {
    return { [prop]: val };
  }

  return null;
}

/** Resolve a color property change into an updateNode props object. */
function resolveColorProp(
  prop: string,
  hex: string,
  nodeId: string,
  ctx: PropertiesHandlerContext,
): Record<string, any> | null {
  const color = hexToColor(hex);

  // Fill color: fill-N-color
  const fillMatch = prop.match(/^fill-(\d+)-color$/);
  if (fillMatch) {
    const idx = parseInt(fillMatch[1]);
    const node = ctx.getSelectedNode();
    if (!node) return null;
    const fills = [...node.fills];
    if (fills[idx] && fills[idx].type === 'SOLID') {
      fills[idx] = { ...fills[idx], color };
      return { fills };
    }
    return null;
  }

  // Stroke color: stroke-N-color
  const strokeMatch = prop.match(/^stroke-(\d+)-color$/);
  if (strokeMatch) {
    const idx = parseInt(strokeMatch[1]);
    const node = ctx.getSelectedNode();
    if (!node) return null;
    const strokes = [...node.strokes];
    if (strokes[idx]) {
      strokes[idx] = { ...strokes[idx], color };
      return { strokes };
    }
    return null;
  }

  return null;
}

/** Resolve a fill/stroke opacity change. */
function resolveOpacityProp(
  prop: string,
  val: number,
  nodeId: string,
  ctx: PropertiesHandlerContext,
): Record<string, any> | null {
  const opacity = Math.max(0, Math.min(1, val / 100));

  // fill-N-opacity
  const fillMatch = prop.match(/^fill-(\d+)-opacity$/);
  if (fillMatch) {
    const idx = parseInt(fillMatch[1]);
    const node = ctx.getSelectedNode();
    if (!node) return null;
    const fills = [...node.fills];
    if (fills[idx]) {
      fills[idx] = { ...fills[idx], opacity };
      return { fills };
    }
    return null;
  }

  return null;
}
