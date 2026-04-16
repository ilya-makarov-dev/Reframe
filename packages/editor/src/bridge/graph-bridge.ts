/**
 * Graph Bridge — bidirectional conversion between OpenPencil and reframe SceneGraphs.
 *
 * Architecture: One OpenPencil SceneGraph is the canonical runtime graph (owned by the editor).
 * Reframe-only fields (semanticRole, meta, states, responsive, etc.) are stored in a
 * side-channel Map<nodeId, ReframeExtension>. When reframe engine operations need to run
 * (audit, export, resize), toReframeGraph() projects the combined data into a reframe
 * SceneGraph. When the AI pipeline produces a new reframe graph (HTML import), fromReframeGraph()
 * updates the OP graph and extracts extensions.
 *
 * This avoids N^2 sync between two independent graphs and keeps undo coherent.
 */

import {
  SceneGraph as OPSceneGraph,
  type SceneNode as OPSceneNode,
} from '@open-pencil/core';

// Import from compiled @reframe/core package
import { SceneGraph as RFSceneGraph } from '@reframe/core';
import type { SceneNode as RFSceneNode } from '@reframe/core';

import {
  type ReframeExtension,
  extractExtension,
  applyExtension,
  opGridTrackToReframe,
  reframeGridTrackToOP,
  isExtensionEmpty,
} from './node-bridge.js';

export class GraphBridge {
  /** Reframe-only extension data per node. */
  readonly extensions = new Map<string, ReframeExtension>();

  /**
   * Translation table OP-node-id → reframe-node-id. Needed because OP's
   * `createNode` ignores `overrides.id` and assigns its own internal id
   * (createDefaultNode → generateId). The bridge writes both the OP id
   * (returned from createNode) and the original reframe id into this
   * map, so the platform layer can translate canvas-selection events
   * (which carry OP ids) into the reframe ids the server stores under.
   *
   * Without this, every Properties-panel fetch (`/api/node/get?nodeId=X`)
   * returns 404 because the OP id `0:309` doesn't exist on the server.
   */
  readonly opToReframeId = new Map<string, string>();
  readonly reframeToOpId = new Map<string, string>();

  /** Translate an OP-internal id to its reframe SceneGraph counterpart. */
  toReframeId(opId: string | null | undefined): string | null {
    if (!opId) return null;
    return this.opToReframeId.get(opId) ?? opId;
  }

