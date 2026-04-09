/**
 * Toolbar — AURA-style design tool bar.
 *
 * Left:   logo
 * Center: tool icons (select, frame, shape, pen, text, image)
 * Right:  Templates, Open (HTML / scene JSON), Share, Export
 */

import { useCallback, useRef, useState, useEffect } from 'react';
import { useSceneStore, type CanvasTool, getActiveArtboard, activeDocSlice } from '../store/scene';
import { countSceneNodes } from '../lib/scene-stats';
import { TemplateGallery } from './TemplateGallery';
import { ShareDialog } from './ShareDialog';

/* ── SVG icons 18×18 ─────────────────────────────────── */

const IconSelect = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 3l2 12 3-4 4-1z" fill="currentColor" fillOpacity="0.15" />
    <path d="M4 3l2 12 3-4 4-1L4 3z" />
  </svg>
);
const IconFrame = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2v14M13 2v14M2 5h14M2 13h14" />
  </svg>
);
const IconRect = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="12" height="10" rx="1.5" />
  </svg>
);
const IconPen = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 15l3-1L14.5 5.5a1.4 1.4 0 00-2-2L4 12l-1 3z" />
    <path d="M12.5 3.5l2 2" />
  </svg>
);
const IconText = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5V4h10v1" /><path d="M9 4v11" /><path d="M7 15h4" />
  </svg>
);
const IconImage = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="12" height="12" rx="1.5" />
    <circle cx="7" cy="7" r="1.5" />
    <path d="M15 12l-3-3-6 6" />
  </svg>
);
/** Open local file — folder + arrow in (distinct from upload/share‑out iconography). */
const IconOpenFile = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 13.5V5.5l2.5-2h3.2L10 5.5H13.5a1 1 0 011 1v6a1 1 0 01-1 1h-10a1 1 0 01-1-1z" />
    <path d="M8 7.5v4.5M6 9.5l2-2 2 2" />
  </svg>
);
const IconShare = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 10V2M5 5l3-3 3 3" /><path d="M3 11v2a1 1 0 001 1h8a1 1 0 001-1v-2" />
  </svg>
);
const IconExport = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8h8M8 4l4 4-4 4" />
  </svg>
);
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="7" r="4" /><path d="M14 14l-3.5-3.5" />
  </svg>
);
const IconChevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4l2 2 2-2" />
  </svg>
);
const IconUndo = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6l-3 3 3 3" /><path d="M1 9h9a4 4 0 010 8H6" />
  </svg>
);
const IconRedo = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 6l3 3-3 3" /><path d="M15 9H6a4 4 0 000 8h4" />
  </svg>
);
const IconTrash = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1" /><path d="M4 4l.7 9.1a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4" />
  </svg>
);

