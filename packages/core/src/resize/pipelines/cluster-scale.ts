/**
 * Hybrid cluster scale (Native Rescale Strategy).
 *
 * Algorithm idea:
 * - Background candidates (bg clusters) are projected to new X/Y separately (sX/sY) + stretched
 * - Content clusters are scaled uniformly or stretched depending on preserveProportions
 *
 * Reference logic: local `oLD (bun unstuble)/src/pipelines/cluster-scale.ts` (same project).
 * Differences: anti-bleed in `cluster-letterbox-bleed.ts`, snapshots in `cluster-snapshot-clustering.ts`.
 * **contain** on root — order as in oLD (root resize -> children); **cover** — previous path (group+rescale on root).
 */

import { type INode, NodeType, MIXED, type IFontName } from '../../host';
import { getHost } from '../../host/context';
import {
    ScaleContext,
    ScaleModule
} from '../contracts/types';
import { analyzeFrame } from './analyzer';
import { scaleElement } from '../scaling/scaler';
import {
    getChildrenBounds,
    getDescendantUnionBoundsInRootLocal,
    stripBleedingPaintOutsideLetterbox
} from './cluster-letterbox-bleed';
import { findSnapshotClusters, type NodeSnapshot } from './cluster-snapshot-clustering';
import { aspectDeltaRelativeToTarget } from '../geometry/aspect';
import { centeredLetterboxOffsets } from '../geometry/fit';

export class ClusterScalePipeline {
    register(_module: ScaleModule): void {}

    /** Only active during `uniformLetterboxRoot` when `letterboxFit === 'contain'`. */
    private _uniformLetterboxContainMode = false;

    async execute(
        frame: INode,
        newWidth: number,
        newHeight: number,
        preserveProportions: boolean = false,
        _useGuide: boolean = false
    ): Promise<INode> {
        // Clone is not resized here — size will be set in resizeRecursively (container.resize).
        const clone = frame.clone!();
        clone.name = `${Math.round(newWidth)}x${Math.round(newHeight)} (resized)`;
        clone.x = frame.x + frame.width + 50;

        // Freeze auto-constraints during processing
        this.freezeConstraintsRecursively(clone);

        // Preload all fonts before resize — otherwise API may not load
        // the font by the time fontSize changes, and text size won't apply
        await this.loadAllFontsInTree(clone);

        const analysis = analyzeFrame(frame);
        const context: ScaleContext = {
            originalWidth: frame.width,
            originalHeight: frame.height,
            newWidth,
            newHeight,
            scaleX: newWidth / frame.width,
            scaleY: newHeight / frame.height,
            mode: 'cluster',
            transforms: analysis.transforms,
            preserveProportions
        };

        // Start recursion
        await this.scaleRecursively(clone, newWidth, newHeight, context, 0, frame.width, frame.height);

        return clone;
    }

    /**
     * Uniform scale + letterbox to target size.
     * - **contain** (`Math.min`): like the old root `cluster-scale.ts` — full layout visible, margins on edges.
     * - **cover** (`Math.max`): fill the frame (branch without Remember; JSON guide can request cover explicitly).
     * @param opts.contentAwareLetterbox — slight shift to content center within allowed bounds (pillars for contain, crop-pan for cover).
     */
    async executeUniformLetterbox(
        frame: INode,
        newWidth: number,
        newHeight: number,
        opts?: { contentAwareLetterbox?: boolean; letterboxFit?: 'cover' | 'contain' }
    ): Promise<INode> {
        const clone = frame.clone!();
        clone.name = `${Math.round(newWidth)}x${Math.round(newHeight)} (resized)`;
        clone.x = frame.x + frame.width + 50;

        this.freezeConstraintsRecursively(clone);
        const fit = opts?.letterboxFit ?? 'cover';
        if (fit === 'contain') {
            this.flattenRootLayoutOnly(clone);
        } else {
            this.flattenAutoLayoutToNone(clone);
        }
        await this.loadAllFontsInTree(clone);

        await this.uniformLetterboxRoot(
            clone,
            newWidth,
            newHeight,
            opts?.contentAwareLetterbox === true,
            fit
        );
        return clone;
    }

