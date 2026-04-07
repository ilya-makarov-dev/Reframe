import { type INode, type IPaint, type ISolidPaint, NodeType, MIXED } from '../../host';
import { getHost } from '../../host/context';
import { engineLog } from '../logging';

import {
  getBoundsInFrame,
  getLayoutBoundsInFrame,
  setPositionInFrame,
  ensureNoClippingOnPathToRoot,
  isDimensionLikeName,
  isRunawayBoundsVersusFrame,
  frameIntersectionArea,
  isNegligibleOverlapWithFrame,
  isTechnicalArtifactName,
  subtreeHasDesignContent,
  neutralizeFigmaLayoutInterference
} from './layout-utils';
import {
  stretchBackgroundNonUniformToFill,
  freezeConstraintsSubtree
} from '../scaling/scaler';
import type { ExactSessionGeometryOptions, ExactSessionPlacement } from './exact-session-types';
import { compareExactSessionStableOrder } from './session-placement-order';
import {
  alignVisualCenterToFramePoint,
  horizontalOverlapFraction,
  snapAgeRatingVisualToRememberSlot
} from './semantic-slot-geometry';
import {
  applyRememberToShapeNode,
  applyRememberToTextNode,
  hoistSessionSlotToBannerRoot,
  resolveExactSessionLayout,
  resolveAlignSourceBasis
} from './session-slots';
import { computePixelRectFromSourceLayoutBounds } from './exact-session-placements';
import type { GuideElement } from '../contracts/types';

/**
 * [Production Strategy: Sacred Structural Integrity]
 * [Legacy Compatibility] Preserving signature (frame, tw, th, placements, options),
 * since plugin-scale-handler.ts calls it exactly this way.
 * Otherwise placements.map throws "not a function" when receiving targetWidth (number).
 */
