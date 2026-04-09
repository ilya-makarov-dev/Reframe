/**
 * Share Dialog — serialize scene to URL for sharing.
 *
 * Encodes scene JSON + timeline as base64 in URL hash.
 * Also supports JSON file save/load for local workflow.
 */

import { useState, useCallback, useEffect, useId } from 'react';
import { serializeGraph } from '@reframe/core/serialize';
import type { SceneGraph } from '@reframe/core/engine/scene-graph';
import type { ITimeline } from '@reframe/core/animation/types';
import { useSceneStore, getActiveArtboard } from '../store/scene';

function formatLinkSize(bytes: number): string {
  if (bytes < 1024) return `${Math.max(1, Math.round(bytes))} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Short preview — avoids a huge monospace wall in the modal. */
function linkPreview(url: string, maxTotal = 72): string {
  if (url.length <= maxTotal) return url;
  const keepStart = 40;
  const keepEnd = 24;
  return `${url.slice(0, keepStart)}…${url.slice(-keepEnd)}`;
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const scene = useSceneStore();
  const ab = getActiveArtboard(scene);
  const graph = ab?.graph ?? null;
  const rootId = ab?.rootId ?? null;
  const timeline = ab?.timeline ?? null;
  const { designMd } = scene;
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [includeTimeline, setIncludeTimeline] = useState(true);
  const [includeDesignSystem, setIncludeDesignSystem] = useState(true);
  const [includeRasterAssets, setIncludeRasterAssets] = useState(false);
  const [showFullUrl, setShowFullUrl] = useState(false);
  const optionsId = useId();

  useEffect(() => {
    if (!graph || !rootId) return;
    const data = buildShareData(
      graph,
      rootId,
      timeline,
      designMd,
      includeTimeline,
      includeDesignSystem,
      includeRasterAssets,
    );
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const url = `${window.location.origin}${window.location.pathname}#scene=${encoded}`;
    setShareUrl(url);
  }, [graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem, includeRasterAssets]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [shareUrl]);

  const handleDownloadJson = useCallback(() => {
    if (!graph || !rootId) return;
    const data = buildShareData(
      graph,
      rootId,
      timeline,
      designMd,
      includeTimeline,
      includeDesignSystem,
      includeRasterAssets,
    );
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'reframe-scene.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [graph, rootId, timeline, designMd, includeTimeline, includeDesignSystem, includeRasterAssets]);

  if (!graph || !rootId) return null;

  const root = graph.getNode(rootId);
  const linkBytes = new Blob([shareUrl]).size;

  return (
    <div className="template-overlay" onClick={onClose} role="presentation">
      <div
        className="share-dialog"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="share-dialog-title"
        aria-describedby="share-dialog-desc"
      >
        <div className="share-dialog__header">
          <div>
            <h2 id="share-dialog-title" className="share-dialog__title">
              Share link
            </h2>
            <p id="share-dialog-desc" className="share-dialog__subtitle">
              Anyone with the link can open this file in Studio. Data lives in the URL (no upload).
            </p>
          </div>
          <button
            type="button"
            className="share-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="share-dialog__body">
          <div className="share-dialog__scene-pill">
            <span className="share-dialog__scene-name">{root?.name ?? 'Untitled'}</span>
            {root && (
              <span className="share-dialog__scene-meta">
                {Math.round(root.width)}×{Math.round(root.height)}
              </span>
            )}
          </div>

          <fieldset className="share-dialog__options" aria-labelledby={optionsId}>
            <legend id={optionsId} className="share-dialog__options-legend">
              Include in link
            </legend>
            <label className="share-dialog__option">
              <input
                type="checkbox"
                checked={includeTimeline}
                onChange={e => setIncludeTimeline(e.target.checked)}
              />
              <span>
                <span className="share-dialog__option-label">Animation timeline</span>
                <span className="share-dialog__option-hint">Motion keyframes, if any</span>
              </span>
            </label>
            <label className="share-dialog__option">
              <input
                type="checkbox"
                checked={includeDesignSystem}
                onChange={e => setIncludeDesignSystem(e.target.checked)}
              />
              <span>
                <span className="share-dialog__option-label">Design system (DESIGN.md)</span>
                <span className="share-dialog__option-hint">Brand tokens and audit palette</span>
              </span>
            </label>
            <label className="share-dialog__option">
              <input
                type="checkbox"
                checked={includeRasterAssets}
                onChange={e => setIncludeRasterAssets(e.target.checked)}
              />
              <span>
                <span className="share-dialog__option-label">Embedded images</span>
                <span className="share-dialog__option-hint">Base64 in URL — much larger</span>
              </span>
            </label>
          </fieldset>

          <div className="share-dialog__actions">
            <button
              type="button"
              className="toolbar__btn toolbar__btn--primary share-dialog__btn-primary"
              onClick={handleCopy}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button type="button" className="toolbar__btn share-dialog__btn-secondary" onClick={handleDownloadJson}>
              Download .json
            </button>
          </div>

          <div className="share-dialog__link-box">
            <div className="share-dialog__link-meta">
              <span>Encoded size</span>
              <span className="share-dialog__link-size">{formatLinkSize(linkBytes)}</span>
            </div>
            {showFullUrl ? (
              <textarea
                className="share-dialog__url-field share-dialog__url-field--full"
                readOnly
                value={shareUrl}
                rows={4}
                onFocus={e => e.target.select()}
              />
            ) : (
              <div className="share-dialog__url-preview" title={shareUrl}>
                {linkPreview(shareUrl)}
              </div>
            )}
            <button
              type="button"
              className="share-dialog__toggle-url"
              onClick={() => setShowFullUrl(v => !v)}
            >
              {showFullUrl ? 'Hide full link' : 'Show full link'}
            </button>
          </div>

          <p className="share-dialog__footer-note">
            Receivers open Studio from the same origin (e.g. this dev server) and the scene loads from the hash.
            For heavy bitmaps, prefer off and send assets separately — or use Download .json.
          </p>
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

function buildShareData(
  graph: SceneGraph,
  rootId: string,
  timeline: ITimeline | null,
  designMd: string,
  includeTimeline: boolean,
  includeDs: boolean,
  includeRasterAssets: boolean,
) {
  const full = serializeGraph(graph, rootId, {
    compact: true,
    timeline: includeTimeline && timeline ? timeline : undefined,
  });
  let sceneJson: Record<string, unknown> = { ...full };
  if (!includeRasterAssets && full.images && Object.keys(full.images).length > 0) {
    const { images: _omit, ...rest } = full;
    sceneJson = rest as Record<string, unknown>;
  }

  const data: {
    version: number;
    sceneJson: Record<string, unknown>;
    timeline?: ITimeline;
    designMd?: string;
  } = {
    version: 1,
    sceneJson,
  };

  if (includeTimeline && timeline && sceneJson.timeline == null) {
    data.timeline = timeline;
  }
  if (includeDs && designMd) data.designMd = designMd;
  return data;
}