    /**
     * Native scale as in UI: single child — `rescale`; multiple — `getHost().groupNodes` + `rescale`.
     * Needed at **root** and **inside** nested FRAME/GROUP, otherwise mask/clip-path/adjacent Vector+Group break when manually scaling x*u individually.
     * Risk of u^2 on nested FRAME: after `rescale` the engine may change `fr.width`/`height` before our `resize` — so wherever there's a frame, `resize` only from **w0/h0 before** the operation (see `uniformScaleSubtree`).
     */
    private tryScaleDirectChildrenViaGroup(
        parent: INode,
        directChildren: INode[],
        u: number,
        postOffX: number,
        postOffY: number
    ): boolean {
        if (directChildren.length === 0) return false;

        if (directChildren.length === 1) {
            const c = directChildren[0]!;
            if (c.type === NodeType.Text) return false;
            if (!('rescale' in c) || typeof (c as { rescale?: (s: number) => void }).rescale !== 'function') {
                return false;
            }
            if (!('x' in c) || !('y' in c)) return false;
            const x0 = c.x;
            const y0 = c.y;
            try {
                (c as { rescale: (s: number) => void }).rescale(u);
                c.x = x0 * u + postOffX;
                c.y = y0 * u + postOffY;
                return true;
            } catch (_) {
                return false;
            }
        }

        try {
            const g = getHost().groupNodes(directChildren, parent, 0);
            const gx0 = g.x;
            const gy0 = g.y;
            g.rescale!(u);
            g.x = gx0 * u + postOffX;
            g.y = gy0 * u + postOffY;
            return true;
        } catch (_) {
            return false;
        }
    }

    private async uniformLetterboxRoot(
        root: INode,
        newWidth: number,
        newHeight: number,
        contentAwareLetterbox: boolean,
        letterboxFit: 'cover' | 'contain'
    ): Promise<void> {
        this._uniformLetterboxContainMode = letterboxFit === 'contain';
        try {
            await this.uniformLetterboxRootImpl(
                root,
                newWidth,
                newHeight,
                contentAwareLetterbox,
                letterboxFit
            );
        } finally {
            this._uniformLetterboxContainMode = false;
        }
    }