export function Toolbar() {
  const scene = useSceneStore();
  const ab = getActiveArtboard(scene);
  const graph = ab?.graph ?? null;
  const rootId = ab?.rootId ?? null;
  const { history, historyIndex, timeline } = activeDocSlice(scene);
  const {
    importHtml,
    exportHtml, exportSvg, exportReact, exportAnimatedHtml, exportLottieJson,
    undo, redo,
    deleteNode, selectedIds,
  } = scene;
  const fileRef = useRef<HTMLInputElement>(null);
  const [showExport, setShowExport] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const canvasTool = useSceneStore(s => s.canvasTool);
  const setCanvasTool = useSceneStore(s => s.setCanvasTool);
  const exportRef = useRef<HTMLDivElement>(null);

  const root = graph?.getNode(rootId ?? '');
  const nodeCount = root && graph && rootId ? countSceneNodes(graph, rootId) : 0;
  const mcpSid = ab?.mcpSceneId?.trim();

  // Close dropdown on outside click
  useEffect(() => {
    if (!showExport) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setShowExport(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExport]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        try {
          const json = JSON.parse(text);
          const store = useSceneStore.getState();
          store.loadSceneJson(json.sceneJson ?? json);
          if (json.timeline) store.setTimeline(json.timeline);
          if (json.designMd) store.loadDesignMd(json.designMd);
        } catch (err) {
          console.error('Failed to load scene JSON:', err);
        }
      } else {
        void importHtml(text);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [importHtml]);

  const handleExport = useCallback((format: string) => {
    let content = '', filename = '', type = '';
    if (format === 'html') { content = exportHtml(); filename = 'design.html'; type = 'text/html'; }
    else if (format === 'svg') { content = exportSvg(); filename = 'design.svg'; type = 'image/svg+xml'; }
    else if (format === 'react') { content = exportReact(); filename = 'Design.tsx'; type = 'text/plain'; }
    else if (format === 'animated') { content = exportAnimatedHtml(); filename = 'animated.html'; type = 'text/html'; }
    else if (format === 'lottie') { content = exportLottieJson(); filename = 'animation.json'; type = 'application/json'; }
    if (content) download(filename, content, type);
    setShowExport(false);
  }, [exportHtml, exportSvg, exportReact, exportAnimatedHtml, exportLottieJson]);

  const handleDelete = useCallback(() => {
    if (selectedIds.length === 1 && selectedIds[0] !== rootId) deleteNode(selectedIds[0]);
  }, [deleteNode, selectedIds, rootId]);

  const canDelete = selectedIds.length === 1 && selectedIds[0] !== rootId;
  const hasScene = !!(graph && rootId);

  const tools: { id: CanvasTool; icon: React.ReactNode; label: string }[] = [
    { id: 'select', icon: <IconSelect />, label: 'Select (V)' },
    { id: 'frame',  icon: <IconFrame />,  label: 'Frame (F)' },
    { id: 'rect',   icon: <IconRect />,   label: 'Rectangle (R)' },
    { id: 'pen',    icon: <IconPen />,    label: 'Pen (soon)' },
    { id: 'text',   icon: <IconText />,   label: 'Text (T)' },
    { id: 'image',  icon: <IconImage />,  label: 'Image (soon)' },
  ];

  return (
    <>
      <div className="toolbar">
        {/* ── Left: Logo ── */}
        <span className="toolbar__logo">reframe</span>

        <div style={{ flex: 1 }} />

        {/* ── Center: Scene info (absolute centered) ── */}
        <div className="toolbar__center">
          {root ? (
            <span className="toolbar__scene-info">
              <span className="toolbar__scene-name">{root.name}</span>
              <span className="toolbar__scene-sep">·</span>
              <span className="toolbar__scene-dim">{Math.round(root.width)}×{Math.round(root.height)}</span>
              <span className="toolbar__scene-sep">·</span>
              <span className="toolbar__scene-nodes">{nodeCount} nodes</span>
              {mcpSid ? (
                <>
                  <span className="toolbar__scene-sep">·</span>
                  <span className="toolbar__scene-mcp" title="MCP session scene id">
                    {mcpSid}
                  </span>
                </>
              ) : null}
            </span>
          ) : (
            <span className="toolbar__scene-empty">reframe studio</span>
          )}
        </div>

        {/* ── Right: Actions ── */}
        <div className="toolbar__right">
          <input ref={fileRef} type="file" accept=".html,.htm,.json" style={{ display: 'none' }} onChange={handleFileChange} />

          <button className="toolbar__icon-btn" onClick={() => setShowTemplates(true)} title="Templates">
            <IconSearch />
          </button>

          <button
            className="toolbar__icon-btn"
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Open — HTML, HTM, or scene JSON"
          >
            <IconOpenFile />
          </button>

          {hasScene && (
            <>
              <button type="button" className="toolbar__btn" onClick={() => setShowShare(true)}>
                <IconShare />
                Share
              </button>

              <div className="toolbar__export-wrap" ref={exportRef}>
                <button type="button" className="toolbar__icon-btn" onClick={() => setShowExport(!showExport)} title="Export">
                  <IconExport />
                </button>
                {showExport && (
                  <div className="toolbar__dropdown">
                    <button type="button" className="toolbar__dropdown-item" onClick={() => handleExport('html')}>HTML</button>
                    <button type="button" className="toolbar__dropdown-item" onClick={() => handleExport('svg')}>SVG</button>
                    <button type="button" className="toolbar__dropdown-item" onClick={() => handleExport('react')}>React</button>
                    {timeline && <button type="button" className="toolbar__dropdown-item" onClick={() => handleExport('animated')}>Animated HTML</button>}
                    {timeline && <button type="button" className="toolbar__dropdown-item" onClick={() => handleExport('lottie')}>Lottie JSON</button>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Floating bottom toolbox (Figma-style) ── */}
      <div className="toolbox">
        <div className="toolbox__group">
          {tools.map(t => (
            <button
              key={t.id}
              className={`toolbox__tool ${canvasTool === t.id ? 'toolbox__tool--active' : ''}`}
              onClick={() => setCanvasTool(t.id)}
              title={t.label}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <div className="toolbox__sep" />

        <div className="toolbox__group">
          <button className="toolbox__tool" onClick={undo} disabled={historyIndex <= 0} title="Undo">
            <IconUndo />
          </button>
          <button className="toolbox__tool" onClick={redo} disabled={historyIndex >= history.length - 1} title="Redo">
            <IconRedo />
          </button>
          {canDelete && (
            <button className="toolbox__tool toolbox__tool--danger" onClick={handleDelete} title="Delete">
              <IconTrash />
            </button>
          )}
        </div>
      </div>

      {showTemplates && <TemplateGallery onClose={() => setShowTemplates(false)} />}
      {showShare && <ShareDialog onClose={() => setShowShare(false)} />}
    </>
  );
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
