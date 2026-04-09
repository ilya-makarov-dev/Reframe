/**
 * reframe studio — AI-native design environment.
 *
 * Workspace layout: canvas fills everything,
 * glass panels float over it.
 */

import { useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { LayersPanel } from './components/LayersPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ProjectPanel } from './components/ProjectPanel';
import { Toolbar } from './components/Toolbar';
import { ArtboardTabs } from './components/ArtboardTabs';
import { AuditPanel } from './components/AuditPanel';
import { useSceneStore, getActiveArtboard } from './store/scene';
import { useMcpAutoConnect } from './mcp/hooks';
import { loadFromUrlHash } from './components/ShareDialog';
import './styles/app.css';

export function App() {
  const { undo, redo, deleteNode, selectedIds, loadSceneJson, setTimeline, loadDesignMd } = useSceneStore();
  const rootId = useSceneStore(s => getActiveArtboard(s)?.rootId ?? null);

  useMcpAutoConnect();

  useEffect(() => {
    const data = loadFromUrlHash();
    if (data) {
      loadSceneJson(data.sceneJson);
      if (data.timeline) setTimeline(data.timeline);
      if (data.designMd) loadDesignMd(data.designMd);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        if (e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length === 1 && selectedIds[0] !== rootId) {
        e.preventDefault();
        deleteNode(selectedIds[0]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, deleteNode, selectedIds, rootId]);

  return (
    <div className="studio">
      <Toolbar />

      <div className="workspace">
        {/* Canvas fills entire workspace */}
        <Canvas />

        {/* Panels float over canvas */}
        <div className="panel float-panel float-panel--left">
          <ProjectPanel />
          <ArtboardTabs />
          <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <LayersPanel />
            </div>
            <div style={{ flexShrink: 0, maxHeight: 240, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <AuditPanel />
            </div>
          </div>
        </div>

        <div className="panel float-panel float-panel--right">
          <div style={{ flex: 1, overflow: 'auto' }}>
            <PropertiesPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