    private async uniformLetterboxRootImpl(
        root: INode,
        newWidth: number,
        newHeight: number,
        contentAwareLetterbox: boolean,
        letterboxFit: 'cover' | 'contain'
    ): Promise<void> {
        const srcW = Math.max(root.width, 0.01);
        const srcH = Math.max(root.height, 0.01);
        const lb0 = centeredLetterboxOffsets(srcW, srcH, newWidth, newHeight, letterboxFit);
        const { u, scaledW, scaledH } = lb0;
        let offX = lb0.offX;
        let offY = lb0.offY;

        if (contentAwareLetterbox) {
            const bb = getDescendantUnionBoundsInRootLocal(root) ?? getChildrenBounds(root);
            if (bb && bb.width > 1 && bb.height > 1) {
                /**
                 * Pure union AABB center often drifts due to huge background vectors/clips on the left:
                 * compensation pulls the frame **right** and looks "bigger in the wrong place". Use frame
                 * geometric center as base, slightly blend in "content center" with clamp and low weight.
                 * For **contain**, adjust only X: after native rescale+AL, background grows downward,
                 * cy from union gives huge oyIdeal -> entire block pins to bottom with white space on top
                 * (old cluster-scale shifted with equal offX/offY from frame geometry).
                 */
                const frameCx = srcW / 2;
                const frameCy = srcH / 2;
                const rawCx = bb.x + bb.width / 2;
                const rawCy = bb.y + bb.height / 2;
                const pad = 0.11 * Math.min(srcW, srcH);
                const nearCx = frameCx + Math.max(-pad, Math.min(pad, rawCx - frameCx));
                const t = 0.22;
                const cx = frameCx * (1 - t) + nearCx * t;
                const oxIdeal = newWidth / 2 - cx * u;
                if (letterboxFit === 'cover') {
                    const nearCy = frameCy + Math.max(-pad, Math.min(pad, rawCy - frameCy));
                    const cy = frameCy * (1 - t) + nearCy * t;
                    const oyIdeal = newHeight / 2 - cy * u;
                    const oxMin = newWidth - scaledW;
                    const oyMin = newHeight - scaledH;
                    offX = Math.max(oxMin, Math.min(0, oxIdeal));
                    offY = Math.max(oyMin, Math.min(0, oyIdeal));
                } else {
                    const oxMax = newWidth - scaledW;
                    offX = Math.max(0, Math.min(oxMax, oxIdeal));
                }
            }
        }

        root.layoutMode = 'NONE';
        const aspectDelta = aspectDeltaRelativeToTarget(srcW, srcH, newWidth, newHeight);

        /**
         * **contain** (Remember / oLD): first `root.resize(target)`, then children — as in
         * `oLD (bun unstuble)/cluster-scale.ts:uniformLetterboxRoot`. Otherwise tree and
         * `resolveExactSessionLayout` formulas (u, ox, oy) diverge -> slots end up misplaced.
         */
        if (letterboxFit === 'contain') {
            root.resize(newWidth, newHeight);
            const children = (root.children ?? []).filter((c: INode) => !c.removed) as INode[];
            for (const c of children) {
                if (c.removed) continue;
                c.x = c.x * u + offX;
                c.y = c.y * u + offY;
                await this.uniformScaleSubtree(c, u);
            }
            if (aspectDelta > 0.05) {
                stripBleedingPaintOutsideLetterbox(root, offX, offY, scaledW, scaledH, newWidth, newHeight);
            }
            return;
        }

        /** cover: children -> root resize (native group+rescale on root is acceptable). */
        const children = (root.children ?? []).filter((c: INode) => !c.removed) as INode[];
        const scaledViaGroup = this.tryScaleDirectChildrenViaGroup(root, children, u, offX, offY);
        if (!scaledViaGroup) {
            for (const c of children) {
                if (c.removed) continue;
                c.x = c.x * u + offX;
                c.y = c.y * u + offY;
                await this.uniformScaleSubtree(c, u);
            }
        }

        root.resize(newWidth, newHeight);

        if (aspectDelta > 0.05) {
            const isCoverCrop =
                offX < -0.5 ||
                offY < -0.5 ||
                scaledW > newWidth + 0.5 ||
                scaledH > newHeight + 0.5;
            if (!isCoverCrop) {
                stripBleedingPaintOutsideLetterbox(root, offX, offY, scaledW, scaledH, newWidth, newHeight);
            }
        }

        try {
            root.clipsContent = true;
        } catch (_) {}

    }

    /** Remove AL only from banner root; nested frames with wrap/repeat stay in AL for contain. */
    private flattenRootLayoutOnly(root: INode): void {
        try {
            root.layoutMode = 'NONE';
        } catch (_) {}
    }

