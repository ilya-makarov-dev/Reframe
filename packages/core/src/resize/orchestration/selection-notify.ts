/**
 * Orchestration — Selection Notification
 *
 * Reads current host selection and builds a CodeToUIMessage payload.
 * Host-agnostic through IHost.
 */

import { getHost } from '../../host/context';
import { NodeType } from '../../host/types';
import type { CodeToUIMessage, SessionSlotBrief, TempCaptureBrief } from '../contracts/types';
import {
  getTempCaptures,
  getActiveTempId,
  setActiveTempId,
  getTempBindingByFrameId,
} from './session-state';

function syncActiveTempToSelection(
  frameId: string,
  frameW: number,
  frameH: number,
): void {
  const tempCaptures = getTempCaptures();
  const activeTempId = getActiveTempId();
  const tempBindingByFrameId = getTempBindingByFrameId();
  if (tempCaptures.length === 0) return;

  const boundTempId = tempBindingByFrameId.get(frameId);
  if (boundTempId && activeTempId === boundTempId) return;
  if (boundTempId && tempCaptures.some(c => c.id === boundTempId)) {
    setActiveTempId(boundTempId);
    return;
  }

  const matches = tempCaptures.filter(c => c.rootFrameId === frameId);
  if (matches.length === 0) {
    setActiveTempId(null);
    return;
  }

  const active = activeTempId ? tempCaptures.find(c => c.id === activeTempId) : undefined;
  if (active && active.rootFrameId === frameId) return;

  matches.sort((a, b) => {
    const da = Math.abs(a.width - frameW) + Math.abs(a.height - frameH);
    const db = Math.abs(b.width - frameW) + Math.abs(b.height - frameH);
    return da - db;
  });
  setActiveTempId(matches[0]!.id);
}

export interface SelectionNotifyOptions {
  skipTempSync?: boolean;
}

/**
 * Build a selection-changed message from the current host selection.
 * Returns the message payload — caller decides how to deliver it (postMessage, callback, etc).
 */
export function buildSelectionChangedMessage(
  opts?: SelectionNotifyOptions,
): CodeToUIMessage & { type: 'selection-changed' } {
  const host = getHost();
  const selection = host.getSelection();
  const tempCaptures = getTempCaptures();
  const activeTempId = getActiveTempId();

  let framePayload: { id: string; name: string; width: number; height: number } | null = null;

  if (selection.length === 1) {
    const node = selection[0]!;
    if (node.type === NodeType.Frame || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
      framePayload = {
        id: node.id,
        name: node.name,
        width: Math.round(node.width),
        height: Math.round(node.height),
      };
      if (!opts?.skipTempSync) {
        syncActiveTempToSelection(framePayload.id, framePayload.width, framePayload.height);
      }
    }
  }

  let selectedLeaf: { name: string; type: string } | null = null;
  if (selection.length === 1) {
    selectedLeaf = { name: selection[0]!.name, type: selection[0]!.type };
  }

  const active = getActiveTempId() != null
    ? tempCaptures.find(c => c.id === getActiveTempId()) ?? null
    : null;

  const sessionRoot = active
    ? {
        id: active.rootFrameId,
        name: active.label,
        width: active.width,
        height: active.height,
      }
    : null;

  const sessionSlots: SessionSlotBrief[] = active
    ? active.slots.map(s => ({
        slotType: s.slotType,
        nodeName: s.element.name,
        nodeId: s.sourceNodeId,
      }))
    : [];

  const tempBrief: TempCaptureBrief[] = tempCaptures.map(c => ({
    id: c.id,
    label: c.label,
    rootFrameId: c.rootFrameId,
    width: c.width,
    height: c.height,
    regionCount: c.slots.length,
  }));

  return {
    type: 'selection-changed',
    frame: framePayload,
    sessionRoot,
    selectedLeaf,
    sessionSlots: sessionSlots,
    tempCaptures: tempBrief,
    activeTempId: getActiveTempId(),
  };
}
