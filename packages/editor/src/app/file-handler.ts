/**
 * File Handler — drag & drop and file picker for .fig/.pen files.
 *
 * When user drags a .fig file onto the editor or uses File > Open,
 * this module reads the file, imports via OpenPencil's parseFigFile,
 * and loads into the editor viewport.
 */

import { parseFigFile, computeAllLayouts } from '@open-pencil/core';
import type { ReframeEditorShell } from '../canvas/editor-shell.js';

export interface FileHandlerCallbacks {
  onFileLoading?: (filename: string) => void;
  onFileLoaded?: (filename: string, nodeCount: number) => void;
  onFileError?: (filename: string, error: string) => void;
}

/**
 * Setup drag & drop on the canvas area.
 * Returns cleanup function.
 */
export function setupFileDragDrop(
  dropTarget: HTMLElement,
  shell: ReframeEditorShell,
  callbacks: FileHandlerCallbacks = {},
): () => void {
  function onDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropTarget.style.outline = '2px solid #2563eb';
    dropTarget.style.outlineOffset = '-2px';
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    dropTarget.style.outline = 'none';
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropTarget.style.outline = 'none';

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'fig') {
      await openFigFile(file, shell, callbacks);
    } else if (ext === 'pen') {
      // TODO: OpenPencil .pen format support
      callbacks.onFileError?.(file.name, 'pen format not yet supported');
    } else {
      callbacks.onFileError?.(file.name, `Unsupported format: .${ext}`);
    }
  }

  dropTarget.addEventListener('dragover', onDragOver);
  dropTarget.addEventListener('dragleave', onDragLeave);
  dropTarget.addEventListener('drop', onDrop);

  return () => {
    dropTarget.removeEventListener('dragover', onDragOver);
    dropTarget.removeEventListener('dragleave', onDragLeave);
    dropTarget.removeEventListener('drop', onDrop);
  };
}

/**
 * Open a .fig file via file picker dialog.
 */
export function openFileDialog(
  shell: ReframeEditorShell,
  callbacks: FileHandlerCallbacks = {},
): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.fig,.pen';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'fig') {
      await openFigFile(file, shell, callbacks);
    }
  };

  input.click();
}

/**
 * Import a .fig file into the editor.
 */
async function openFigFile(
  file: File,
  shell: ReframeEditorShell,
  callbacks: FileHandlerCallbacks,
): Promise<void> {
  callbacks.onFileLoading?.(file.name);

  try {
    const buffer = await file.arrayBuffer();
    const opGraph = await parseFigFile(buffer);

    // Replace editor graph
    shell.editor.replaceGraph(opGraph);

    // Compute layout
    computeAllLayouts(shell.editor.graph);

    // Zoom to fit
    shell.editor.zoomToFit();
    shell.editor.requestRender();

    // Count nodes
    let nodeCount = 0;
    for (const _ of shell.editor.graph.getAllNodes()) nodeCount++;

    // Extract reframe extensions (semantic roles, etc.) from imported graph
    // TODO: run semantic classification on imported .fig nodes

    callbacks.onFileLoaded?.(file.name, nodeCount);
  } catch (err: any) {
    callbacks.onFileError?.(file.name, err.message);
  }
}