    private async uniformScaleSubtree(node: INode, u: number): Promise<void> {
        if (node.removed) return;

        if (node.type === NodeType.Text) {
            await this.processTextNode(node, u, u, node.width, node.height);
            return;
        }

        if (node.type === NodeType.Instance || node.type === NodeType.Component) {
            if (node.rescale) {
                try {
                    node.rescale(u);
                    return;
                } catch (_) {}
            }
            node.resize(Math.max(node.width * u, 0.01), Math.max(node.height * u, 0.01));
            this.scaleCornerRadius(node, u);
            return;
        }

        if (node.type === NodeType.Frame) {
            const fr = node;
            const w0 = fr.width;
            const h0 = fr.height;
            const hadAutoLayout = fr.layoutMode !== 'NONE';

            if (this._uniformLetterboxContainMode && hadAutoLayout) {
                try {
                    if (fr.rescale) {
                        fr.rescale(u);
                        fr.resize(Math.max(w0 * u, 0.01), Math.max(h0 * u, 0.01));
                        return;
                    }
                } catch (_) {}
            }

            fr.layoutMode = 'NONE';
            /** contain: as in oLD — manual x/y*u + frame resize only, no `groupNodes` on nested FRAMEs. */
            if (this._uniformLetterboxContainMode) {
                for (const c of fr.children!) {
                    if (c.removed) continue;
                    c.x *= u;
                    c.y *= u;
                    await this.uniformScaleSubtree(c, u);
                }
                fr.resize(Math.max(w0 * u, 0.01), Math.max(h0 * u, 0.01));
                return;
            }

            const children = fr.children!.filter((c: INode) => !c.removed) as INode[];
            const nativeOk =
                children.length > 0 && this.tryScaleDirectChildrenViaGroup(fr, children, u, 0, 0);
            if (!nativeOk) {
                for (const c of fr.children!) {
                    if (c.removed) continue;
                    c.x *= u;
                    c.y *= u;
                    await this.uniformScaleSubtree(c, u);
                }
            }
            fr.resize(Math.max(w0 * u, 0.01), Math.max(h0 * u, 0.01));
            return;
        }

        /**
         * GROUP: as in `oLD (bun unstuble)/src/pipelines/cluster-scale.ts` — manual x/y*u and recursion only.
         * `tryScaleDirectChildrenViaGroup` (groupNodes + rescale) on GROUP produced broken geometry for nested
         * vectors/masks relative to Remember post-process.
         */
        if (node.type === NodeType.Group) {
            for (const c of node.children!) {
                if (c.removed) continue;
                c.x *= u;
                c.y *= u;
                await this.uniformScaleSubtree(c, u);
            }
            return;
        }

        if ('resize' in node && (node.type as string) !== NodeType.Group) {
            if (node.rescale) {
                try {
                    node.rescale(u);
                    return;
                } catch (_) {}
            }
            try {
                node.resize(Math.max(node.width * u, 0.01), Math.max(node.height * u, 0.01));
                this.scaleCornerRadius(node, u);
            } catch (_) {}
        }
    }

    /**
     * Fill frame during letterboxing (content noticeably doesn't fill the frame).
     * Threshold 90%: as before; at 50% "just uniform" (square x2 etc.) stopped looking
     * normal — resizeRecursively output without fill gave "everything drifted away". Guide and cluster
     * are independent (no shared state); "same-to-same" is still not touched (sameSize).
     */
    private async fillFrameIfLetterboxed(frame: INode, W: number, H: number): Promise<void> {
        const bounds = getChildrenBounds(frame);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
        const fillRatioW = W / bounds.width;
        const fillRatioH = H / bounds.height;
        if (bounds.width >= W * 0.9 && bounds.height >= H * 0.9) return;
        const fillScale = Math.max(fillRatioW, fillRatioH);
        if (fillScale <= 1.02) return;

        const children = (frame.children ?? []).filter((c: INode) => !c.removed);
        const offsetX = (W - bounds.width * fillScale) / 2;
        const offsetY = (H - bounds.height * fillScale) / 2;

        for (const child of children) {
            child.x = (child.x - bounds.x) * fillScale + offsetX;
            child.y = (child.y - bounds.y) * fillScale + offsetY;
            try {
                await scaleElement(child, fillScale, undefined, true);
            } catch (_) {}
        }
    }

    /**
     * Collects all fonts from TEXT nodes in the tree and loads them into memory.
     * Called before resize so fonts are already loaded by the time setRangeFontSize/fontSize runs.
     */
    private async loadAllFontsInTree(node: INode): Promise<void> {
        if (node.type === NodeType.Text) {
            const len = node.characters!.length;
            if (len === 0) return;
            const fonts = new Map<string, IFontName>();
            if (node.fontName === MIXED) {
                for (let i = 0; i < len; i++) {
                    const f = node.getRangeFontName!(i, i + 1) as IFontName;
                    fonts.set(`${f.family}-${f.style}`, f);
                }
            } else {
                const f = node.fontName as IFontName;
                fonts.set(`${f.family}-${f.style}`, f);
            }
            for (const f of fonts.values()) {
                try {
                    await getHost().loadFont(f);
                } catch (_) {}
            }
            return;
        }
        // Including INSTANCE: text inside components must be loaded before rescale/Exact layout
        if (node.children) {
            for (const child of node.children) {
                await this.loadAllFontsInTree(child);
            }
        }
    }