export async function applyExactSessionPostProcess(
  frame: INode,
  targetWidth: number,
  targetHeight: number,
  placements: ExactSessionPlacement[],
  options: ExactSessionGeometryOptions,
  _extraOptions?: {
    trustSyncedPlacementRects?: boolean;
    trace?: string[];
    /** Cross-master: non-slot direct children of the frame (img, CTA groups) by the same fractions as slots -- from live source. */
    crossSourceLayoutAlign?: { sourceFrame: INode; sourceToResult: Map<string, string> };
    /** Optional design system for brand-aware adaptation. */
    designSystem?: import('../../design-system/types').DesignSystem;
  }
): Promise<void> {
  const trace = _extraOptions?.trace || [];
  const ds = _extraOptions?.designSystem;
  const t = (msg: string) => {
    const s = `[Trace] ${msg}`;
    console.log(s);
    trace.push(s);
    engineLog.trace(s);
  };

  try {
    const isCross = options.mode === 'cross';
    t(`START: frame=${frame.name} (${targetWidth}x${targetHeight}) mode=${options.mode}`);

    /** [0] Background Styling (Fill Sync)
     * In cross mode the result should visually match the MASTER, not the source.
     * Try: master frame fills -> master bg vector fills (skip white) -> source frame fills.
     */
    if (options.mode === 'cross') {
      let syncedFills = false;
      const bgPlacement = placements.find(p => p.slotType === 'background');
      if (bgPlacement?.masterSourceNodeId) {
        try {
          const masterBgNode = getHost().getNodeById(bgPlacement.masterSourceNodeId) as INode | null;
          const masterFrame = masterBgNode?.parent;
          // 1) Master frame fills
          if (masterFrame && masterFrame.type === NodeType.Frame && 'fills' in masterFrame) {
            const mfFills = masterFrame.fills as readonly IPaint[];
            if (mfFills.length > 0) {
              frame.fills = JSON.parse(JSON.stringify(mfFills));
              t(`SYNC: copying fills from master frame ${masterFrame.id} to result frame`);
              syncedFills = true;
            }
          }
          // 2) Master bg vector fills (skip pure-white)
          if (!syncedFills && masterBgNode && 'fills' in masterBgNode && masterBgNode.fills !== MIXED) {
            const vFills = masterBgNode.fills as readonly IPaint[];
            const allWhite = vFills.length > 0 && vFills.every(
              f => f.type === 'SOLID' && (f as ISolidPaint).color.r > 0.98 && (f as ISolidPaint).color.g > 0.98 && (f as ISolidPaint).color.b > 0.98
            );
            if (vFills.length > 0 && !allWhite) {
              frame.fills = JSON.parse(JSON.stringify(vFills));
              t(`SYNC: copying fills from master bg vector ${masterBgNode.id} to result frame`);
              syncedFills = true;
            }
          }
        } catch (_) {}
      }
      if (!syncedFills && _extraOptions?.crossSourceLayoutAlign?.sourceFrame) {
        const sf = _extraOptions.crossSourceLayoutAlign.sourceFrame;
        t(`SYNC: copying fills from source frame ${sf.id} to result frame (fallback)`);
        if ('fills' in sf && 'fills' in frame) {
          frame.fills = JSON.parse(JSON.stringify(sf.fills));
        }
      }
      // [Validation] If frame fill is still white/transparent, force solid black.
      const frameFills = Array.isArray(frame.fills) ? frame.fills : [];
      const frameHasVisibleDark = frameFills.some((f: IPaint) => {
        if ((f as any).visible === false) return false;
        const op = (f as any).opacity ?? 1;
        if (op < 0.1) return false;
        if (f.type === 'SOLID') {
          const c = (f as any).color;
          return !(c.r > 0.95 && c.g > 0.95 && c.b > 0.95);
        }
        return true;
      });
      if (!frameHasVisibleDark) {
        frame.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 } as IPaint];
        t(`SYNC: forced solid black frame fill (previous fills were white/transparent/empty)`);
      }
    }

    /** [Sanitize] Freeze constraints so the host doesn't "stretch" layers on root resize */
    freezeConstraintsSubtree(frame);

    const nodeById = new Map<string, INode>();
    frame.findAll!(n => {
      nodeById.set(n.id, n as INode);
      return false;
    });

    const slotIds = new Set(placements.map(p => p.resultNodeId));
    const keeperIds = new Set<string>();

    /**
     * [Production Strategy: Design Roots Protection]
     * In 'cross' mode (aspect change) we must preserve all objects that were
     * found as correct clones from the source design.
     */
    if (isCross && _extraOptions?.crossSourceLayoutAlign?.sourceToResult) {
      for (const resultId of _extraOptions.crossSourceLayoutAlign.sourceToResult.values()) {
        keeperIds.add(resultId);
      }
    }

    /**
     * [Master Bounds Index] Resolve master frame and build name->bounds map once,
     * shared by both SHAPE SYNC (Phase 5) and ALIGN for non-slot root children.
     * Built for BOTH strict and cross modes — strict needs it for SHAPE SYNC too.
     */
    const masterBoundsByName = new Map<string, { x: number; y: number; w: number; h: number }>();
    if (placements.length > 0) {
      let mf: INode | null = null;

      if (isCross) {
        // Cross: find master frame from masterSourceNodeId
        for (const p of placements) {
          if (p.masterSourceNodeId) {
            try {
              const mn = getHost().getNodeById(p.masterSourceNodeId);
              if (mn?.parent?.type === NodeType.Frame) { mf = mn.parent as INode; break; }
            } catch { /* ignore */ }
          }
        }
      } else {
        // Strict: master = source frame (capture root). Find via sourceFrameId or from resultNodeId's parent.
        if (options.sourceFrameId) {
          try { mf = getHost().getNodeById(options.sourceFrameId) as INode | null; } catch { /* ignore */ }
        }
      }

      if (mf) {
        const mW = Math.max(mf.width, 1e-6);
        const mH = Math.max(mf.height, 1e-6);
        mf.findAll!(mn => {
          if (!('name' in mn)) return false;
          const name = mn.name as string;
          if (masterBoundsByName.has(name)) return false;
          const mb = getBoundsInFrame(mn as INode, mf!);
          const l = mb.x / mW;
          const tp = mb.y / mH;
          if (l >= -0.3 && l <= 1.3 && tp >= -0.3 && tp <= 1.3 && mb.w > 1 && mb.h > 1) {
            masterBoundsByName.set(name, {
              x: (mb.x / mW) * targetWidth,
              y: (mb.y / mH) * targetHeight,
              w: (mb.w / mW) * targetWidth,
              h: (mb.h / mH) * targetHeight
            });
          }
          return false;
        });
      }
    }

    /** [1] Dissolve Technical Wrappers (Structural Integrity) */
    t('Phase 1/5: Dissolve Wrappers');
    dissolveTechnicalWrappers(frame, slotIds);

    /** [1.5] Shatter Multi-Slot Containers (Unified Visual Authority) */
    if (isCross) {
      t('Phase 1.5/5: Shatter Multi-Slot Containers');
      shatterMultiSlotContainers(frame, slotIds, t);
    }

    /** [2] Selective Hoisting & Forced Flattening (Hardened) */
    t('Phase 2/5: Selective Hoisting');
    for (const p of placements) {
      const node = nodeById.get(p.resultNodeId);
      if (node) {
        const hoistedId = hoistSessionSlotToBannerRoot(node, frame, p.slotType);
        if (hoistedId) {
          t(`Hoisted container for ${p.slotType}: ${hoistedId}`);
          keeperIds.add(hoistedId);
        }

        let ancestorIsKeeper = false;
        {
          let anc: INode | null = node.parent;
          while (anc && anc !== frame) {
            if (keeperIds.has(anc.id)) { ancestorIsKeeper = true; break; }
            anc = anc.parent;
          }
        }

        if (node.parent !== frame && !ancestorIsKeeper) {
          const b = getBoundsInFrame(node, frame);
          t(`Forced root hoist for ${p.slotType} node ${node.id} from ${node.parent?.name}`);
          frame.appendChild!(node);
          neutralizeFigmaLayoutInterference(node, frame);
          node.x = Math.round(b.x);
          node.y = Math.round(b.y);
        }

        keeperIds.add(node.id);
        ensureNoClippingOnPathToRoot(node, frame);
      }
    }

    /** [3] Total Cleanup (Purge Mode) */
    t('Phase 3/5: Nuclear Purge');
    const hasBackgroundSlot = placements.some(p => p.slotType === 'background');

    for (const child of [...(frame.children ?? [])]) {
      if (!child || child.removed) continue;

      const name = (child.name || '').toLowerCase();
      const isDimensionGroup = isDimensionLikeName(name);
      const _isTechArtifact = isTechnicalArtifactName(name);

      if (slotIds.has(child.id)) {
        t(`KEEP: slot ${child.id} (${name})`);
        continue;
      }

      const b = getBoundsInFrame(child as INode, frame);
      const isOutside = b.x > frame.width + 10 || b.y > frame.height + 10 || (b.x + b.w) < -10 || (b.y + b.h) < -10;
      if (isOutside && !isDimensionGroup) {
        t(`PURGE: deleting ${child.id} (${name}) -- outside frame bounds (${Math.round(b.x)}, ${Math.round(b.y)})`);
        try { child.remove!(); } catch (_) {}
        continue;
      }

      if (!isDimensionGroup && isNegligibleOverlapWithFrame(b, frame.width, frame.height)) {
        if (
          tryMergeNegligibleDuplicateIntoKeeper(
            child as INode,
            frame,
            keeperIds,
            t
          )
        ) {
          continue;
        }
        const inter = Math.round(frameIntersectionArea(b, frame.width, frame.height));
        t(
          `PURGE: deleting ${child.id} (${name}) -- mostly outside frame (${Math.round(b.w)}x${Math.round(b.h)} bbox, ~${inter}px2 overlap vs ${Math.round(b.w * b.h)}px2)`
        );
        try {
          child.remove!();
        } catch (_) {}
        continue;
      }

      const hasContent = subtreeHasDesignContent(child as INode);
      if (hasContent) {
        if (isRunawayBoundsVersusFrame(b, frame.width, frame.height)) {
          t(
            `PURGE: deleting ${child.id} (${name}) -- runaway bounds ${Math.round(b.w)}x${Math.round(b.h)} vs frame (orphan after hoist/letterbox)`
          );
          try {
            child.remove!();
          } catch (_) {}
          continue;
        }
        t(`KEEP: content subtree detected in ${child.type} ${child.id} (${name})`);
        continue;
      }

      if (keeperIds.has(child.id) && !isDimensionGroup) {
        const frameArea = frame.width * frame.height;
        const nodeArea = b.w * b.h;
        const isLargeOverlayVector = (child.type === NodeType.Vector || child.type === NodeType.Rectangle) && nodeArea > frameArea * 0.5;
        const isRunawayGroup = (child.type === NodeType.Group || child.type === NodeType.Frame) && nodeArea > frameArea * 4;
        if (hasBackgroundSlot && (isLargeOverlayVector || isRunawayGroup)) {
          t(`PURGE: deleting overlay keeper ${child.id} (${name}) -- ${Math.round(b.w)}x${Math.round(b.h)}, no design content`);
          try { child.remove!(); } catch (_) {}
          continue;
        }
        t(`KEEP: keeper ${child.id} (${name})`);
        continue;
      }
      if (child.type === NodeType.Instance) {
        t(`KEEP: instance ${child.id} (${name})`);
        continue;
      }

      t(`PURGE: deleting ${child.id} (${name}) (empty or tech artifact)`);
      try {
        child.remove!();
      } catch (err) {
        t(`PURGE ERROR: ${String(err)} -> hiding instead`);
        try { if ('visible' in child) child.visible = false; } catch (__) {}
      }
    }

    /** [4] Layout Resolution */
    t('Phase 4/5: Resolution');
    const { Rw, Rh, u, ox, oy } = resolveExactSessionLayout(targetWidth, targetHeight, options);
    const ordered = [...placements].sort(compareExactSessionStableOrder);

    let titleBottomY: number | null = null;
    let titleSlotForStack: { x: number; y: number; w: number; h: number } | null = null;
    /** [5] Final Positioning & Style Sync */
    t('Phase 5/5: Absolute Positioning');

    const movedRepresentativeIds = new Set<string>();

    for (const p of ordered) {
      try {
        const node = nodeById.get(p.resultNodeId);
        if (!node || node.removed) {
          t(`SKIP: slot ${p.slotType} node missing/removed`);
          continue;
        }

        if ('visible' in node) node.visible = true;
        neutralizeFigmaLayoutInterference(node, frame);

        const trustSynced = options.trustSyncedPlacementRects === true || _extraOptions?.trustSyncedPlacementRects === true;
        const left = p.element.left ?? 0;
        const top = p.element.top ?? 0;
        const wr = p.element.widthRatio ?? 0;
        const hr = p.element.heightRatio ?? 0;

        const px = (trustSynced && p.x !== undefined) ? p.x : ox + left * Rw;
        const py = (trustSynced && p.y !== undefined) ? p.y : oy + top * Rh;
        const nw = (trustSynced && p.w !== undefined) ? p.w : wr * Rw;
        const nh = (trustSynced && p.h !== undefined) ? p.h : hr * Rh;

        if (p.slotType === 'background') {
          t(`SNAP: pinning background ${node.id} to 0,0 (${targetWidth}x${targetHeight})`);
          node.x = 0;
          node.y = 0;
          if (node.resize) node.resize(targetWidth, targetHeight);
          stretchBackgroundNonUniformToFill(node, targetWidth, targetHeight);
          // Copy background fills from the master.
          if (p.masterSourceNodeId && 'fills' in node) {
            try {
              const masterBgNode = getHost().getNodeById(p.masterSourceNodeId) as INode | null;
              const masterFrame = masterBgNode?.parent;
              let applied = false;

              // 1) Try master background vector fills (skip if all-white)
              if (masterBgNode && 'fills' in masterBgNode && masterBgNode.fills !== MIXED) {
                const vFills = masterBgNode.fills as readonly IPaint[];
                const allWhite = vFills.length > 0 && vFills.every(
                  f => f.type === 'SOLID' && (f as ISolidPaint).color.r > 0.98 && (f as ISolidPaint).color.g > 0.98 && (f as ISolidPaint).color.b > 0.98
                );
                if (vFills.length > 0 && !allWhite) {
                  node.fills = JSON.parse(JSON.stringify(vFills));
                  t(`BG FILL: copied ${vFills.length} fills from master vector ${p.masterSourceNodeId}`);
                  applied = true;
                }
              }
              // 2) Fallback: master frame fills
              if (!applied && masterFrame && masterFrame.type === NodeType.Frame && 'fills' in masterFrame) {
                const fFills = masterFrame.fills as readonly IPaint[];
                if (fFills.length > 0) {
                  node.fills = JSON.parse(JSON.stringify(fFills));
                  t(`BG FILL: copied ${fFills.length} fills from master frame ${masterFrame.id}`);
                  applied = true;
                }
              }
            } catch (_) {}
          }
          // [Validation] If the background vector ended up with no visible fills
          if ('fills' in node) {
            const currentFills = node.fills;
            const fills = Array.isArray(currentFills) ? currentFills : [];
            const hasVisibleNonWhite = fills.some((f: IPaint) => {
              if ((f as any).visible === false) return false;
              const op = (f as any).opacity ?? 1;
              if (op < 0.1) return false;
              if (f.type === 'SOLID') {
                const c = (f as any).color;
                return !(c.r > 0.95 && c.g > 0.95 && c.b > 0.95);
              }
              return true; // gradients, images -> assume visible
            });
            if (!hasVisibleNonWhite) {
              node.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
              t(`BG FILL: forced solid black (previous fills were white/transparent/empty)`);
            }
          }
          keeperIds.add(node.id);
          continue;
        }

        /** [5.1] Style Sync */
        if (node.type === NodeType.Text) {
          t(`TEXT(cross): applying Remember + resize to ${p.slotType} ${node.id} (${Math.round(nw)}x${Math.round(nh)})`);
          await applyRememberToTextNode(node, p.element, targetWidth, targetHeight, nw, nh, ds, p.slotType);
        } else {
          t(`SHAPE(cross): applying Remember + resize to ${p.slotType} ${node.id} (${Math.round(nw)}x${Math.round(nh)})`);
          applyRememberToShapeNode(node, p.element, targetWidth, targetHeight, nw, nh, ds, p.slotType);
        }

        /** [5.2] Representative Node Movement (Visual Unity) */
        const findRepresentative = (n: INode): INode => {
          let curr = n;
          while (curr.parent && curr.parent !== frame && !('type' in curr.parent && (curr.parent.type as string) === 'PAGE')) {
            curr = curr.parent as INode;
          }
          return curr;
        };

        const rep = findRepresentative(node);
        if (movedRepresentativeIds.has(rep.id)) {
          if (rep !== node) {
            const currentBounds = getBoundsInFrame(node, frame);
            const dx = px - currentBounds.x;
            const dy = py - currentBounds.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
              node.x = Math.round(node.x + dx);
              node.y = Math.round(node.y + dy);
              t(`MOVE(intra-rep): slot ${node.id} shifted by ${Math.round(dx)},${Math.round(dy)} inside rep ${rep.id}`);
            }
          } else {
            // Rep was previously moved for a CHILD slot. Now the rep itself is a slot (e.g. button frame).
            // Re-position to its own target — the earlier MOVE(rep) placed it for the child, not for itself.
            const currentBounds = getBoundsInFrame(node, frame);
            const dx = px - currentBounds.x;
            const dy = py - currentBounds.y;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
              t(`MOVE(self-rep): re-positioning ${p.slotType} ${node.id} by ${dx.toFixed(1)},${dy.toFixed(1)} -> ${px},${py}`);
              setPositionInFrame(node, frame, px, py);
            }
          }
        } else {
          if (p.slotType === 'logo' || p.slotType === 'other') {
            t(`CENTER(rep): ${p.slotType} to ${Math.round(px + nw / 2)},${Math.round(py + nh / 2)} (via rep ${rep.id})`);
            alignVisualCenterToFramePoint(rep, frame, px + nw / 2, py + nh / 2);
          } else if (p.slotType === 'ageRating' && node.type === NodeType.Text) {
            // First position at target, then let snap fine-tune alignment.
            // Without this, cross-mode ageRating stays at letterbox position (snap caps out on large displacements).
            setPositionInFrame(node, frame, px, py);
            t(`AGE: snapping rating to ${px},${py}`);
            snapAgeRatingVisualToRememberSlot(node, frame, px, py, nw, nh, p.element);
          } else {
            const currentBounds = getBoundsInFrame(node, frame);
            const dx = px - currentBounds.x;
            const dy = py - currentBounds.y;

            if (rep === node) {
              t(`MOVE: slot ${node.id} is its own representative -> to ${px},${py}`);
              setPositionInFrame(node, frame, px, py);
            } else {
              const repBounds = getBoundsInFrame(rep, frame);
              t(`MOVE(rep): sliding group ${rep.id} by ${dx.toFixed(1)},${dy.toFixed(1)} to satisfy slot ${node.id}`);
              setPositionInFrame(rep, frame, repBounds.x + dx, repBounds.y + dy);
            }
          }
          movedRepresentativeIds.add(rep.id);

          // Resize sibling shape nodes (pill/rect backgrounds) when a TEXT slot lives inside a GROUP
          if (node.type === NodeType.Text && rep !== node && rep.type === NodeType.Group) {
            // Find which direct child of rep is an ancestor of (or is) the slot node.
            // We must skip it — MOVE(rep) already positioned rep so that node lands correctly;
            // shifting the slot's own container would undo that placement.
            let slotBranchId: string | null = null;
            {
              let cur: INode | null = node;
              while (cur && cur !== rep) {
                if (cur.parent && (cur.parent as INode).id === rep.id) { slotBranchId = cur.id; break; }
                cur = (cur.parent as INode) ?? null;
              }
            }
            try {
              for (const sibling of rep.children!) {
                if (sibling.id === node.id || sibling.id === slotBranchId) continue;
                if (sibling.type === NodeType.Vector || sibling.type === NodeType.Rectangle || sibling.type === NodeType.Ellipse) {
                  if (!sibling.resize) continue;
                  const padX = Math.round(nw * 0.06);
                  const padY = Math.round(nh * 0.28);
                  const pillW = Math.max(1, Math.round(nw + padX * 2));
                  const pillH = Math.max(1, Math.round(nh + padY * 2));
                  sibling.resize!(pillW, pillH);
                  sibling.x = Math.round(px - padX);
                  sibling.y = Math.round(py - padY);
                  t(`SHAPE SYNC: resized sibling ${sibling.type} ${sibling.id} to ${pillW}x${pillH} at ${Math.round(px - padX)},${Math.round(py - padY)}`);
                } else if (sibling.type === NodeType.Group || sibling.type === NodeType.Frame) {
                  const sibBounds = getBoundsInFrame(sibling as INode, frame);
                  const rawDx = Math.abs(px - sibBounds.x);
                  const rawDy = Math.abs(py - sibBounds.y);
                  const repBoundsForThreshold = getBoundsInFrame(rep, frame);
                  const maxSpan = Math.max(nw, sibBounds.w, nh, sibBounds.h, repBoundsForThreshold.w, repBoundsForThreshold.h, 50);
                  if (rawDx > maxSpan * 1.5 || rawDy > maxSpan * 1.5) {
                    t(`SHAPE SYNC: SKIP sibling GROUP ${sibling.id} (${sibling.name}) -- displacement ${Math.round(rawDx)},${Math.round(rawDy)} exceeds threshold ${Math.round(maxSpan * 1.5)}`);
                  } else {
                  const masterSibMatch = masterBoundsByName.get(sibling.name);
                  if (masterSibMatch && sibBounds.w > 1 && sibBounds.h > 1) {
                    const sx = masterSibMatch.w / sibBounds.w;
                    const sy = masterSibMatch.h / sibBounds.h;
                    if (sibling.children) {
                      for (const ch of [...sibling.children!]) {
                        if (ch.resize) {
                          const cw = ch.width;
                          const ch2 = ch.height;
                          if (cw > 0 && ch2 > 0) {
                            ch.resize(Math.max(1, Math.round(cw * sx)), Math.max(1, Math.round(ch2 * sy)));
                          }
                        }
                        ch.x = Math.round((ch.x - sibBounds.x) * sx + masterSibMatch.x);
                        ch.y = Math.round((ch.y - sibBounds.y) * sy + masterSibMatch.y);
                      }
                    }
                    t(`SHAPE SYNC: resized sibling GROUP ${sibling.id} children by ${sx.toFixed(2)}x${sy.toFixed(2)} (master match ${Math.round(masterSibMatch.w)}x${Math.round(masterSibMatch.h)})`);
                  } else {
                    // No master match — leave sibling in place (letterbox already positioned it proportionally).
                    // Shifting to slot's px,py would pile up all siblings on one spot.
                    t(`SHAPE SYNC: no master match for sibling GROUP ${sibling.id} (${sibling.name}) -- left in place`);
                  }
                  } // end displacement guard else
                }
              }
            } catch (_) {}
          }
        }

        if (p.slotType === 'title') {
          const nb = getBoundsInFrame(node, frame);
          titleBottomY = nb.y + nb.h;
          titleSlotForStack = { x: nb.x, y: nb.y, w: nb.w, h: nb.h };
        }
        // [STACK heuristic] Only for strict mode
        if (!isCross && p.slotType === 'description' && titleBottomY !== null && titleSlotForStack) {
          const nb = getBoundsInFrame(node, frame);
          const overlapX = horizontalOverlapFraction(nb, titleSlotForStack);
          if (overlapX > 0.3 && nb.y < titleBottomY + 4) {
            t(`STACK: moving description below title (y=${titleBottomY + 10})`);
            setPositionInFrame(node, frame, nb.x, titleBottomY + 10);
          }
        }
      } catch (e) {
        t(`ERROR on slot ${p.slotType}: ${String(e)}`);
        console.error(`[PostProcess] Error on slot ${p.slotType}:`, e);
      }
    }

    /** [5.1] Container Alignment (Non-slots) */
    if (options.mode === 'cross' && _extraOptions?.crossSourceLayoutAlign) {
      const sourceBasis = resolveAlignSourceBasis(targetWidth, targetHeight, options);
      t(`ALIGN(basis): source u=${sourceBasis.u.toFixed(2)} vs master u=${u.toFixed(2)}`);

      alignCrossNonSlotRootsFromSourceLayout(
        frame,
        slotIds,
        _extraOptions.crossSourceLayoutAlign.sourceFrame,
        _extraOptions.crossSourceLayoutAlign.sourceToResult,
        options,
        targetWidth,
        targetHeight,
        t,
        sourceBasis,
        placements,
        masterBoundsByName
      );
    }

    t('Finalizing Z-Order');
    finalizeZOrderStack(frame, slotIds, placements);
    t('SUCCESS: applyExactSessionPostProcess END');
  } catch (err) {
    t(`CRITICAL FAILURE: ${String(err)}`);
    console.error('[PostProcess] CRITICAL FAILURE:', err);
    throw err;
  }
}

