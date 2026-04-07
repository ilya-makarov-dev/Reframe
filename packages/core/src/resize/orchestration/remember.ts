/**
 * Orchestration — Remember (Format Master Capture)
 *
 * Captures the current selection as a format master layout.
 * Host-agnostic through IHost/INode.
 */

import { getHost } from '../../host/context';
import { NodeType } from '../../host/types';
import { buildAutoSessionSlotsFromFrame } from '../postprocess/session-slots';
import {
  bumpTempSerial,
  addTempCapture,
  setActiveTempId,
  type SessionSlotRow,
} from './session-state';

export interface RememberResult {
  success: boolean;
  message: string;
  tempId?: string;
  label?: string;
  slotCount?: number;
}

/**
 * Capture the currently selected frame as a format master (Remember).
 * Returns result info — caller handles UI notification.
 */
export function rememberAutoLayout(): RememberResult {
  const host = getHost();
  const selection = host.getSelection();

  if (selection.length !== 1 || selection[0]!.type !== NodeType.Frame) {
    return { success: false, message: 'Select one banner frame, then Remember' };
  }

  const frame = selection[0]!;
  const built = buildAutoSessionSlotsFromFrame(frame);

  if (built.length === 0) {
    return { success: false, message: 'No regions detected — check layers inside the frame' };
  }

  const serial = bumpTempSerial();
  const w = Math.round(frame.width);
  const h = Math.round(frame.height);
  const id = `temp-${Date.now()}`;
  const label = `temp ${serial} (${w}×${h})`;

  const slots: SessionSlotRow[] = built.map(b => ({
    sourceNodeId: b.sourceNodeId,
    slotType: b.slotType,
    element: { ...b.element },
  }));

  addTempCapture({ id, label, rootFrameId: frame.id, width: w, height: h, slots });
  setActiveTempId(id);

  return {
    success: true,
    message: `${label} · ${slots.length} regions`,
    tempId: id,
    label,
    slotCount: slots.length,
  };
}