    /**
     * During scale, set all nested FRAMEs to layout NONE (like the old "record" without restore).
     * Order is **post-order**: children first, then parent. With pre-order (parent before children) nested AL
     * managed to recalculate with absolute sub-frames -> x/y drifts after `group`+`rescale`.
     * Auto Layout restore from plugin removed: engine re-runs flex and overwrites pixel geometry.
     */
    private flattenAutoLayoutToNone(node: INode): void {
        if ('removed' in node && node.removed) return;
        if (node.type === NodeType.Instance) return;
        if (node.children) {
            for (const c of node.children) {
                if (!('removed' in c && c.removed)) {
                    this.flattenAutoLayoutToNone(c);
                }
            }
        }
        if (node.type === NodeType.Frame) {
            try {
                node.layoutMode = 'NONE';
            } catch (_) {}
        }
    }

    private freezeConstraintsRecursively(node: INode): void {
        // We don't touch constraints inside instances since they are read-only
        // and break when attempting to write.
        if ('constraints' in node && node.parent && node.parent.type !== NodeType.Instance) {
            try {
                node.constraints = { horizontal: 'MIN', vertical: 'MIN' };
            } catch (e) {
                // Ignore if engine still forbids changes
            }
        }

        // IMPORTANT: Don't recurse into instances. Their content scales entirely via rescale()
        if (node.children && node.type !== NodeType.Instance) {
            for (const child of node.children) {
                this.freezeConstraintsRecursively(child);
            }
        }
    }