const ALIGN_SHAPE_EL: GuideElement = { name: '_align', type: 'shape', fill: false };

function alignCrossNonSlotRootsFromSourceLayout(
  frame: INode,
  slotIds: Set<string>,
  sourceFrame: INode,
  sourceToResult: Map<string, string>,
  options: ExactSessionGeometryOptions,
  targetWidth: number,
  targetHeight: number,
  t: (msg: string) => void,
  sourceBasis: { Rw: number; Rh: number; u: number; ox: number; oy: number },
  placements?: ExactSessionPlacement[],
  masterBoundsMap?: Map<string, { x: number; y: number; w: number; h: number }>
): void {
  const resultNodeById = new Map<string, INode>();
  frame.findAll!(n => {
    resultNodeById.set(n.id, n as INode);
    return false;
  });

  const resultToSource = new Map<string, string>();
  for (const [src, res] of sourceToResult) {
    resultToSource.set(res, src);
  }

  const masterBoundsByName = masterBoundsMap ?? new Map();

  let bgCandidateSourceId: string | null = null;
  const sourceFrameArea = sourceFrame.width * sourceFrame.height;
  const checkCandidate = (child: INode) => {
    if (child.absoluteTransform) {
      const b = getLayoutBoundsInFrame(child, sourceFrame);
      if (b.w * b.h > sourceFrameArea * 0.5) {
        bgCandidateSourceId = child.id;
        return true;
      }
    }
    return false;
  };

  for (let i = 0; i < Math.min((sourceFrame.children ?? []).length, 10); i++) {
    const child = sourceFrame.children![i];
    if (checkCandidate(child)) continue;
    if (child.children) {
      for (const sub of child.children!.slice(0, 5)) {
        if (checkCandidate(sub as INode)) break;
      }
    }
  }

  const sourceSlotBounds: { placement: ExactSessionPlacement; bounds: { x: number; y: number; w: number; h: number } }[] = [];
  if (placements) {
    for (const p of placements) {
      const srcId = resultToSource.get(p.resultNodeId);
      if (!srcId) continue;
      const srcNode = getHost().getNodeById(srcId) as INode;
      if (srcNode && 'absoluteTransform' in srcNode) {
        sourceSlotBounds.push({
          placement: p,
          bounds: getLayoutBoundsInFrame(srcNode, sourceFrame)
        });
      }
    }
  }

  for (const [sourceId, resultId] of sourceToResult) {
    if (slotIds.has(resultId)) continue;

    let node: INode | null = null;
    try {
      node = resultNodeById.get(resultId) || null;
    } catch {
      continue;
    }
    if (!node || node.removed) continue;
    if (node.parent !== frame) continue;

    let hasSlotInside = false;
    if (node.findAll) {
      node.findAll(c => {
        if (slotIds.has(c.id)) {
          hasSlotInside = true;
          return true;
        }
        return false;
      });
    }
    if (hasSlotInside) continue;

    let sourceNode: INode | null = null;
    try {
      const gn = getHost().getNodeById(sourceId);
      if (gn && (gn.type as string) !== 'PAGE' && 'absoluteTransform' in gn) sourceNode = gn as INode;
    } catch {
      continue;
    }
    if (!sourceNode || sourceNode.removed) continue;

    const raw = getLayoutBoundsInFrame(sourceNode, sourceFrame);
    if (raw.w < 2 || raw.h < 2) continue;

    let px: number, py: number, nw: number, nh: number;

    const masterMatch = masterBoundsByName.get(node.name);
    if (masterMatch && sourceId !== bgCandidateSourceId) {
      px = masterMatch.x;
      py = masterMatch.y;
      nw = masterMatch.w;
      nh = masterMatch.h;
      t(`ALIGN(master): ${node.type} ${resultId} (${node.name || ''}) -> ${Math.round(px)},${Math.round(py)} ${Math.round(nw)}x${Math.round(nh)} (masterBounds)`);

      neutralizeFigmaLayoutInterference(node, frame);
      if (px + nw > targetWidth) nw = Math.max(1, targetWidth - px);
      if (py + nh > targetHeight) nh = Math.max(1, targetHeight - py);
      if (node.type === NodeType.Group || node.type === NodeType.Frame) {
        setPositionInFrame(node, frame, px, py);
      } else {
        applyRememberToShapeNode(node, ALIGN_SHAPE_EL, targetWidth, targetHeight, nw, nh);
        setPositionInFrame(node, frame, px, py);
      }
      continue;
    }

    if (sourceId === bgCandidateSourceId) {
      px = 0; py = 0; nw = targetWidth; nh = targetHeight;
      t(`GEOMETRIC BG SNAP: forcing ${node.name} (${resultId}) as full-frame background`);
    } else {
      let affinitySlot: ExactSessionPlacement | null = null;
      const rawArea = raw.w * raw.h;
      for (const sb of sourceSlotBounds) {
        if (sb.placement.slotType === 'background') continue;
        const sb_raw = sb.bounds;
        const slotArea = sb_raw.w * sb_raw.h;
        if (rawArea > slotArea * 10) continue;
        const ix0 = Math.max(raw.x, sb_raw.x);
        const iy0 = Math.max(raw.y, sb_raw.y);
        const ix1 = Math.min(raw.x + raw.w, sb_raw.x + sb_raw.w);
        const iy1 = Math.min(raw.y + raw.h, sb_raw.y + sb_raw.h);
        const iw = Math.max(0, ix1 - ix0);
        const ih = Math.max(0, iy1 - iy0);
        const intersectionArea = iw * ih;
        const overlapRatio = intersectionArea / Math.max(slotArea, 1e-6);

        if (overlapRatio > 0.3) {
          affinitySlot = sb.placement;
          t(`AFFINITY: bound ${node.name} (${resultId}) to slot ${sb.placement.slotType} (ratio=${overlapRatio.toFixed(2)})`);
          break;
        }
      }

      if (affinitySlot) {
        const slotNode = resultNodeById.get(affinitySlot.resultNodeId);
        const srcId = resultToSource.get(affinitySlot.resultNodeId);
        const slotSourceNode = srcId ? getHost().getNodeById(srcId) as INode : null;

        if (slotNode && !slotNode.removed && slotSourceNode) {
          const ssb = getLayoutBoundsInFrame(slotSourceNode, sourceFrame);
          const currentSlotBounds = getBoundsInFrame(slotNode, frame);

          const dx = (raw.x - ssb.x) * sourceBasis.u;
          const dy = (raw.y - ssb.y) * sourceBasis.u;

          px = currentSlotBounds.x + dx;
          py = currentSlotBounds.y + dy;
          nw = raw.w * sourceBasis.u;
          nh = raw.h * sourceBasis.u;
        } else {
          const res = computePixelRectFromSourceLayoutBounds(raw, options, targetWidth, targetHeight, sourceBasis);
          px = res.x; py = res.y; nw = res.w; nh = res.h;
        }
      } else {
        const res = computePixelRectFromSourceLayoutBounds(raw, options, targetWidth, targetHeight, sourceBasis);
        px = res.x; py = res.y; nw = res.w; nh = res.h;
      }
    }

    neutralizeFigmaLayoutInterference(node, frame);

    if (px + nw > targetWidth) nw = Math.max(1, targetWidth - px);
    if (py + nh > targetHeight) nh = Math.max(1, targetHeight - py);

    if (node.type === NodeType.Group || node.type === NodeType.Frame) {
      setPositionInFrame(node, frame, px, py);
      t(
        `ALIGN(cross): ${node.type} ${resultId} (${node.name || ''}) -> ${Math.round(px)},${Math.round(py)} (sourceBasis)`
      );
      continue;
    }

    if (
      (node.type === NodeType.Vector ||
        node.type === NodeType.Rectangle ||
        node.type === NodeType.Ellipse ||
        node.type === NodeType.Star ||
        node.type === NodeType.Polygon ||
        node.type === 'LINE')
    ) {
      applyRememberToShapeNode(node, ALIGN_SHAPE_EL, targetWidth, targetHeight, nw, nh);
      setPositionInFrame(node, frame, px, py);
      t(
        `ALIGN(cross): ${node.type} ${resultId} (${node.name || ''}) -> ${Math.round(px)},${Math.round(py)} ${Math.round(nw)}x${Math.round(nh)} (sourceBasis)`
      );
    }
  }
}