  /**
   * Convert an OpenPencil SceneGraph + extensions → reframe SceneGraph.
   * Used when running reframe engine operations (audit, export, resize).
   */
  toReframeGraph(opGraph: OPSceneGraph): { graph: RFSceneGraph; rootId: string } {
    const rfGraph = new RFSceneGraph();

    // Find the first page (or use rootId directly)
    const pages = opGraph.getPages();
    const pageId = pages.length > 0 ? pages[0].id : opGraph.rootId;

    // Walk OP graph and create reframe nodes
    const visited = new Set<string>();
    const copyNode = (opNode: OPSceneNode, rfParentId: string) => {
      if (visited.has(opNode.id)) return;
      visited.add(opNode.id);

      // Map OP fields → reframe overrides
      const overrides: Partial<RFSceneNode> = {
        id: opNode.id,
        name: opNode.name,
        type: opNode.type as any,
        x: opNode.x,
        y: opNode.y,
        width: opNode.width,
        height: opNode.height,
        rotation: opNode.rotation,
        flipX: opNode.flipX,
        flipY: opNode.flipY,
        fills: opNode.fills as any,
        strokes: opNode.strokes as any,
        effects: opNode.effects as any,
        opacity: opNode.opacity,
        blendMode: opNode.blendMode as any,
        visible: opNode.visible,
        locked: opNode.locked,
        clipsContent: opNode.clipsContent,
        cornerRadius: opNode.cornerRadius,
        topLeftRadius: opNode.topLeftRadius,
        topRightRadius: opNode.topRightRadius,
        bottomRightRadius: opNode.bottomRightRadius,
        bottomLeftRadius: opNode.bottomLeftRadius,
        independentCorners: opNode.independentCorners,
        cornerSmoothing: opNode.cornerSmoothing,
        text: opNode.text,
        fontSize: opNode.fontSize,
        fontFamily: opNode.fontFamily,
        fontWeight: opNode.fontWeight,
        italic: opNode.italic,
        textAlignHorizontal: opNode.textAlignHorizontal as any,
        textAlignVertical: opNode.textAlignVertical,
        textAutoResize: opNode.textAutoResize,
        textCase: opNode.textCase,
        textDecoration: opNode.textDecoration,
        lineHeight: opNode.lineHeight,
        letterSpacing: opNode.letterSpacing,
        maxLines: opNode.maxLines,
        styleRuns: opNode.styleRuns as any,
        textTruncation: opNode.textTruncation,
        textPicture: opNode.textPicture,
        horizontalConstraint: opNode.horizontalConstraint,
        verticalConstraint: opNode.verticalConstraint,
        layoutMode: opNode.layoutMode,
        layoutWrap: opNode.layoutWrap,
        primaryAxisAlign: opNode.primaryAxisAlign as any,
        counterAxisAlign: opNode.counterAxisAlign,
        primaryAxisSizing: opNode.primaryAxisSizing,
        counterAxisSizing: opNode.counterAxisSizing,
        itemSpacing: opNode.itemSpacing,
        counterAxisSpacing: opNode.counterAxisSpacing,
        paddingTop: opNode.paddingTop,
        paddingRight: opNode.paddingRight,
        paddingBottom: opNode.paddingBottom,
        paddingLeft: opNode.paddingLeft,
        layoutPositioning: opNode.layoutPositioning,
        layoutGrow: opNode.layoutGrow,
        layoutAlignSelf: opNode.layoutAlignSelf,
        strokeCap: opNode.strokeCap,
        strokeJoin: opNode.strokeJoin,
        dashPattern: opNode.dashPattern,
        borderTopWeight: opNode.borderTopWeight,
        borderRightWeight: opNode.borderRightWeight,
        borderBottomWeight: opNode.borderBottomWeight,
        borderLeftWeight: opNode.borderLeftWeight,
        independentStrokeWeights: opNode.independentStrokeWeights,
        strokeMiterLimit: opNode.strokeMiterLimit,
        minWidth: opNode.minWidth,
        maxWidth: opNode.maxWidth,
        minHeight: opNode.minHeight,
        maxHeight: opNode.maxHeight,
        vectorNetwork: opNode.vectorNetwork as any,
        fillGeometry: opNode.fillGeometry as any,
        strokeGeometry: opNode.strokeGeometry as any,
        arcData: opNode.arcData as any,
        isMask: opNode.isMask,
        maskType: opNode.maskType,
        pointCount: opNode.pointCount,
        starInnerRadius: opNode.starInnerRadius,
        expanded: opNode.expanded,
        autoRename: opNode.autoRename,
        componentId: opNode.componentId,
        boundVariables: opNode.boundVariables,
        internalOnly: opNode.internalOnly,
        // Convert GridTrack type difference
        gridTemplateColumns: opNode.gridTemplateColumns?.map(opGridTrackToReframe) ?? [],
        gridTemplateRows: opNode.gridTemplateRows?.map(opGridTrackToReframe) ?? [],
        gridColumnGap: opNode.gridColumnGap,
        gridRowGap: opNode.gridRowGap,
        gridPosition: opNode.gridPosition,
        counterAxisAlignContent: opNode.counterAxisAlignContent,
        itemReverseZIndex: opNode.itemReverseZIndex,
        strokesIncludedInLayout: opNode.strokesIncludedInLayout,
      };

      // Create node in reframe graph
      const rfNode = rfGraph.createNode(opNode.type as any, rfParentId, overrides);

      // Apply reframe extensions (semanticRole, meta, states, responsive, etc.)
      const ext = this.extensions.get(opNode.id);
      if (ext) {
        applyExtension(rfNode, ext);
      }

      // Recurse children
      for (const childId of opNode.childIds) {
        const childNode = opGraph.getNode(childId);
        if (childNode) {
          copyNode(childNode, rfNode.id);
        }
      }
    };

    // Copy all page children into the reframe graph's page
    const page = rfGraph.addPage('Page 1');
    const opPage = opGraph.getNode(pageId);
    if (opPage) {
      for (const childId of opPage.childIds) {
        const childNode = opGraph.getNode(childId);
        if (childNode) {
          copyNode(childNode, page.id);
        }
      }
    }

    return { graph: rfGraph, rootId: page.id };
  }