    private async scaleRecursively(
        container: INode,
        targetWidth: number,
        targetHeight: number,
        context: ScaleContext,
        depth: number,
        originalW: number,
        originalH: number,
        isParentBackground: boolean = false
    ): Promise<void> {
        const sourceW = Math.max(originalW, 0.01);
        const sourceH = Math.max(originalH, 0.01);
        const children = (container.children ?? []).filter((c: INode) => !c.removed);

        const snaps: NodeSnapshot[] = children.map((c: INode) => ({
            id: c.id, x: c.x, y: c.y, width: c.width, height: c.height, type: c.type, name: c.name
        }));

        const sX = targetWidth / sourceW;
        const sY = targetHeight / sourceH;
        const uniformScale = Math.min(sX, sY);
        const preserve = context.preserveProportions ?? false;

        if (container.type === NodeType.Frame) {
            container.layoutMode = 'NONE';
            container.resize(Math.max(targetWidth, 0.01), Math.max(targetHeight, 0.01));
        }

        const margin = Math.max(20, Math.min(sourceW, sourceH) * 0.1);

        const bgSnaps: NodeSnapshot[] = [];
        const contentSnaps: NodeSnapshot[] = [];

        // Classify bg vs content: only order, type, area share (layer names not used).
        snaps.forEach((s, idx) => {
            const isProtected = s.type === NodeType.Text || s.type === NodeType.Instance || s.type === NodeType.Component;
            const isContainer = s.type === NodeType.Frame || s.type === NodeType.Group;
            const areaShare = (s.width * s.height) / (sourceW * sourceH);
            const isHuge = areaShare > 0.5;

            const isBGCandidate =
                isParentBackground ||
                (!isProtected && (idx <= Math.max(2, children.length * 0.7) || (isContainer && isHuge)));

            if (isBGCandidate) bgSnaps.push(s);
            else contentSnaps.push(s);
        });

        // Button/chip: rectangle goes to bg, TEXT to content -> different clusters, label "drifts away".
        // Compact container with text is scaled as one cluster (as a single UI block).
        const hasTextChild = children.some((c: INode) => c.type === NodeType.Text);
        const shortSide = Math.min(sourceW, sourceH);
        if (hasTextChild && children.length <= 8 && shortSide <= 200) {
            bgSnaps.length = 0;
            contentSnaps.length = 0;
            for (const s of snaps) contentSnaps.push(s);
        }

        const bgClusters = findSnapshotClusters(bgSnaps, margin);
        const contentClusters = findSnapshotClusters(contentSnaps, margin);

        const processCluster = async (cluster: NodeSnapshot[], pSX: number, pSY: number, sizeSX: number, sizeSY: number) => {
            if (cluster.length === 0) return;

            // 1. Find cluster center in old coordinates
            const cMinX = Math.min(...cluster.map(s => s.x));
            const cMinY = Math.min(...cluster.map(s => s.y));
            const cMaxX = Math.max(...cluster.map(s => s.x + s.width));
            const cMaxY = Math.max(...cluster.map(s => s.y + s.height));
            const oldClusterCX = (cMinX + cMaxX) / 2;
            const oldClusterCY = (cMinY + cMaxY) / 2;

            // 2. Project cluster center to new WORLD coordinates (with stretching)
            const newClusterCX = (targetWidth / 2) + (oldClusterCX - sourceW / 2) * pSX;
            const newClusterCY = (targetHeight / 2) + (oldClusterCY - sourceH / 2) * pSY;

            for (const s of cluster) {
                const node = children.find((c: INode) => c.id === s.id);
                if (!node) continue;

                // Vector size is always uniform (except huge background fills)
                const isHugeBase = (s.width >= sourceW * 0.9 && s.height >= sourceH * 0.9);
                const finalSizeS = Math.min(sizeSX, sizeSY);
                const finalSizeSX = isHugeBase ? sizeSX : finalSizeS;
                const finalSizeSY = isHugeBase ? sizeSY : finalSizeS;

                const isNodeBG = bgSnaps.some(bg => bg.id === s.id);
                try {
                    if (node.type === NodeType.Frame || node.type === NodeType.Group || node.type === NodeType.Instance || node.type === NodeType.Component) {
                        if (node.type === NodeType.Frame) {
                             await this.scaleRecursively(node, s.width * finalSizeSX, s.height * finalSizeSY, context, depth + 1, s.width, s.height, isNodeBG);
                        } else if (node.type === NodeType.Instance || node.type === NodeType.Component) {
                            // Logo/components uniform only — otherwise 16:9->square gives "squished" brand
                            const uScale = Math.min(finalSizeSX, finalSizeSY);
                            if (node.rescale) {
                                node.rescale(uScale);
                            } else {
                                node.resize(Math.max(s.width * uScale, 0.01), Math.max(s.height * uScale, 0.01));
                            }
                        } else if (node.rescale && finalSizeSX === finalSizeSY) {
                             node.rescale(finalSizeSX);
                        } else {
                             node.resize(Math.max(s.width * finalSizeSX, 0.01), Math.max(s.height * finalSizeSY, 0.01));
                        }
                    } else if (node.type === NodeType.Text) {
                        await this.processTextNode(node, finalSizeSX, finalSizeSY, s.width, s.height);
                    } else if (node.rescale && finalSizeSX === finalSizeSY) {
                        node.rescale(finalSizeSX);
                    } else {
                        node.resize(Math.max(s.width * finalSizeSX, 0.01), Math.max(s.height * finalSizeSY, 0.01));
                    }
                } catch (_) {}

                // 3. Position node RELATIVE to cluster center
                // dX, dY — node center offset from cluster center in old world
                const oldNodeCX = s.x + s.width / 2;
                const oldNodeCY = s.y + s.height / 2;
                const dX = oldNodeCX - oldClusterCX;
                const dY = oldNodeCY - oldClusterCY;

                // For BACKGROUND (pSX/pSY = sX/sY) we use pSX/pSY for dX/dY AS WELL,
                // so background grid stretches (linear stretching).
                // For CONTENT (pSX/pSY = uniform) — uniform.
                const newNodeCX = newClusterCX + dX * pSX;
                const newNodeCY = newClusterCY + dY * pSY;

                node.x = Math.round((newNodeCX - node.width / 2) * 100) / 100;
                node.y = Math.round((newNodeCY - node.height / 2) * 100) / 100;
            }
        };

        // BACKGROUND: as in reference — always separate sX/sY (stretch to new aspect).
        // Content stays uniform when preserve is on; background fills frame without letterbox "island" on bg layers.
        for (const c of bgClusters) await processCluster(c, sX, sY, sX, sY);
        // CONTENT:
        // - if preserveProportions = true — uniform by uniformScale (preserving aspect ratio)
        // - otherwise — project X/Y separately (sX/sY) — "without preserving aspect ratio"
        const contentPX = preserve ? uniformScale : sX;
        const contentPY = preserve ? uniformScale : sY;
        const contentSX = contentPX;
        const contentSY = contentPY;
        for (const c of contentClusters) await processCluster(c, contentPX, contentPY, contentSX, contentSY);

        // Do not restore Auto Layout: after cluster-based positioning, enabling layoutMode forces the engine to recalculate positions and overwrite ours — vectors/elements scatter.
        // Keep layoutMode = NONE so calculated x,y are preserved.
    }

