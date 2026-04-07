/**
 * Orchestration — Session State
 *
 * Runtime state for Remember (format master) captures.
 * Host-agnostic: works through IHost/INode, no Figma dependency.
 */

import type { BannerElementType, GuideElement } from '../contracts/types';
import { getHost } from '../../host/context';
import { layoutAspectSpread } from '../geometry/aspect';

// ── Types ──

export interface SessionSlotRow {
  sourceNodeId: string;
  slotType: BannerElementType;
  element: GuideElement;
}

export interface TempCapture {
  id: string;
  label: string;
  rootFrameId: string;
  width: number;
  height: number;
  slots: SessionSlotRow[];
}

// ── Constants ──

export const ASPECT_MISMATCH_AUTO_STRICT = 0.14;
export const TARGET_MATCHES_REMEMBER_ASPECT = 0.04;

// ── Mutable State ──

let _tempCaptures: TempCapture[] = [];
let _tempSerial = 0;
let _activeTempId: string | null = null;
let _suppressTempSync = false;
let _tempBindingByFrameId = new Map<string, string>();

// ── Accessors ──

export function getTempCaptures(): TempCapture[] { return _tempCaptures; }
export function getActiveTempId(): string | null { return _activeTempId; }
export function getSuppressTempSync(): boolean { return _suppressTempSync; }
export function getTempBindingByFrameId(): Map<string, string> { return _tempBindingByFrameId; }

export function setActiveTempId(id: string | null): void {
  _activeTempId = id;
}

export function setSuppressTempSync(v: boolean): void {
  _suppressTempSync = v;
}

export function resetSessionCaptures(): void {
  _tempCaptures = [];
  _tempSerial = 0;
  _activeTempId = null;
  _tempBindingByFrameId = new Map();
}

export function bumpTempSerial(): number {
  _tempSerial += 1;
  return _tempSerial;
}

export function addTempCapture(cap: TempCapture): void {
  _tempCaptures.push(cap);
}

export function bindTempToFrame(frameId: string, tempId: string): void {
  _tempBindingByFrameId.set(frameId, tempId);
}

// ── Queries ──

export function getActiveCapture(): TempCapture | null {
  if (_tempCaptures.length === 0) return null;
  if (_activeTempId) {
    const hit = _tempCaptures.find(c => c.id === _activeTempId);
    if (hit) return hit;
  }
  return _tempCaptures[_tempCaptures.length - 1]!;
}

export function pickBestSameRootCapture(frameId: string, frameW: number, frameH: number): TempCapture | null {
  const same = _tempCaptures.filter(c => c.rootFrameId === frameId && c.slots.length > 0);
  if (same.length === 0) return null;
  same.sort((a, b) => {
    const da = Math.abs(a.width - frameW) + Math.abs(a.height - frameH);
    const db = Math.abs(b.width - frameW) + Math.abs(b.height - frameH);
    return da - db;
  });
  return same[0]!;
}

export function syncTempCaptureLabel(c: TempCapture): void {
  const m = c.label.match(/^(temp\s+\d+)/);
  if (m) {
    c.label = `${m[1]} (${c.width}×${c.height})`;
  }
}

export function pickCaptureMatchingTargetAspect(newW: number, newH: number, excludeId?: string): TempCapture | null {
  let best: TempCapture | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of _tempCaptures) {
    if (t.slots.length === 0) continue;
    if (excludeId != null && t.id === excludeId) continue;
    if (layoutAspectSpread(newW, newH, t.width, t.height) > TARGET_MATCHES_REMEMBER_ASPECT) continue;
    const score = Math.abs(t.width - newW) + Math.abs(t.height - newH);
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

export function pickCaptureMatchingSourceAspect(sourceW: number, sourceH: number, excludeId?: string): TempCapture | null {
  let best: TempCapture | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const t of _tempCaptures) {
    if (t.slots.length === 0) continue;
    if (excludeId != null && t.id === excludeId) continue;
    const spread = layoutAspectSpread(sourceW, sourceH, t.width, t.height);
    const sizeScore = Math.abs(t.width - sourceW) + Math.abs(t.height - sourceH);
    const score = spread * 1e6 + sizeScore;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/**
 * Verify all slot sourceNodeIds still exist under the given frame.
 * Uses IHost abstraction.
 */
export function tempSlotsAllUnderFrame(cap: TempCapture, frameId: string): boolean {
  if (cap.slots.length === 0) return false;
  const host = getHost();
  for (const s of cap.slots) {
    const n = host.getNodeById(s.sourceNodeId);
    if (!n || n.removed) return false;
    let p = n.parent;
    let under = false;
    while (p) {
      if (p.id === frameId) {
        under = true;
        break;
      }
      if ((p.type as string) === 'PAGE' || (p.type as string) === 'DOCUMENT') break;
      p = p.parent;
    }
    if (!under) return false;
  }
  return true;
}
