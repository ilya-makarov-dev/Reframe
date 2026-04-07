/**
 * Share Dialog — serialize scene to URL for sharing.
 *
 * Encodes scene JSON + timeline as base64 in URL hash.
 * Also supports JSON file save/load for local workflow.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSceneStore } from '../store/scene';

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const scene = useSceneStore();
  const ab = scene.artboards.find(a => a.id === scene.activeArtboardId);
  const graph = ab ? ab.graph : scene.graph;
  const rootId = ab ? ab.rootId : scene.rootId;
  const { timeline, designMd } = scene;
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [includeTimeline, setIncludeTimeline] = useState(true);
  const [includeDesignSystem, setIncludeDesignSystem] = useState(true);

  useEffect(() => {
    if (!graph || !rootId) return;
    const data = buildShareData(graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem);
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const url = `${window.location.origin}${window.location.pathname}#scene=${encoded}`;
    setShareUrl(url);
  }, [graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleDownloadJson = useCallback(() => {
    if (!graph || !rootId) return;
    const data = buildShareData(graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'reframe-scene.json'; a.click();
    URL.revokeObjectURL(url);
  }, [graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem]);

  if (!graph || !rootId) return null;

  const root = graph.getNode(rootId);
  const dataSize = new Blob([shareUrl]).size;

  return (
    <div className="template-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={e => e.stopPropagation()}>
        <div className="template-gallery__header">
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Share</span>
          <button className="toolbar__btn" onClick={onClose} style={{ fontSize: 14, padding: '2px 8px' }}>×</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Scene: <strong style={{ color: 'var(--text-primary)' }}>{root?.name ?? 'Untitled'}</strong>
            {root && ` · ${Math.round(root.width)}×${Math.round(root.height)}`}
          </div>

          {/* Options */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeTimeline} onChange={e => setIncludeTimeline(e.target.checked)} />
              Include animation timeline
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeDesignSystem} onChange={e => setIncludeDesignSystem(e.target.checked)} />
              Include design system
            </label>
          </div>

          {/* URL */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Shareable URL ({(dataSize / 1024).toFixed(1)} KB)</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="prop-input"
                value={shareUrl}
                readOnly
                style={{ flex: 1, fontSize: 10, fontFamily: 'var(--font-mono)' }}
                onFocus={e => e.target.select()}
              />
              <button className="toolbar__btn toolbar__btn--primary" onClick={handleCopy} style={{ fontSize: 11, padding: '4px 12px' }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* JSON download */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="toolbar__btn" onClick={handleDownloadJson} style={{ flex: 1, fontSize: 11, padding: '8px 0' }}>
              Download JSON
            </button>
          </div>

          <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Anyone with this URL can open this design in reframe studio.
            The scene data is encoded in the URL hash — no server needed.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── URL Loading ─────────────────────────────────────────

export function loadFromUrlHash(): { sceneJson: any; timeline?: any; designMd?: string } | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#scene=')) return null;
  try {
    const encoded = hash.slice(7);
    const json = JSON.parse(decodeURIComponent(escape(atob(encoded))));
    return json;
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────

function buildShareData(graph: any, rootId: string, timeline: any, designMd: string, includeTimeline: boolean, includeDs: boolean) {
  const data: any = {
    version: 1,
    sceneJson: { root: exportSceneJsonForShare(graph, rootId) },
  };
  if (includeTimeline && timeline) data.timeline = timeline;
  if (includeDs && designMd) data.designMd = designMd;
  return data;
}

function exportSceneJsonForShare(graph: any, nodeId: string): any {
  const node = graph.getNode(nodeId);
  if (!node) return null;
  const result: any = { type: node.type, name: node.name, x: node.x, y: node.y, width: node.width, height: node.height };
  if (node.rotation !== 0) result.rotation = node.rotation;
  if (!node.visible) result.visible = false;
  if (node.opacity !== 1) result.opacity = node.opacity;
  if (node.fills?.length > 0) result.fills = node.fills;
  if (node.strokes?.length > 0) result.strokes = node.strokes;
  if (node.effects?.length > 0) result.effects = node.effects;
  if (node.cornerRadius) result.cornerRadius = node.cornerRadius;
  if (node.clipsContent) result.clipsContent = true;
  if (node.type === 'TEXT') {
    result.text = node.text; result.fontSize = node.fontSize;
    result.fontFamily = node.fontFamily; result.fontWeight = node.fontWeight;
    if (node.textAlignHorizontal !== 'LEFT') result.textAlignHorizontal = node.textAlignHorizontal;
    if (node.textAlignVertical !== 'TOP') result.textAlignVertical = node.textAlignVertical;
    if (node.lineHeight) result.lineHeight = node.lineHeight;
    if (node.letterSpacing) result.letterSpacing = node.letterSpacing;
    if (node.italic) result.italic = true;
    if (node.textDecoration !== 'NONE') result.textDecoration = node.textDecoration;
  }
  if (node.layoutMode !== 'NONE') {
    result.layoutMode = node.layoutMode;
    result.primaryAxisAlign = node.primaryAxisAlign;
    result.counterAxisAlign = node.counterAxisAlign;
    result.itemSpacing = node.itemSpacing;
    result.paddingTop = node.paddingTop; result.paddingRight = node.paddingRight;
    result.paddingBottom = node.paddingBottom; result.paddingLeft = node.paddingLeft;
  }
  const children = node.childIds.map((id: string) => graph.getNode(id)).filter(Boolean);
  if (children.length > 0) {
    result.children = children.map((c: any) => exportSceneJsonForShare(graph, c.id));
  }
  return result;
}