    /**
     * Scales cornerRadius after resize(). rescale() scales radii automatically,
     * but resize() requires manual recalculation to preserve visuals.
     */
    private scaleCornerRadius(node: INode, scale: number): void {
        if (!('cornerRadius' in node)) return;
        const r = (node as { cornerRadius?: number }).cornerRadius;
        if (typeof r !== 'number') return;
        (node as { cornerRadius: number }).cornerRadius = Math.max(0, Math.round(r * scale * 100) / 100);
    }

    private static readonly FALLBACK_FONT: IFontName = { family: 'Inter', style: 'Regular' };

    private async processTextNode(node: INode, scaleX: number, scaleY: number, origW: number, origH: number): Promise<void> {
        const fontScale = Math.min(scaleX, scaleY);
        const len = node.characters!.length;
        if (len === 0) {
            if ('resize' in node) node.resize(Math.max(origW * scaleX, 0.01), Math.max(origH * scaleY, 0.01));
            return;
        }

        let fontSizeApplied = false;
        try {
            if (node.fontName === MIXED || node.fontSize === MIXED) {
                const uniqueFonts = new Map<string, IFontName>();
                for (let i = 0; i < len; i++) {
                    const fName = node.getRangeFontName!(i, i + 1) as IFontName;
                    uniqueFonts.set(`${fName.family}-${fName.style}`, fName);
                }
                for (const fName of uniqueFonts.values()) await getHost().loadFont(fName);
                for (let i = 0; i < len; i++) {
                    const fSize = node.getRangeFontSize!(i, i + 1) as number;
                    node.setRangeFontSize!(i, i + 1, Math.max(Math.round(fSize * fontScale * 100) / 100, 1));
                }
                fontSizeApplied = true;
            } else {
                await getHost().loadFont(node.fontName as IFontName);
                node.fontSize = Math.max(Math.round((node.fontSize as number) * fontScale * 100) / 100, 1);
                fontSizeApplied = true;
            }
        } catch (_) {}

        // If font failed to load (custom/system), engine won't apply fontSize. Try fallback.
        if (!fontSizeApplied) {
            try {
                await getHost().loadFont(ClusterScalePipeline.FALLBACK_FONT);
                node.fontName = ClusterScalePipeline.FALLBACK_FONT;
                if (node.fontSize !== MIXED) {
                    const base = node.fontSize as number;
                    node.fontSize = Math.max(Math.round(base * fontScale * 100) / 100, 1);
                } else {
                    for (let i = 0; i < len; i++) {
                        const base = node.getRangeFontSize!(i, i + 1) as number;
                        node.setRangeFontSize!(i, i + 1, Math.max(Math.round(base * fontScale * 100) / 100, 1));
                    }
                }
            } catch (_) {}
        }

        if ('resize' in node) {
            node.resize(Math.max(Math.round(origW * scaleX * 100) / 100, 0.01), Math.max(Math.round(origH * scaleY * 100) / 100, 0.01));
        }
    }
}

export function createClusterScalePipeline(): ClusterScalePipeline {
    return new ClusterScalePipeline();
}