  /**
   * Convert a reframe SceneGraph → OpenPencil SceneGraph.
   * Used when AI pipeline produces a new graph (HTML import) and we need to
   * replace the editor's graph.
   *
   * Also extracts reframe-only fields into extensions.
   */
  fromReframeGraph(
    rfGraph: RFSceneGraph,
    rfRootId: string,
  ): OPSceneGraph {
    const opGraph = new OPSceneGraph();
    const page = opGraph.addPage('Page 1');

    // Clear old translation tables for this conversion. Selection events
    // dispatched in OP-id space rely on these to route back to reframe.
    this.extensions.clear();
    this.opToReframeId.clear();
    this.reframeToOpId.clear();

    // Map the OP page wrapper to the reframe root (typically CANVAS).
    // Without this, clicks landing on the page-background or empty
    // scenes (where OP has only the auto-page wrapper) dispatch an
    // OP-only id that has no server counterpart → 404 on every
    // /api/node/get call.
    this.opToReframeId.set(page.id, rfRootId);
    this.reframeToOpId.set(rfRootId, page.id);

    const visited = new Set<string>();
    const copyNode = (rfNode: RFSceneNode, opParentId: string) => {
      if (visited.has(rfNode.id)) return;
      visited.add(rfNode.id);

      // Extract reframe extensions before copying to OP
      const ext = extractExtension(rfNode);
      if (!isExtensionEmpty(ext)) {
        this.extensions.set(rfNode.id, ext);
      }

      // Map reframe fields → OP overrides
      const overrides: Partial<OPSceneNode> = {
        id: rfNode.id,
        name: rfNode.name,
        type: rfNode.type as any,
        x: rfNode.x,
        y: rfNode.y,
        width: rfNode.width,
        height: rfNode.height,
        rotation: rfNode.rotation,
        flipX: rfNode.flipX,
        flipY: rfNode.flipY,
        fills: rfNode.fills as any,
        strokes: rfNode.strokes as any,
        effects: rfNode.effects as any,
        opacity: rfNode.opacity,
        blendMode: rfNode.blendMode as any,
        visible: rfNode.visible,
        locked: rfNode.locked,
        clipsContent: rfNode.clipsContent,
        cornerRadius: rfNode.cornerRadius,
        topLeftRadius: rfNode.topLeftRadius,
        topRightRadius: rfNode.topRightRadius,
        bottomRightRadius: rfNode.bottomRightRadius,
        bottomLeftRadius: rfNode.bottomLeftRadius,
        independentCorners: rfNode.independentCorners,
        cornerSmoothing: rfNode.cornerSmoothing,
        text: rfNode.text,
        fontSize: rfNode.fontSize,
        fontFamily: rfNode.fontFamily,
        fontWeight: rfNode.fontWeight,
        italic: rfNode.italic,
        textAlignHorizontal: rfNode.textAlignHorizontal as any,
        textAlignVertical: rfNode.textAlignVertical,
        textAutoResize: rfNode.textAutoResize,
        textCase: rfNode.textCase,
        textDecoration: rfNode.textDecoration,
        lineHeight: rfNode.lineHeight,
        letterSpacing: rfNode.letterSpacing,
        maxLines: rfNode.maxLines,
        styleRuns: rfNode.styleRuns as any,
        textTruncation: rfNode.textTruncation,
        textPicture: rfNode.textPicture,
        horizontalConstraint: rfNode.horizontalConstraint,
        verticalConstraint: rfNode.verticalConstraint,
        layoutMode: rfNode.layoutMode,
        layoutWrap: rfNode.layoutWrap,
        primaryAxisAlign: rfNode.primaryAxisAlign as any,
        counterAxisAlign: rfNode.counterAxisAlign,
        primaryAxisSizing: rfNode.primaryAxisSizing,
        counterAxisSizing: rfNode.counterAxisSizing,
        itemSpacing: rfNode.itemSpacing,
        counterAxisSpacing: rfNode.counterAxisSpacing,
        paddingTop: rfNode.paddingTop,
        paddingRight: rfNode.paddingRight,
        paddingBottom: rfNode.paddingBottom,
        paddingLeft: rfNode.paddingLeft,
        layoutPositioning: rfNode.layoutPositioning,
        layoutGrow: rfNode.layoutGrow,
        layoutAlignSelf: rfNode.layoutAlignSelf,
        strokeCap: rfNode.strokeCap,
        strokeJoin: rfNode.strokeJoin,
        dashPattern: rfNode.dashPattern,
        borderTopWeight: rfNode.borderTopWeight,
        borderRightWeight: rfNode.borderRightWeight,
        borderBottomWeight: rfNode.borderBottomWeight,
        borderLeftWeight: rfNode.borderLeftWeight,
        independentStrokeWeights: rfNode.independentStrokeWeights,
        strokeMiterLimit: rfNode.strokeMiterLimit,
        minWidth: rfNode.minWidth,
        maxWidth: rfNode.maxWidth,
        minHeight: rfNode.minHeight,
        maxHeight: rfNode.maxHeight,
        vectorNetwork: rfNode.vectorNetwork as any,
        fillGeometry: rfNode.fillGeometry as any,
        strokeGeometry: rfNode.strokeGeometry as any,
        arcData: rfNode.arcData as any,
        isMask: rfNode.isMask,
        maskType: rfNode.maskType,
        pointCount: rfNode.pointCount,
        starInnerRadius: rfNode.starInnerRadius,
        expanded: rfNode.expanded,
        autoRename: rfNode.autoRename,
        componentId: rfNode.componentId,
        boundVariables: rfNode.boundVariables,
        internalOnly: rfNode.internalOnly,
        // Convert GridTrack type difference
        gridTemplateColumns: rfNode.gridTemplateColumns?.map(reframeGridTrackToOP) ?? [],
        gridTemplateRows: rfNode.gridTemplateRows?.map(reframeGridTrackToOP) ?? [],
        gridColumnGap: rfNode.gridColumnGap,
        gridRowGap: rfNode.gridRowGap,
        gridPosition: rfNode.gridPosition,
        counterAxisAlignContent: rfNode.counterAxisAlignContent,
        itemReverseZIndex: rfNode.itemReverseZIndex,
        strokesIncludedInLayout: rfNode.strokesIncludedInLayout,
      };

      // OP's createDefaultNode spreads ...overrides last, so overrides.id
      // DOES win — opNode.id === rfNode.id in normal flow. We still
      // record both directions in case OP ever changes that contract OR
      // for nodes OP creates internally without bridge involvement
      // (e.g. the auto-added page wrapper).
      const opNode = opGraph.createNode(rfNode.type as any, opParentId, overrides);
      if (opNode) {
        this.opToReframeId.set(opNode.id, rfNode.id);
        this.reframeToOpId.set(rfNode.id, opNode.id);
      }

      // Recurse children — original used rfNode.id which only worked
      // because overrides.id wins. Keep that behavior.
      const rfChildren = rfGraph.getChildren(rfNode.id);
      for (const child of rfChildren) {
        copyNode(child, rfNode.id);
      }
    };

    // Copy all children of rfRootId into the OP page
    const rfRoot = rfGraph.getNode(rfRootId);
    if (rfRoot) {
      // If root is a CANVAS (page container), copy its children
      if (rfRoot.type === 'CANVAS') {
        const rfChildren = rfGraph.getChildren(rfRootId);
        for (const child of rfChildren) {
          copyNode(child, page.id);
        }
      } else {
        // Root is a direct frame — copy it and its children
        copyNode(rfRoot, page.id);
      }
    }

    return opGraph;
  }
}