function dissolveTechnicalWrappers(frame: INode, slotIds: Set<string>): void {
  const targets = (frame.findAll!(child => {
    if (child.type !== NodeType.Frame && child.type !== NodeType.Group) return false;
    if (slotIds.has(child.id)) return false;
    return isTechnicalArtifactName(child.name);
  }) as INode[]);
  targets.sort((a, b) => {
    const da = a.id.split(':').length;
    const db = b.id.split(':').length;
    return db - da;
  });

  for (const w of targets) {
    if (!w || w.removed) continue;

    const parent = w.parent;
    if (!parent || parent.removed) continue;

    try {
      const childrenNodes = [...(w.children ?? [])];
      for (const child of childrenNodes) {
        if (!child || child.removed) continue;

        const b = getBoundsInFrame(child, frame);
        frame.appendChild!(child);
        child.x = Math.round(b.x);
        child.y = Math.round(b.y);
      }

      if (!w.removed) {
        try { w.remove!(); } catch (_) {
          try { if (!w.removed) w.visible = false; } catch (__) {}
        }
      }
    } catch (e) {
      console.warn('[PostProcess] Could not dissolve wrapper:', w.name, e);
    }
  }
}

function finalizeZOrderStack(
  frame: INode,
  slotIds: Set<string>,
  placements: ExactSessionPlacement[]
): void {
  const childrenNodes = [...(frame.children ?? [])];
  const areaF = frame.width * frame.height;

  for (const c of childrenNodes) {
    if (slotIds.has(c.id)) continue;
    if (c.removed) continue;
    const b = getBoundsInFrame(c, frame);
    const area = b.w * b.h;
    if (area > areaF * 0.45 && !subtreeHasDesignContent(c)) {
      try {
        frame.insertChild!(0, c);
      } catch (_) {}
    }
  }

  const bgPlacement = placements.find(p => p.slotType === 'background');
  if (bgPlacement) {
    const bgNode = (frame.children ?? []).find(c => c.id === bgPlacement.resultNodeId) as INode | undefined;
    if (bgNode && !bgNode.removed) {
      try {
        frame.insertChild!(0, bgNode);
      } catch (_) {}
    }
  }
}

