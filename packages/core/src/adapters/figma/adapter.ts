/// <reference types="@figma/plugin-typings" />
/**
 * Figma Host Adapter — implements IHost using the Figma Plugin API.
 */

import { type IHost, type INode, type IFontName, MIXED, type Mixed } from '../../host';
import { wrapFigmaNode } from './node';

export class FigmaHost implements IHost {
  readonly MIXED: Mixed = MIXED;

  getNodeById(id: string): INode | null {
    const raw = figma.getNodeById(id);
    if (!raw || raw.removed) return null;
    if (!('type' in raw) || (raw as any).type === 'PAGE' || (raw as any).type === 'DOCUMENT') return null;
    return wrapFigmaNode(raw as SceneNode);
  }

  async getNodeByIdAsync(id: string): Promise<INode | null> {
    if (typeof figma.getNodeByIdAsync !== 'function') return this.getNodeById(id);
    const raw = await figma.getNodeByIdAsync(id);
    if (!raw || raw.removed) return null;
    if (!('type' in raw) || (raw as any).type === 'PAGE' || (raw as any).type === 'DOCUMENT') return null;
    return wrapFigmaNode(raw as SceneNode);
  }

  async loadFont(font: IFontName): Promise<void> {
    await figma.loadFontAsync(font as FontName);
  }

  groupNodes(nodes: INode[], parent: INode, insertIndex?: number): INode {
    const rawNodes = nodes.map(n => (n as any)._raw as SceneNode);
    const rawParent = (parent as any)._raw;
    const group = insertIndex != null
      ? figma.group(rawNodes, rawParent, insertIndex)
      : figma.group(rawNodes, rawParent);
    return wrapFigmaNode(group);
  }

  notify(message: string, options?: { error?: boolean; timeout?: number }): void {
    figma.notify(message, options);
  }

  getSelection(): INode[] {
    return figma.currentPage.selection.map(n => wrapFigmaNode(n));
  }

  focusView(nodes: INode[]): void {
    const rawNodes = nodes.map(n => (n as any)._raw as SceneNode);
    figma.viewport.scrollAndZoomIntoView(rawNodes);
  }

  getEditorType(): string {
    return (figma as any).editorType ?? 'figma';
  }

  getFileKey(): string {
    return (figma as any).fileKey ?? '';
  }
}
