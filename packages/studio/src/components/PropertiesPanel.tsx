/**
 * Properties Inspector — DevTools for INode.
 *
 * Shows ALL properties of selected node: identity, transform, layout,
 * visual, text, audit issues. Editable inline.
 */

import { useCallback } from 'react';
import type { SceneNode } from '@reframe/core/engine/types';
import { useSceneStore } from '../store/scene';

export function PropertiesPanel() {
  const activeArtboardId = useSceneStore(s => s.activeArtboardId);
  const artboards = useSceneStore(s => s.artboards);
  const graphTop = useSceneStore(s => s.graph);
  const selectedIds = useSceneStore(s => s.selectedIds);
  const auditIssues = useSceneStore(s => s.auditIssues);

  const ab = artboards.find(a => a.id === activeArtboardId);
  const graph = ab?.graph ?? graphTop;
  const node = selectedIds.length === 1 ? graph?.getNode(selectedIds[0]) : null;

  const patch = useCallback((field: string, value: any) => {
    const st = useSceneStore.getState();
    const row = st.artboards.find(a => a.id === st.activeArtboardId);
    const g = row?.graph ?? st.graph;
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
    const row = st.artboards.find(a => a.id === st.activeArtboardId);
    const doc = row?.graph ?? st.graph;
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
      <div>
        <div className="panel-header">Inspector</div>
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
          {selectedIds.length === 0 ? 'Select a node to inspect' : `${selectedIds.length} nodes selected`}
        </div>
      </div>
    );
  }

  const fill = node.fills?.find(f => f.visible && f.type === 'SOLID');
  let fillHex = '';
  try {
    if (fill?.color) fillHex = `#${toHex(fill.color.r)}${toHex(fill.color.g)}${toHex(fill.color.b)}`;
  } catch {}

  const nodeIssues = auditIssues.filter(i => i.nodeId === node.id);
  const childCount = node.childIds?.length ?? 0;

  return (
    <div>
      <div className="panel-header">Inspector</div>

      {/* Identity */}
      <Section title={`${node.type} · ${childCount} children`}>
        <Row label="Name">
          <input className="prop-input" value={node.name} onChange={e => strChange('name', e.target.value)} spellCheck={false} />
        </Row>
        <Row label="ID"><span className="prop-value">{node.id}</span></Row>
        {node.semanticRole && <Row label="Role"><span className="prop-value">{node.semanticRole}</span></Row>}
      </Section>

      {/* Transform */}
      <Section title="Transform">
        <div className="prop-row">
          <Num label="X" value={node.x} onChange={v => numChange('x', v)} />
          <Num label="Y" value={node.y} onChange={v => numChange('y', v)} />
        </div>
        <div className="prop-row">
          <Num label="W" value={node.width} onChange={v => numChange('width', v)} />
          <Num label="H" value={node.height} onChange={v => numChange('height', v)} />
        </div>
        <div className="prop-row">
          <Num label="R" value={node.rotation ?? 0} onChange={v => numChange('rotation', v)} />
          <Num label="Op" value={node.opacity} onChange={v => numChange('opacity', v)} step={0.1} />
        </div>
      </Section>

      {/* Layout */}
      <Section title="Layout">
        <Row label="Mode"><span className="prop-value">{node.layoutMode}</span></Row>
        {node.layoutMode !== 'NONE' && (<>
          <Row label="Justify"><span className="prop-value">{node.primaryAxisAlign}</span></Row>
          <Row label="Align"><span className="prop-value">{node.counterAxisAlign}</span></Row>
          <Row label="Wrap"><span className="prop-value">{node.layoutWrap}</span></Row>
          <div className="prop-row">
            <Num label="Gap" value={node.itemSpacing} onChange={v => numChange('itemSpacing', v)} />
            <Num label="Cross" value={node.counterAxisSpacing} onChange={v => numChange('counterAxisSpacing', v)} />
          </div>
          <div className="prop-row">
            <Num label="T" value={node.paddingTop} onChange={v => numChange('paddingTop', v)} />
            <Num label="R" value={node.paddingRight} onChange={v => numChange('paddingRight', v)} />
            <Num label="B" value={node.paddingBottom} onChange={v => numChange('paddingBottom', v)} />
            <Num label="L" value={node.paddingLeft} onChange={v => numChange('paddingLeft', v)} />
          </div>
        </>)}
        <Row label="Sizing">
          <span className="prop-value">{node.primaryAxisSizing}/{node.counterAxisSizing}</span>
        </Row>
        <Row label="Grow"><span className="prop-value">{node.layoutGrow}</span></Row>
        <Row label="Self"><span className="prop-value">{node.layoutAlignSelf}</span></Row>
        <Row label="Clip"><span className="prop-value">{node.clipsContent ? 'yes' : 'no'}</span></Row>
      </Section>

      {/* Visual */}
      <Section title="Visual">
        <div className="prop-row">
          <span className="prop-label">Fill</span>
          {fillHex && <div className="prop-color" style={{ background: fillHex }} />}
          <input className="prop-input prop-input--short" value={fillHex || 'none'} onChange={e => fillChange(e.target.value)} style={{ fontSize: 10 }} spellCheck={false} />
        </div>
        <Num label="Radius" value={node.cornerRadius ?? 0} onChange={v => numChange('cornerRadius', v)} />
        {node.strokes?.length > 0 && <Row label="Strokes"><span className="prop-value">{node.strokes.length}</span></Row>}
        {node.effects?.length > 0 && <Row label="Effects"><span className="prop-value">{node.effects.length}</span></Row>}
      </Section>

      {/* Text */}
      {node.type === 'TEXT' && (
        <Section title="Text">
          <div className="prop-row">
            <textarea className="prop-input" rows={2} value={node.text} onChange={e => strChange('text', e.target.value)} style={{ fontFamily: 'var(--font-sans)', resize: 'vertical' }} />
          </div>
          <div className="prop-row">
            <Num label="Size" value={node.fontSize} onChange={v => numChange('fontSize', v)} />
            <Num label="Wt" value={node.fontWeight} onChange={v => numChange('fontWeight', v)} />
          </div>
          <Row label="Font">
            <input className="prop-input" value={node.fontFamily || 'default'} onChange={e => strChange('fontFamily', e.target.value)} style={{ fontSize: 10 }} spellCheck={false} />
          </Row>
          <Row label="Align"><span className="prop-value">{node.textAlignHorizontal}</span></Row>
          {node.lineHeight !== null && <Row label="LH"><span className="prop-value">{node.lineHeight}</span></Row>}
          {node.letterSpacing !== 0 && <Row label="LS"><span className="prop-value">{node.letterSpacing}px</span></Row>}
          <Row label="Resize"><span className="prop-value">{node.textAutoResize}</span></Row>
        </Section>
      )}

      {/* Audit Issues */}
      {nodeIssues.length > 0 && (
        <Section title={`Audit (${nodeIssues.length})`}>
          {nodeIssues.map((issue, i) => (
            <div key={i} style={{ padding: '4px 0', fontSize: 11, color: issue.severity === 'error' ? 'var(--error)' : 'var(--warning)' }}>
              <span style={{ fontWeight: 600 }}>{issue.rule}</span>: {issue.message}
              {issue.fix && <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>Fix: {issue.fix.css ?? JSON.stringify(issue.fix)}</div>}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="prop-section">
      <div className="prop-section__title">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      {children}
    </div>
  );
}

function Num({ label, value, onChange, step }: { label: string; value: number; onChange: (v: string) => void; step?: number }) {
  return (
    <>
      <span className="prop-label">{label}</span>
      <input className="prop-input prop-input--short" type="number" value={Math.round(value * 100) / 100} onChange={e => onChange(e.target.value)} step={step} />
    </>
  );
}

function toHex(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
}
