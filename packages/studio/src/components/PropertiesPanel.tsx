/**
 * Properties Inspector — compact hierarchy: essentials first, details on demand.
 */

import { useCallback, useState, type ReactNode } from 'react';
import type { SceneNode } from '@reframe/core/engine/types';
import { useSceneStore, getActiveArtboard } from '../store/scene';

export function PropertiesPanel() {
  const ab = useSceneStore(s => getActiveArtboard(s));
  const graph = ab?.graph ?? null;
  const selectedIds = useSceneStore(s => s.selectedIds);
  const auditIssues = ab?.auditIssues ?? [];
  const node = selectedIds.length === 1 ? graph?.getNode(selectedIds[0]) : null;

  const patch = useCallback((field: string, value: any) => {
    const st = useSceneStore.getState();
    const g = getActiveArtboard(st)?.graph;
    const id = st.selectedIds[0];
    if (!g || !id || st.selectedIds.length !== 1) return;
    if (!g.getNode(id)) return;
    st.updateNode(id, { [field]: value } as Partial<SceneNode>);
  }, []);

  const numChange = useCallback((field: string, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) patch(field, num);
  }, [patch]);

  const strChange = useCallback((field: string, value: string) => {
    patch(field, value);
  }, [patch]);

  const fillChange = useCallback((hex: string) => {
    const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return;
    const h = m[1];
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const st = useSceneStore.getState();
    const doc = getActiveArtboard(st)?.graph;
    const id = st.selectedIds[0];
    if (!doc || !id) return;
    const n = doc.getNode(id);
    if (!n) return;
    const fills = [...(n.fills?.length ? n.fills : [])];
    const idx = fills.findIndex(f => f.visible && f.type === 'SOLID');
    if (idx >= 0) fills[idx] = { ...fills[idx], color: { r, g, b, a: 1 } };
    else fills.push({ type: 'SOLID' as const, color: { r, g, b, a: 1 }, opacity: 1, visible: true });
    st.updateNode(id, { fills } as Partial<SceneNode>);
  }, []);

  if (!node) {
    return (
      <div className="inspector">
        <div className="inspector__head">Inspector</div>
        <div className="inspector__empty">
          {selectedIds.length === 0 ? 'Select a layer' : `${selectedIds.length} selected`}
        </div>
      </div>
    );
  }

  const fill = node.fills?.find(f => f.visible && f.type === 'SOLID');
  let fillHex = '';
  try {
    if (fill?.color) fillHex = `#${toHex(fill.color.r)}${toHex(fill.color.g)}${toHex(fill.color.b)}`;
  } catch { /* ignore */ }

  const colorPickerValue = normalizeHexForInput(fillHex);

  const nodeIssues = auditIssues.filter(i => i.nodeId === node.id);
  const childCount = node.childIds?.length ?? 0;
  const w = Math.round(node.width);
  const h = Math.round(node.height);
  const hasAutoLayout = node.layoutMode !== 'NONE';

  return (
    <div className="inspector">
      <div className="inspector__head">Inspector</div>

      <div key={node.id} className="inspector__body">
        <div className="inspector__hero">
          <div
            className="inspector__summary"
            title={`${node.type} · ${w}×${h}px · ${childCount} children`}
          >
            <span className="inspector__summary-type">{node.type}</span>
            <span className="inspector__summary-dim">{w}×{h}</span>
            {childCount > 0 && (
              <span className="inspector__summary-kids" title={`${childCount} children`}>{childCount}</span>
            )}
          </div>
          <div className="inspector__name-block">
            <label className="inspector__sr-label" htmlFor={`in-name-${node.id}`}>Name</label>
            <input
              id={`in-name-${node.id}`}
              className="inspector__name-input"
              value={node.name}
              onChange={e => strChange('name', e.target.value)}
              spellCheck={false}
              placeholder="Layer name"
            />
          </div>
        </div>

        <Collapsible title="Appearance" defaultOpen>
          <div className="inspector__fill-row">
            <label className="inspector__swatch-picker" title="Open color picker">
              <input
                type="color"
                className="inspector__color-native"
                value={colorPickerValue}
                onChange={e => fillChange(e.target.value)}
                aria-label="Fill color picker"
              />
              {fillHex ? (
                <span className="inspector__swatch" style={{ background: fillHex }} aria-hidden />
              ) : (
                <span className="inspector__swatch inspector__swatch--empty" aria-hidden />
              )}
            </label>
            <input
              className="inspector__hex"
              value={fillHex || ''}
              onChange={e => fillChange(e.target.value)}
              placeholder="#000000"
              spellCheck={false}
              aria-label="Fill hex"
            />
          </div>
          <div className="inspector__pair">
            <MiniNum
              label="Radius"
              title="Corner radius"
              value={node.cornerRadius ?? 0}
              onChange={v => numChange('cornerRadius', v)}
            />
            <MiniNum
              label="Opacity"
              title="Opacity 0–1"
              value={node.opacity}
              onChange={v => numChange('opacity', v)}
              step={0.05}
            />
          </div>
        </Collapsible>

        <Collapsible title="Transform" defaultOpen>
          <div className="inspector__quad">
            <MiniNum label="X" value={node.x} onChange={v => numChange('x', v)} title="X position" />
            <MiniNum label="Y" value={node.y} onChange={v => numChange('y', v)} title="Y position" />
            <MiniNum label="W" value={node.width} onChange={v => numChange('width', v)} title="Width" />
            <MiniNum label="H" value={node.height} onChange={v => numChange('height', v)} title="Height" />
          </div>
          <div className="inspector__rotate">
            <MiniNum
              label="Rotate°"
              title="Rotation (degrees)"
              value={node.rotation ?? 0}
              onChange={v => numChange('rotation', v)}
            />
          </div>
        </Collapsible>

        <Collapsible title="Layout" defaultOpen>
          {!hasAutoLayout ? (
            <p className="inspector__muted">No auto layout.</p>
          ) : (
            <>
              <ReadRow label="Mode" value={node.layoutMode} />
              <ReadRow label="Flow" value={`${node.primaryAxisAlign} · ${node.counterAxisAlign}`} title="Justify · Align cross-axis" />
              <div className="inspector__pair">
                <MiniNum label="Gap" value={node.itemSpacing} onChange={v => numChange('itemSpacing', v)} title="Space between children" />
                <MiniNum label="Gap⊥" value={node.counterAxisSpacing} onChange={v => numChange('counterAxisSpacing', v)} title="Cross-axis gap" />
              </div>
              <div className="inspector__quad inspector__quad--tight">
                <MiniNum label="T" value={node.paddingTop} onChange={v => numChange('paddingTop', v)} title="Padding top" />
                <MiniNum label="R" value={node.paddingRight} onChange={v => numChange('paddingRight', v)} title="Padding right" />
                <MiniNum label="B" value={node.paddingBottom} onChange={v => numChange('paddingBottom', v)} title="Padding bottom" />
                <MiniNum label="L" value={node.paddingLeft} onChange={v => numChange('paddingLeft', v)} title="Padding left" />
              </div>
            </>
          )}
        </Collapsible>

        {node.type === 'TEXT' && (
          <Collapsible title="Text" defaultOpen>
            <textarea
              className="inspector__textarea"
              rows={2}
              value={node.text}
              onChange={e => strChange('text', e.target.value)}
            />
            <div className="inspector__pair">
              <MiniNum label="Size" value={node.fontSize} onChange={v => numChange('fontSize', v)} title="Font size" />
              <MiniNum label="Weight" value={node.fontWeight} onChange={v => numChange('fontWeight', v)} title="Font weight" />
            </div>
            <label className="inspector__sr-label" htmlFor={`in-font-${node.id}`}>Font</label>
            <input
              id={`in-font-${node.id}`}
              className="inspector__text-input"
              value={node.fontFamily || ''}
              onChange={e => strChange('fontFamily', e.target.value)}
              placeholder="Font family"
              spellCheck={false}
            />
            <ReadRow label="Align" value={String(node.textAlignHorizontal)} />
          </Collapsible>
        )}

        {nodeIssues.length > 0 && (
          <Collapsible title={`Design checks (${nodeIssues.length})`} defaultOpen>
            <ul className="inspector__issues">
              {nodeIssues.map((issue, i) => (
                <li
                  key={i}
                  className={issue.severity === 'error' ? 'inspector__issue inspector__issue--err' : 'inspector__issue'}
                >
                  <span className="inspector__issue-rule">{issue.rule}</span>
                  <span className="inspector__issue-msg">{issue.message}</span>
                  {issue.fix && (
                    <span className="inspector__issue-fix" title={typeof issue.fix.css === 'string' ? issue.fix.css : JSON.stringify(issue.fix)}>
                      Fix available
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        <Collapsible title="Details" defaultOpen={false}>
          <ReadRow label="ID" value={truncateId(node.id)} title={node.id} mono />
          {node.semanticRole && <ReadRow label="Role" value={String(node.semanticRole)} />}
          <ReadRow label="Sizing" value={`${node.primaryAxisSizing} / ${node.counterAxisSizing}`} title="Primary / counter axis sizing" />
          <ReadRow label="Grow" value={String(node.layoutGrow)} />
          <ReadRow label="Align self" value={String(node.layoutAlignSelf)} />
          <ReadRow label="Clip" value={node.clipsContent ? 'Yes' : 'No'} />
          {hasAutoLayout && (
            <>
              <ReadRow label="Wrap" value={String(node.layoutWrap)} />
            </>
          )}
          {(node.strokes?.length ?? 0) > 0 && (
            <ReadRow label="Strokes" value={String(node.strokes?.length)} />
          )}
          {(node.effects?.length ?? 0) > 0 && (
            <ReadRow label="Effects" value={String(node.effects?.length)} />
          )}
          {node.type === 'TEXT' && (
            <>
              {node.lineHeight != null && <ReadRow label="Line height" value={String(node.lineHeight)} />}
              {(node.letterSpacing ?? 0) !== 0 && (
                <ReadRow label="Letter spacing" value={`${node.letterSpacing}px`} />
              )}
              <ReadRow label="Text resize" value={String(node.textAutoResize)} />
            </>
          )}
        </Collapsible>
      </div>
    </div>
  );
}

function Collapsible({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`inspector__block${open ? ' inspector__block--open' : ''}`}>
      <button
        type="button"
        className="inspector__block-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="inspector__block-chev" aria-hidden>{open ? '▼' : '▶'}</span>
        <span className="inspector__block-title">{title}</span>
      </button>
      {open && <div className="inspector__block-body">{children}</div>}
    </div>
  );
}

function ReadRow({
  label,
  value,
  title,
  mono,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="inspector__read" title={title}>
      <span className="inspector__read-label">{label}</span>
      <span className={mono ? 'inspector__read-val inspector__read-val--mono' : 'inspector__read-val'}>{value}</span>
    </div>
  );
}

function MiniNum({
  label,
  value,
  onChange,
  step,
  title,
}:{
  label: string;
  value: number;
  onChange: (v: string) => void;
  step?: number;
  title?: string;
}) {
  return (
    <label className="inspector__mini" title={title}>
      <span className="inspector__mini-label">{label}</span>
      <input
        className="inspector__mini-input"
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={e => onChange(e.target.value)}
        step={step}
      />
    </label>
  );
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function toHex(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
}

/** `input[type=color]` requires #rrggbb. */
function normalizeHexForInput(hex: string): string {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (m) return `#${m[1].toLowerCase()}`;
  return '#808080';
}