function normalizeKeeperDedupName(name: string): string {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, '');
}

function tryMergeNegligibleDuplicateIntoKeeper(
  child: INode,
  frame: INode,
  keeperIds: Set<string>,
  t: (msg: string) => void
): boolean {
  if (child.type !== NodeType.Group && child.type !== NodeType.Frame) return false;
  if (!child.children || child.children.length === 0) return false;
  const cn = normalizeKeeperDedupName(child.name || '');
  if (cn.length < 3) return false;
  const keeper = [...(frame.children ?? [])].find(
    c =>
      c.id !== child.id &&
      keeperIds.has(c.id) &&
      (c.type === NodeType.Group || c.type === NodeType.Frame) &&
      normalizeKeeperDedupName(c.name || '') === cn
  ) as INode | undefined;
  if (!keeper) return false;

  t(
    `MERGE: folding duplicate ${child.id} (${child.name}) into keeper ${keeper.id} (${keeper.name}) (preserve vectors under same-named groups)`
  );
  mergeDuplicateRootIntoKeeperDeep(child, keeper, frame);
  return true;
}

function mergeDuplicateRootIntoKeeperDeep(duplicate: INode, keeper: INode, frame: INode): void {
  if (duplicate.type !== NodeType.Group && duplicate.type !== NodeType.Frame) return;
  for (const ch of [...(duplicate.children ?? [])]) {
    const chName = normalizeKeeperDedupName(ch.name || '');
    if (!chName) {
      const b = getBoundsInFrame(ch, frame);
      keeper.appendChild!(ch);
      neutralizeFigmaLayoutInterference(ch, frame);
      setPositionInFrame(ch, frame, b.x, b.y);
      continue;
    }
    const match = [...(keeper.children ?? [])].find(c => normalizeKeeperDedupName(c.name || '') === chName);
    if (match && (ch.type === NodeType.Group || ch.type === NodeType.Frame) && (match.type === NodeType.Group || match.type === NodeType.Frame)) {
      mergeDuplicateRootIntoKeeperDeep(ch, match, frame);
    } else if (ch.type === NodeType.Text) {
      try {
        ch.remove!();
      } catch (_) {}
    } else if (match && ch.type === match.type && ch.type !== NodeType.Group && ch.type !== NodeType.Frame) {
      try {
        ch.remove!();
      } catch (_) {}
    } else if (!match) {
      const b = getBoundsInFrame(ch, frame);
      keeper.appendChild!(ch);
      neutralizeFigmaLayoutInterference(ch, frame);
      setPositionInFrame(ch, frame, b.x, b.y);
    } else {
      try {
        ch.remove!();
      } catch (_) {}
    }
  }
  try {
    duplicate.remove!();
  } catch (_) {}
}

function shatterMultiSlotContainers(frame: INode, slotIds: Set<string>, t: (m: string) => void): void {
  const candidates: INode[] = [];
  frame.findAll!(child => {
    if (child.type !== NodeType.Frame && child.type !== NodeType.Group) return false;
    if (slotIds.has(child.id)) return false;

    let slotCount = 0;
    if (child.findAll) {
      child.findAll(c => {
        if (slotIds.has(c.id)) {
          slotCount++;
        }
        return false;
      });
    }
    if (slotCount > 1) {
      candidates.push(child);
    }
    return false;
  });

  candidates.sort((a, b) => {
    const da = a.id.split(':').length;
    const db = b.id.split(':').length;
    return db - da;
  });

  for (const w of candidates) {
    if (!w || w.removed) continue;
    t(`SHATTER: multi-slot container ${w.id} (${w.name})`);

    const childrenNodes = [...(w.children ?? [])];
    for (const child of childrenNodes) {
      const b = getBoundsInFrame(child, frame);
      frame.appendChild!(child);
      child.x = Math.round(b.x);
      child.y = Math.round(b.y);
    }
    try {
      w.remove!();
    } catch (_) {}
  }
}
