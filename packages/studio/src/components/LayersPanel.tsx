/**
 * Layers Panel — root frame first, then nested hierarchy (editor-style).
 *
 * Chevron toggles children; row selects the artboard root on canvas.
 * Expands automatically when a non-root node is selected.
 */

import { useCallback, memo, useState, useEffect } from 'react';
import type { SceneGraph } from '@reframe/core/engine/scene-graph';
import { useSceneStore, getActiveArtboard } from '../store/scene';
import { countSceneNodes } from '../lib/scene-stats';

const TYPE_ICONS: Record<string, string> = {
  FRAME: 'F', TEXT: 'T', RECTANGLE: 'R', ELLIPSE: 'E',
  GROUP: 'G', VECTOR: 'V', LINE: 'L', COMPONENT: 'C',
  INSTANCE: 'I', STAR: 'S', POLYGON: 'P',
};

const LayerItem = memo(function LayerItem({ nodeId, depth, graph }: { nodeId: string; depth: number; graph: SceneGraph | null }) {
  const selectedIds = useSceneStore(s => s.selectedIds);
  const select = useSceneStore(s => s.select);
  const hover = useSceneStore(s => s.hover);
  const updateNode = useSceneStore(s => s.updateNode);
  let node;
  try { node = graph?.getNode(nodeId); } catch { return null; }
  if (!node) return null;

  const isSelected = selectedIds.includes(nodeId);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    select(e.shiftKey ? [...selectedIds, nodeId] : [nodeId]);
  }, [select, selectedIds, nodeId]);

  const handleVisibility = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    updateNode(nodeId, { visible: !node.visible } as any);
  }, [updateNode, nodeId, node?.visible]);

  const w = Math.round(node.width);
  const h = Math.round(node.height);
  const layoutHint =
    node.layoutMode !== 'NONE'
      ? ` · ${node.layoutMode}${node.itemSpacing != null ? ` · gap ${node.itemSpacing}` : ''}`
      : '';
  const rowTitle = `${node.name} · ${w}×${h}${layoutHint}`;

  return (
    <>
      <div
        className={`layer-item ${isSelected ? 'layer-item--selected' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        title={rowTitle}
        onClick={handleClick}
        onMouseEnter={() => hover(nodeId)}
        onMouseLeave={() => hover(null)}
      >
        <span className="layer-item__type" aria-hidden>{TYPE_ICONS[node.type] ?? '·'}</span>
        <span className="layer-item__name" style={{ opacity: node.visible ? 1 : 0.4 }}>{node.name}</span>
        <span
          className={`layer-item__visibility ${!node.visible ? 'layer-item__visibility--hidden' : ''}`}
          onClick={handleVisibility}
        >
          {node.visible ? '◉' : '○'}
        </span>
      </div>
      {node.childIds.map(childId => (
        <LayerItem key={childId} nodeId={childId} depth={depth + 1} graph={graph} />
      ))}
    </>
  );
});

export function LayersPanel() {
  const ab = useSceneStore(s => getActiveArtboard(s));
  const rootId = ab?.rootId ?? null;
  const graph = ab?.graph ?? null;
  const selectedIds = useSceneStore(s => s.selectedIds);
  const select = useSceneStore(s => s.select);
  const hover = useSceneStore(s => s.hover);
  const updateNode = useSceneStore(s => s.updateNode);

  const root = rootId && graph ? graph.getNode(rootId) : null;
  const treeNodes = rootId && graph ? countSceneNodes(graph, rootId) : 0;
  const childCount = root?.childIds.length ?? 0;
  const rw = root ? Math.round(root.width) : 0;
  const rh = root ? Math.round(root.height) : 0;
  const rootTitle = root
    ? `${root.name || 'Frame'} · ${rw}×${rh}${
        treeNodes > 1 ? ` · ${treeNodes - 1} nested` : ''
      }${root.layoutMode !== 'NONE' ? ` · ${root.layoutMode}` : ''}`
    : '';

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!rootId) return;
    const inner = selectedIds.some(id => id !== rootId);
    if (inner) setExpanded(true);
  }, [selectedIds, rootId]);

  const rootSelected = !!(rootId && selectedIds.includes(rootId));

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(v => !v);
  }, []);

  const selectRoot = useCallback((e: React.MouseEvent) => {
    if (!rootId) return;
    select(e.shiftKey ? [...selectedIds, rootId] : [rootId]);
  }, [select, selectedIds, rootId]);

  const toggleRootVisibility = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rootId || !root) return;
    updateNode(rootId, { visible: !root.visible } as any);
  }, [updateNode, rootId, root]);

  return (
    <div className="layers-panel">
      <div className="layers-panel__section-label">Layers</div>

      {!rootId || !graph || !root ? (
        <div className="layers-panel__empty">No scene loaded</div>
      ) : (
        <>
          <div
            className={`layers-root-frame ${rootSelected ? 'layers-root-frame--selected' : ''}`}
            title={rootTitle}
            onClick={selectRoot}
            onMouseEnter={() => hover(rootId)}
            onMouseLeave={() => hover(null)}
          >
            <button
              type="button"
              className="layers-root-frame__chevron"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse layers' : 'Expand layers'}
              onClick={toggleExpand}
            >
              {expanded ? '▼' : '▶'}
            </button>
            <span className="layers-root-frame__name" style={{ opacity: root.visible ? 1 : 0.45 }}>
              {root.name || 'Frame'}
            </span>
            <span
              className={`layers-root-frame__visibility ${!root.visible ? 'layer-item__visibility--hidden' : ''}`}
              onClick={toggleRootVisibility}
            >
              {root.visible ? '◉' : '○'}
            </span>
          </div>

          {expanded && childCount > 0 && (
            <div className="layers-panel__branch">
              {root.childIds.map(childId => (
                <LayerItem key={childId} nodeId={childId} depth={0} graph={graph} />
              ))}
            </div>
          )}

        </>
      )}
    </div>
  );
}
