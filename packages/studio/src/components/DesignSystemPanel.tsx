/**
 * Design System Panel — load DESIGN.md, show tokens, enforce via audit.
 * Now with 15 curated brand presets from top companies.
 */

import { useState, useCallback, useRef } from 'react';
import { useSceneStore } from '../store/scene';
import { DESIGN_PRESETS, PRESET_CATEGORIES } from '../data/design-presets';
import type { DesignPreset } from '../data/design-presets';

export function DesignSystemPanel() {
  const designSystem = useSceneStore(s => s.designSystem);
  const loadDesignMd = useSceneStore(s => s.loadDesignMd);
  const [showEditor, setShowEditor] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [mdText, setMdText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleLoad = useCallback(() => {
    if (mdText.trim()) { loadDesignMd(mdText); setShowEditor(false); }
  }, [mdText, loadDesignMd]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const t = reader.result as string; setMdText(t); loadDesignMd(t); };
    reader.readAsText(file);
    e.target.value = '';
  }, [loadDesignMd]);

  const handlePreset = useCallback((preset: DesignPreset) => {
    loadDesignMd(preset.markdown);
    setMdText(preset.markdown);
    setShowPresets(false);
  }, [loadDesignMd]);

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div className="panel-header">
        <span>Design System</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? 'Close' : 'Presets'}
          </button>
          <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => fileRef.current?.click()}>Load</button>
          <button className="toolbar__btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setShowEditor(!showEditor)}>
            {showEditor ? 'Close' : 'Paste'}
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".md,.txt" style={{ display: 'none' }} onChange={handleFile} />

      {/* Presets picker */}
      {showPresets && (
        <div style={{ padding: '8px 12px', maxHeight: 300, overflowY: 'auto' }}>
          {PRESET_CATEGORIES.map(cat => {
            const presets = DESIGN_PRESETS.filter(p => p.category === cat.id);
            if (presets.length === 0) return null;
            return (
              <div key={cat.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
                  {cat.label}
                </div>
                {presets.map(preset => (
                  <div
                    key={preset.name}
                    className="preset-item"
                    onClick={() => handlePreset(preset)}
                    style={{
                      padding: '5px 8px',
                      cursor: 'pointer',
                      borderRadius: 4,
                      marginBottom: 2,
                      transition: 'background 100ms',
                      border: designSystem?.brand === preset.name ? '1px solid var(--accent)' : '1px solid transparent',
                      background: designSystem?.brand === preset.name ? 'var(--accent-dim)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (designSystem?.brand !== preset.name) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (designSystem?.brand !== preset.name) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{preset.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{preset.description}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Editor */}
      {showEditor && (
        <div style={{ padding: '8px 12px' }}>
          <textarea
            className="prop-input" rows={6} placeholder="Paste DESIGN.md content here..."
            value={mdText} onChange={e => setMdText(e.target.value)}
            style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 10, resize: 'vertical' }}
          />
          <button className="toolbar__btn toolbar__btn--primary" onClick={handleLoad} style={{ marginTop: 4, width: '100%' }}>
            Apply Design System
          </button>
        </div>
      )}

      {/* Active design system display */}
      {designSystem && (
        <div style={{ padding: '8px 12px', fontSize: 11 }}>
          {designSystem.brand && (
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-accent)', marginBottom: 6 }}>
              {designSystem.brand}
            </div>
          )}

          {/* Colors */}
          {designSystem.colors && (
            <div style={{ marginBottom: 8 }}>
              <div className="prop-section__title">Colors</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {designSystem.colors.primary && <ColorChip color={designSystem.colors.primary} label="primary" />}
                {designSystem.colors.accent && <ColorChip color={designSystem.colors.accent} label="accent" />}
                {designSystem.colors.background && <ColorChip color={designSystem.colors.background} label="bg" />}
                {designSystem.colors.text && <ColorChip color={designSystem.colors.text} label="text" />}
                {Array.from(designSystem.colors.roles.entries()).slice(0, 8).map(([role, color]) => (
                  <ColorChip key={role} color={color} label={role} />
                ))}
              </div>
            </div>
          )}

          {/* Typography */}
          {designSystem.typography?.hierarchy?.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="prop-section__title">Typography</div>
              {designSystem.typography.hierarchy.slice(0, 5).map((t, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', padding: '1px 0', fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: 'var(--text-accent)', minWidth: 48, display: 'inline-block' }}>{t.role ?? 'body'}</span>
                  {' '}{t.fontSize}px w{t.fontWeight ?? 400}
                  {t.letterSpacing ? ` ls${t.letterSpacing}px` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Layout */}
          {designSystem.layout && (
            <div>
              <div className="prop-section__title">Layout</div>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                grid: {designSystem.layout.spacingUnit}px
                {designSystem.layout.borderRadiusScale?.length > 0 && (
                  <> · r: {designSystem.layout.borderRadiusScale.join('/')}</>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!designSystem && !showEditor && !showPresets && (
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
          Load a DESIGN.md or choose a preset
        </div>
      )}
    </div>
  );
}

function ColorChip({ color, label }: { color: string; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <div
        style={{
          width: 18, height: 18, borderRadius: 3,
          background: color,
          border: '1px solid var(--border)',
        }}
        title={`${label ?? ''} ${color}`}
      />
      {label && <span style={{ fontSize: 8, color: 'var(--text-muted)', maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  );
}
