/**
 * Canva Host Adapter — implements IHost for the Canva Apps SDK.
 *
 * Works with Canva's openDesign API. The host wraps a design session
 * and provides the engine with INode access to the current page's elements.
 *
 * Usage:
 *   import { openDesign } from '@canva/design';
 *   import { CanvaHost } from './adapter';
 *
 *   await openDesign({ type: 'current_page' }, async (session) => {
 *     const host = new CanvaHost(session);
 *     const frame = host.getPageAsFrame();
 *     // Pass frame + host to reframe engine
 *   });
 */

import { type IHost, type INode, type IFontName, MIXED, type Mixed } from '../../host';
import { NodeType } from '../../host';
import {
  CanvaNodeAdapter, wrapCanvaElement, getCanvaNodeById, resetCanvaAdapterState,
  type CanvaElementLike,
} from './node';

// ─── Session Types ──────────────────────────────────────────────
// Structural types matching Canva's DesignEditing.CurrentPageSession

interface CanvaPageLike {
  readonly type: 'absolute' | string;
  readonly dimensions?: { width: number; height: number };
  readonly elements: {
    toArray(): CanvaElementLike[];
    count(): number;
    insertBefore?(ref: unknown, state: unknown): unknown;
    insertAfter?(ref: unknown, state: unknown): unknown;
  };
  readonly background?: unknown;
}

export interface CanvaSessionLike {
  readonly page: CanvaPageLike;
  readonly helpers?: {
    elementStateBuilder?: unknown;
  };
  sync(): Promise<void>;
}

// ─── Frame Wrapper ──────────────────────────────────────────────
// The engine expects the top-level container to be an INode (Frame).
// Canva's page isn't an element — we synthesize a virtual frame node.

class CanvaPageFrameNode implements INode {
  private _session: CanvaSessionLike;
  private _childNodes: CanvaNodeAdapter[];

  constructor(session: CanvaSessionLike) {
    this._session = session;
    const elements = session.page.elements.toArray();
    this._childNodes = elements.map(el => wrapCanvaElement(el, null));
  }

  // Identity
  readonly id = 'canva_page_frame';
  name = 'Page Frame';
  readonly type = NodeType.Frame;
  readonly removed = false;

  // Tree
  readonly parent = null;
  get children(): readonly INode[] { return this._childNodes; }
  appendChild(child: INode): void { /* managed via Canva ElementList */ }
  insertChild(_index: number, _child: INode): void {}
  clone(): INode { return new CanvaPageFrameNode(this._session); }
  remove(): void {}

  findAll(predicate: (node: INode) => boolean): INode[] {
    const result: INode[] = [];
    const walk = (node: INode) => {
      if (predicate(node)) result.push(node);
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    };
    for (const child of this._childNodes) walk(child);
    return result;
  }

  findOne(predicate: (node: INode) => boolean): INode | null {
    const walk = (node: INode): INode | null => {
      if (predicate(node)) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
      }
      return null;
    };
    for (const child of this._childNodes) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }

  // Geometry — page dimensions
  get x() { return 0; }
  set x(_v: number) {}
  get y() { return 0; }
  set y(_v: number) {}
  get width() { return this._session.page.dimensions?.width ?? 1920; }
  get height() { return this._session.page.dimensions?.height ?? 1080; }
  resize(_w: number, _h: number): void {}

  // Absolute transform
  get absoluteTransform(): [[number, number, number], [number, number, number]] {
    return [[1, 0, 0], [0, 1, 0]];
  }
  get absoluteBoundingBox() {
    return { x: 0, y: 0, width: this.width, height: this.height };
  }

  // Layout
  layoutMode: 'NONE' = 'NONE';
  layoutPositioning: 'ABSOLUTE' = 'ABSOLUTE';
  constraints = { horizontal: 'MIN', vertical: 'MIN' };
  clipsContent = true;

  // Visual — page background
  get fills() { return undefined; }
  set fills(_v: any) {}
  strokes = undefined;
  effects = undefined;
  cornerRadius = 0;
  strokeWeight = 0;
  opacity = 1;
  visible = true;
  rotation = 0;

  // Text (N/A)
  fontSize = undefined;
  fontName = undefined;
  characters = undefined;
  textAutoResize = undefined;
  textAlignHorizontal = undefined;
  textAlignVertical = undefined;
  exportSettings = undefined;
}

// ─── CanvaHost ──────────────────────────────────────────────────

export class CanvaHost implements IHost {
  readonly MIXED: Mixed = MIXED;
  private _session: CanvaSessionLike;
  private _pageFrame: CanvaPageFrameNode;

  constructor(session: CanvaSessionLike) {
    resetCanvaAdapterState();
    this._session = session;
    this._pageFrame = new CanvaPageFrameNode(session);
  }

  /** Get the virtual frame node representing the current page. */
  getPageAsFrame(): INode {
    return this._pageFrame;
  }

  /** Get page dimensions. */
  getPageDimensions(): { width: number; height: number } {
    return {
      width: this._pageFrame.width,
      height: this._pageFrame.height,
    };
  }

  /** Sync changes back to Canva. Call after engine mutations. */
  async syncToCanva(): Promise<void> {
    await this._session.sync();
  }

  // ── IHost implementation ──

  getNodeById(id: string): INode | null {
    if (id === 'canva_page_frame') return this._pageFrame;
    return getCanvaNodeById(id);
  }

  async loadFont(_font: IFontName): Promise<void> {
    // Canva manages fonts internally — no explicit loading needed.
    // The SDK uses fontRef (opaque references) rather than family+style.
  }

  groupNodes(nodes: INode[], parent: INode, _insertIndex?: number): INode {
    // Canva openDesign doesn't support runtime grouping.
    // Return a synthetic group for engine compatibility.
    const syntheticGroup: CanvaElementLike = {
      type: 'group',
      top: Math.min(...nodes.map(n => n.y)),
      left: Math.min(...nodes.map(n => n.x)),
      width: 0,
      height: 0,
      rotation: 0,
      transparency: 0,
      contents: {
        toArray() { return nodes.map(n => (n as CanvaNodeAdapter)._raw); },
        count() { return nodes.length; },
      },
    };
    return wrapCanvaElement(syntheticGroup, parent instanceof CanvaNodeAdapter ? parent : null, 'Synthetic Group');
  }

  notify(message: string, _options?: { error?: boolean; timeout?: number }): void {
    // In Canva apps, notifications go through the app UI (React).
    console.log(`[reframe/canva] ${message}`);
  }

  getSelection(): INode[] {
    // Canva openDesign doesn't have a selection concept within the session.
    // Return all page elements as the "selection".
    return [...(this._pageFrame.children ?? [])];
  }

  focusView(_nodes: INode[]): void {
    // Not supported in Canva Apps SDK
  }

  getEditorType(): string {
    return 'canva';
  }

  getFileKey(): string {
    return '';
  }
}
