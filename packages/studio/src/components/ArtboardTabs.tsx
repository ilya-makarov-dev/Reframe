/**
 * Artboard Tabs — switch between multiple artboards (scenes).
 *
 * Each artboard is an independent INode tree + timeline.
 * Common sizes: think multi-format campaign (banner + social + email header).
 */

import { useCallback, useState } from 'react';
import { useSceneStore } from '../store/scene';
import { rootFrameMetrics } from '../lib/scene-stats';

const QUICK_SIZES: { label: string; w: number; h: number }[] = [
  { label: 'Desktop 1920×1080', w: 1920, h: 1080 },
  { label: 'Mobile 390×844', w: 390, h: 844 },
  { label: 'Tablet 768×1024', w: 768, h: 1024 },
  { label: 'Banner 728×90', w: 728, h: 90 },
  { label: 'Square 1080×1080', w: 1080, h: 1080 },
  { label: 'Story 1080×1920', w: 1080, h: 1920 },
  { label: 'Card 400×300', w: 400, h: 300 },
];

export function ArtboardTabs() {
  const {
    artboards, activeArtboardId,
    addArtboard, removeArtboard, switchArtboard, renameArtboard,
  } = useSceneStore();
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const handleNew = useCallback((w: number, h: number, label: string) => {
    addArtboard(label, w, h);
    setShowNew(false);
  }, [addArtboard]);

  const handleNewBlank = useCallback(() => {
    addArtboard('Untitled');
    setShowNew(false);
  }, [addArtboard]);

  const handleDoubleClick = useCallback((id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  }, []);

  const handleRename = useCallback(() => {
    if (editingId && editName.trim()) {
      renameArtboard(editingId, editName.trim());
    }
    setEditingId(null);
  }, [editingId, editName, renameArtboard]);

  const handleClose = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (artboards.length > 1) removeArtboard(id);
  }, [artboards.length, removeArtboard]);

  return (
    <div className="artboard-tabs">
      {artboards.map(ab => (
        <div
          key={ab.id}
          className={`artboard-tab ${ab.id === activeArtboardId ? 'artboard-tab--active' : ''}`}
          onClick={() => switchArtboard(ab.id)}
          onDoubleClick={() => handleDoubleClick(ab.id, ab.name)}
        >
          {editingId === ab.id ? (
            <input
              className="artboard-tab__edit"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditingId(null); }}
              autoFocus
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <>
              <span className="artboard-tab__name">{ab.name}</span>
              {ab.rootId && (() => {
                const live = rootFrameMetrics(ab.graph, ab.rootId);
                const w = live?.width ?? ab.width;
                const h = live?.height ?? ab.height;
                if (!w && !h) return null;
                return (
                  <span className="artboard-tab__size">
                    {w}×{h}
                  </span>
                );
              })()}
            </>
          )}
          {artboards.length > 1 && (
            <span className="artboard-tab__close" onClick={e => handleClose(e, ab.id)}>×</span>
          )}
        </div>
      ))}

      <div style={{ position: 'relative' }}>
        <button
          className="artboard-tab artboard-tab--add"
          onClick={() => setShowNew(!showNew)}
          title="New artboard"
        >
          +
        </button>

        {showNew && (
          <div className="artboard-new-menu">
            <button className="artboard-new-item" onClick={handleNewBlank}>
              Blank artboard
            </button>
            <div className="artboard-new-divider" />
            {QUICK_SIZES.map(s => (
              <button key={s.label} className="artboard-new-item" onClick={() => handleNew(s.w, s.h, s.label.split(' ')[0])}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
