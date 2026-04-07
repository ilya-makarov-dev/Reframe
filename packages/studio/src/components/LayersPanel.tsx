/**
 * Layers Panel — tree view of INode hierarchy.
 */

import { useCallback, memo } from 'react';
import type { SceneGraph } from '@reframe/core/engine/scene-graph';
import { useSceneStore } from '../store/scene';
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

  return (
    <>
      <div
        className={`layer-item ${isSelected ? 'layer-item--selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={handleClick}
        onMouseEnter={() => hover(nodeId)}
        onMouseLeave={() => hover(null)}
      >
        <span className="layer-item__type">{TYPE_ICONS[node.type] ?? '?'}</span>
        <span className="layer-item__name" style={{ opacity: node.visible ? 1 : 0.4 }}>{node.name}</span>
        {node.layoutMode !== 'NONE' && (
          <span className="layer-item__layout" title={`${node.layoutMode} · ${node.primaryAxisAlign} · gap ${node.itemSpacing}`}>
            {node.layoutMode === 'HORIZONTAL' ? '→' : node.layoutMode === 'VERTICAL' ? '↓' : '⊞'}
          </span>
        )}
        <span className="layer-item__size">{Math.round(node.width)}×{Math.round(node.height)}</span>
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
  const activeArtboardId = useSceneStore(s => s.activeArtboardId);
  const artboards = useSceneStore(s => s.artboards);
  const rootTop = useSceneStore(s => s.rootId);
  const graphTop = useSceneStore(s => s.graph);
  const ab = artboards.find(a => a.id === activeArtboardId);
  const rootId = ab ? ab.rootId : rootTop;
  const graph = ab ? ab.graph : graphTop;
  const treeNodes =
    rootId && graph ? countSceneNodes(graph, rootId) : 0;

  return (
    <div>
      <div className="panel-header">
        Layers
        {treeNodes > 0 && (
          <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-muted)', fontSize: 10 }}>
            {treeNodes} nodes
          </span>
        )}
      </div>
      {rootId ? (
        <LayerItem nodeId={rootId} depth={0} graph={graph} />
      ) : (
        <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>No scene loaded</div>
      )}
    </div>
  );
}
