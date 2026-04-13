/**
 * Reflow Pipeline — flex-first resize for long-form content.
 *
 * Contrast with {@link ClusterScalePipeline}: cluster-scale is a
 * **proportional** algorithm — positions and sizes are scaled by `u =
 * target/source` and the cloned root drops its layoutMode so every child
 * becomes absolutely placed. That's correct for banners and hero
 * compositions where pixel-perfect geometry is load-bearing.
 *
 * Reflow is correct for the opposite shape: landing pages, marketing
 * emails, docs, any tree whose source already stacks children in a
 * VERTICAL flex and relies on wrap for text. Cluster-scale wrecks these
 * because it multiplies text `x` by `u` and leaves `width` unconstrained,
 * so the audit's `absoluteBoundingBox` check sees TEXT nodes sitting at
 * `x=980, width=580` on a 1080-wide frame and reports overflow.
 *
 * Session 1 landed the basic flex-column shape. Session 2 added:
 *   - HORIZONTAL row preservation — buttons stay side-by-side instead
 *     of being coerced to a vertical stack. Rows that would no longer
 *     fit flip to `layoutWrap: WRAP` so items shift onto a second line
 *     in narrow targets.
 *   - Font size scaling — when the width ratio is extreme, text sizes
 *     scale by `sqrt(ratio)` to preserve readability without ballooning
 *     body copy.
 *   - Absolute overlays — `layoutPositioning: ABSOLUTE` nodes now get
 *     their x/y/width/height scaled proportionally to the target frame
 *     so decorative badges and pinned chips move with the resize.
 *   - Grid awareness — `layoutMode: GRID` containers have their
 *     gridTemplateColumns adjusted to fit the target width, with full
 *     collapse to 1 column on narrow targets.
 *
 * Still out of scope: rotated decoration, clip-path-based shapes,
 * mixed-axis nested layouts where a HORIZONTAL parent contains
 * HORIZONTAL children. Those stay best-effort.
 */

import type { INode } from '../../host/types';
import { NodeType } from '../../host/types';
import type { SceneGraph } from '../../engine/scene-graph';
import { ensureSceneLayout } from '../../engine/layout';

// ─── Pipeline ────────────────────────────────────────────────

export class ReflowPipeline {
  /**
   * Clone `source` into its backing graph and re-flow the clone to fit
   * `newWidth × newHeight`. Returns the cloned root INode; the caller can
   * pull its backing SceneGraph via the usual `(node as any).graph` path.
   */
  async execute(source: INode, newWidth: number, newHeight: number): Promise<INode> {
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const clone = source.clone!();
    clone.name = `${Math.round(newWidth)}x${Math.round(newHeight)} (reflowed)`;
    // Park the clone beside the source so visual diffs in the editor don't
    // pile the two trees on top of each other — matches cluster-scale's
    // convention.
    clone.x = source.x + source.width + 50;
    clone.y = source.y;

    this.makeRootVertical(clone, newWidth, newHeight);

    const widthRatio = sourceWidth > 0 ? newWidth / sourceWidth : 1;
    const heightRatio = sourceHeight > 0 ? newHeight / sourceHeight : 1;
    // Font scaling uses sqrt of the width ratio — aggressive enough to
    // keep text readable on a mobile resize (680→375 ≈ 0.55 → 0.74
    // font factor) but tame enough on widen (680→1080 ≈ 1.59 → 1.26)
    // so body copy doesn't balloon into display type. Straight linear
    // scaling made 14px → 22px on the widen case, which looked wrong.
    const fontRatio = widthRatio > 0 ? Math.sqrt(widthRatio) : 1;

    this.reflowSubtree(clone, { widthRatio, heightRatio, fontRatio });

    // Yoga pass: without this, the cached `absPosCache` in SceneGraph
    // returns pre-resize positions and every audit rule that reads
    // `absoluteBoundingBox` sees stale geometry. This is the whole reason
    // the reflow strategy exists.
    const graph = (clone as any).graph as SceneGraph | undefined;
    if (graph) {
      ensureSceneLayout(graph, clone.id);
    }

    // Pin root to requested dimensions. After Yoga runs, content may
    // overflow vertically (OG card 1200×630 with content summing to
    // 1676) or underfill (story 1080×1920 with content only 1543 tall);
    // either way the caller asked for a specific canvas. The reflow
    // strategy preserves the request — long-form scrolling pages should
    // use mobile/email sizes (where height = "as tall as needed") and
    // pass the full content height as `newHeight`. Fixed-canvas formats
    // (OG, story, app splash) get the canvas they asked for, with
    // overflow content visually clipped at the edges of the export.
    //
    // Bypass the StandaloneNode setter by going directly to the graph —
    // wrapper.resize() goes through a getter chain and was silently
    // no-op'ing here for reasons unclear (probably reading a stale
    // `this.raw` snapshot after the Yoga pass), leaving root at the
    // overflow-grown 1676 instead of the requested 630.
    if (graph) {
      try {
        graph.updateNode(clone.id, { width: newWidth, height: newHeight });
      } catch {}
    }

    return clone;
  }

  /**
   * Set up the cloned root as a fixed-size flex container whose children
   * inherit the full counter-axis dimension via STRETCH. PRESERVES the
   * source layoutMode: a HORIZONTAL source (sidebar | main, split-screen
   * landing, side-by-side panels) stays HORIZONTAL on resize. Forcing
   * VERTICAL on those broke dashboards by stacking the sidebar above
   * the main column at full root height — main collapsed to ~16 px.
   *
   * The stretchCross contract in `engine/layout.ts` is precisely:
   *   `parent.counterAxisAlign === 'STRETCH' && child.layoutAlignSelf === 'AUTO'`
   * Both sides of that check have to hold. If we set STRETCH on the
   * child directly — the intuitive move — layout.ts actually _disables_
   * the stretch path and falls back to the stored width. So the
   * convention below is: parent says STRETCH, children stay on AUTO.
   */
  private makeRootVertical(root: INode, newWidth: number, newHeight: number): void {
    const sourceMode = (root as any).layoutMode;
    // Default to VERTICAL only when the source has no explicit layout
    // (NONE / undefined) — long-form pages without auto-layout get the
    // implicit "stack everything vertically" treatment as before.
    const targetMode: 'VERTICAL' | 'HORIZONTAL' =
      sourceMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';

    // Write through the graph directly. StandaloneNode only exposes
    // setters for a handful of properties (fills, x, y, name, …). Layout-
    // mode props like primaryAxisSizing / counterAxisSizing have no
    // setter at all, so `(root as any).primaryAxisSizing = 'FIXED'` was
    // silently writing to the JS wrapper instance instead of the raw
    // graph node — Yoga then read the raw node's UNCHANGED HUG sizing
    // and re-grew the root from content on every layout pass, defeating
    // the whole "fixed canvas" intent of OG card / story / splash.
    const graph = (root as any).graph as SceneGraph | undefined;
    if (graph) {
      graph.updateNode(root.id, {
        layoutMode: targetMode,
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        primaryAxisAlign: 'MIN',
        counterAxisAlign: 'STRETCH',
        width: newWidth,
        height: newHeight,
      } as any);
    } else {
      // Fallback: best-effort via wrapper setters.
      try { (root as any).layoutMode = targetMode; } catch {}
      try { (root as any).primaryAxisSizing = 'FIXED'; } catch {}
      try { (root as any).counterAxisSizing = 'FIXED'; } catch {}
      try { (root as any).primaryAxisAlign = 'MIN'; } catch {}
      try { (root as any).counterAxisAlign = 'STRETCH'; } catch {}
      try { root.resize(newWidth, newHeight); } catch {}
    }
  }

  /**
   * Walk the cloned tree and prepare every node for re-layout. FRAMEs
   * keep their source layoutMode (VERTICAL or HORIZONTAL — only GRID
   * gets special handling), children reset position so Yoga owns x/y,
   * TEXT nodes get `textAutoResize: WIDTH_AND_HEIGHT`, and absolute
   * descendants get proportional geometry.
   */
  private reflowSubtree(rootNode: INode, ratios: ReflowRatios): void {
    // Track absolute frames so we descend into their subtree without
    // running prepareFrame on them a second time — their geometry is
    // already locked in by prepareAbsoluteChild, and prepareFrame would
    // re-multiply by widthRatio and double-scale the box.
    const absoluteIds = new Set<string>();

    const walk = (node: INode): void => {
      if (node.type === NodeType.Frame && !absoluteIds.has(node.id)) {
        this.prepareFrame(node, node === rootNode, ratios);
      }
      const children = (node.children ?? []) as INode[];
      for (const child of children) {
        if ((child as any).layoutPositioning === 'ABSOLUTE') {
          absoluteIds.add(child.id);
          this.prepareAbsoluteChild(child, ratios);
          // Descend into the absolute child's own subtree so inner
          // text still gets font scaling + wrap config. We just skip
          // touching the absolute child's frame box itself (it was
          // handled by prepareAbsoluteChild).
          walk(child);
          continue;
        }
        this.prepareAutoChild(child, ratios);
        walk(child);
      }
    };
    walk(rootNode);
  }

  private prepareFrame(frame: INode, isRoot: boolean, ratios: ReflowRatios): void {
    if (isRoot) return; // root is set up by makeRootVertical

    // Scale padding + gap proportional to the width ratio BEFORE
    // resizing the frame. On a 1440 → 375 mobile shrink a 64px section
    // padding eats 128 of the 375 total canvas and leaves nested cards
    // at 2px of content width; 32px card padding on a 66px card eats
    // everything and collapses text to single-character wrap. Scaling
    // both padding and itemSpacing by widthRatio keeps the design
    // proportions while ensuring inner content has room to breathe.
    this.scaleFrameChrome(frame, ratios);

    // Read layoutMode from the raw graph node, NOT the StandaloneNode
    // wrapper. The wrapper exposes no `layoutMode` getter, so
    // `(frame as any).layoutMode` returned undefined for every frame
    // and the HORIZONTAL/GRID branches were never reached — every row
    // fell through to the default VERTICAL coerce path. Mobile collapse
    // (Bug #36) and button HUG detection (Bug #37) both depend on this
    // read producing the right value.
    const graphRef = (frame as any).graph as SceneGraph | undefined;
    const rawNode = graphRef ? graphRef.getNode(frame.id) : undefined;
    const mode = (rawNode as any)?.layoutMode ?? (frame as any).layoutMode;

    // GRID containers get their tracks rewritten in-place. Columns
    // collapse as the target narrows so a 3-col card row becomes 2-col
    // at mid sizes and 1-col on mobile. Grid frames use their own
    // layout engine (computeGridLayout), so we don't touch counterAxis
    // knobs that only matter to Yoga.
    if (mode === 'GRID') {
      this.prepareGridFrame(frame, ratios);
      return;
    }

    // Preserve HORIZONTAL rows instead of flattening them to vertical.
    // Rows of buttons, tabs, toolbars all rely on staying side-by-side;
    // coercing them to VERTICAL is the trade-off we removed in Session
    // 2. Narrow targets get `layoutWrap: WRAP` so items fold onto a
    // second line if the combined intrinsic width no longer fits.
    if (mode === 'HORIZONTAL') {
      this.prepareHorizontalFrame(frame, ratios);
      return;
    }

    // Default: VERTICAL (or coerce NONE → VERTICAL).
    const newFrameWidth = Math.round(frame.width * ratios.widthRatio);
    if (graphRef) {
      graphRef.updateNode(frame.id, {
        layoutMode: 'VERTICAL',
        counterAxisAlign: 'STRETCH',
        primaryAxisAlign: 'MIN',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'FIXED',
        width: newFrameWidth,
      } as any);
    } else {
      try { frame.resize(newFrameWidth, frame.height); } catch {}
    }
  }

  /**
   * Scale padding and itemSpacing by the width ratio. Only shrinks —
   * a widen (widthRatio > 1) leaves chrome untouched, because inflating
   * 32px padding to 64px on a desktop resize looks comically loose and
   * breaks the designer's intended rhythm. Shrinks only, and only when
   * the ratio is below 0.85, so near-square resizes don't touch
   * anything. Padding values smaller than 4px are left alone — they're
   * tight already and shrinking them further produces zero.
   *
   * Writes go through `graph.updateNode` directly instead of the
   * INode setters because StandaloneNode exposes padding as a getter
   * only — the intuitive `frame.paddingTop = 17` assignment falls on
   * the JS instance without propagating to the graph, the same trap
   * Session 2 hit with `frame.width`.
   */
  private scaleFrameChrome(frame: INode, ratios: ReflowRatios): void {
    if (ratios.widthRatio >= 0.85) return;
    const r = ratios.widthRatio;
    const graph = (frame as any).graph as { updateNode: (id: string, changes: any) => void; getNode: (id: string) => any } | undefined;
    if (!graph) return;
    const shrink = (v: number | undefined): number | undefined => {
      if (v == null || v <= 4) return v;
      return Math.max(4, Math.round(v * r));
    };
    // Read padding/gap from the raw graph node — the wrapper has no
    // getter for these props.
    const raw = graph.getNode(frame.id) as any;
    if (!raw) return;
    const updates: Record<string, number> = {};
    const padT = shrink(raw.paddingTop);
    const padR = shrink(raw.paddingRight);
    const padB = shrink(raw.paddingBottom);
    const padL = shrink(raw.paddingLeft);
    if (padT != null && padT !== raw.paddingTop) updates.paddingTop = padT;
    if (padR != null && padR !== raw.paddingRight) updates.paddingRight = padR;
    if (padB != null && padB !== raw.paddingBottom) updates.paddingBottom = padB;
    if (padL != null && padL !== raw.paddingLeft) updates.paddingLeft = padL;
    const gap = shrink(raw.itemSpacing);
    if (gap != null && gap !== raw.itemSpacing) updates.itemSpacing = gap;
    if (Object.keys(updates).length > 0) {
      graph.updateNode(frame.id, updates);
    }
  }

  private prepareHorizontalFrame(frame: INode, ratios: ReflowRatios): void {
    // All layout-mode props (and reads) go through the raw graph node.
    // The StandaloneNode wrapper exposes no getter for layoutMode /
    // primaryAxisSizing / paddingLeft / itemSpacing / cornerRadius, so
    // `(frame as any).foo` reads from the JS instance (always
    // undefined / 0) instead of the underlying scene node, which broke
    // every detection branch in this function. Read the raw once and
    // use it as the source of truth for the rest of the pass.
    const graphRef = (frame as any).graph as SceneGraph | undefined;
    const raw = graphRef ? (graphRef.getNode(frame.id) as any) : undefined;

    const children = (frame.children ?? []) as INode[];
    const flowingChildren = children.filter(
      c => (c as any).layoutPositioning !== 'ABSOLUTE',
    );

    // Button-shaped detection: HORIZONTAL frame with a single TEXT
    // child and a cornerRadius. Source-scaling its width linearly
    // ("Start now" 120 px → 31 px on a 375 mobile) cooks the text
    // into a 19-wide blob. Buttons should HUG their (re-measured)
    // content + brand padding instead.
    const cornerRadius = raw?.cornerRadius ?? 0;
    const isButtonShape =
      flowingChildren.length === 1 &&
      flowingChildren[0]?.type === NodeType.Text &&
      typeof cornerRadius === 'number' &&
      cornerRadius > 0;
    if (isButtonShape && graphRef) {
      graphRef.updateNode(frame.id, {
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
      } as any);
      return;
    }

    const newFrameWidth = Math.round(frame.width * ratios.widthRatio);
    const gap = raw?.itemSpacing ?? 0;
    const totalChildrenWidth = flowingChildren
      .reduce((sum, c, i) => sum + c.width * ratios.widthRatio + (i > 0 ? gap : 0), 0);

    const padLR = (raw?.paddingLeft ?? 0) + (raw?.paddingRight ?? 0);
    const contentBudget = newFrameWidth - padLR;

    // Mobile collapse: a HORIZONTAL row of 3+ content-bearing children
    // on a narrow target (≤600 px) collapses to VERTICAL stack. Without
    // this, a 3-column features grid on a 1440 desktop ends up as a
    // tight 3-column row of 105-px-wide cards on a 375 mobile, which
    // is the "buttons stick together / nothing looks resized" report.
    // Threshold 600 px matches the standard tablet-portrait → mobile
    // breakpoint, and the 3-children floor avoids collapsing 2-button
    // CTA rows that legitimately stay side-by-side on mobile.
    const isNarrowTarget = newFrameWidth <= 600;
    const isContentRow = flowingChildren.length >= 3;
    const shouldCollapseToColumn = isNarrowTarget && isContentRow;

    // Per-child width budget too small? Even with 2 children, if each
    // would end up < 120 px (sub-card territory), collapse anyway.
    const perChildBudget = flowingChildren.length > 0
      ? (contentBudget - gap * (flowingChildren.length - 1)) / flowingChildren.length
      : 0;
    const isTooNarrow = isNarrowTarget && flowingChildren.length >= 2 && perChildBudget < 120;

    const shouldWrap = !shouldCollapseToColumn && !isTooNarrow && totalChildrenWidth > contentBudget + 1;

    if (graphRef) {
      if (shouldCollapseToColumn || isTooNarrow) {
        // Switch to VERTICAL stack with stretched cross axis.
        graphRef.updateNode(frame.id, {
          layoutMode: 'VERTICAL',
          primaryAxisSizing: 'HUG',
          counterAxisSizing: 'FIXED',
          primaryAxisAlign: 'MIN',
          counterAxisAlign: 'STRETCH',
          width: newFrameWidth,
        } as any);

        // Stretch children to fill the collapsed column. Without this,
        // each card retains its own scaled width (~107 px on a 375 px
        // mobile) and lands as a column of narrow cards stuck to the
        // left edge. Setting width = inner content width matches what
        // counterAxisAlign:STRETCH would do if the children weren't
        // already FIXED-sized by their own prepareFrame pass.
        const innerW = Math.max(0, newFrameWidth - padLR);
        if (innerW > 0) {
          for (const child of flowingChildren) {
            try {
              graphRef.updateNode(child.id, { width: innerW } as any);
            } catch { /* best-effort */ }
          }
        }
      } else {
        const updates: Record<string, unknown> = {
          primaryAxisSizing: 'FIXED',
          counterAxisSizing: 'HUG',
          counterAxisAlign: 'CENTER',
          width: newFrameWidth,
        };
        if (shouldWrap) updates.layoutWrap = 'WRAP';
        graphRef.updateNode(frame.id, updates as any);
      }
    } else {
      try { frame.resize(newFrameWidth, frame.height); } catch {}
    }
  }

  private prepareGridFrame(frame: INode, ratios: ReflowRatios): void {
    const graphRef = (frame as any).graph as SceneGraph | undefined;
    const tracks = ((frame as any).gridTemplateColumns ?? []) as Array<{ type: string; value: number }>;
    if (tracks.length === 0) {
      // No explicit tracks — treat as vertical stack.
      const w = Math.round(frame.width * ratios.widthRatio);
      if (graphRef) {
        graphRef.updateNode(frame.id, {
          layoutMode: 'VERTICAL',
          counterAxisAlign: 'STRETCH',
          width: w,
        } as any);
      } else {
        try { frame.resize(w, frame.height); } catch {}
      }
      return;
    }

    // Resize the frame to the scaled width. Grid tracks re-distribute
    // based on that new width during computeGridLayout.
    const newFrameWidth = Math.round(frame.width * ratios.widthRatio);

    // If the scaled width got much smaller, collapse columns. Each
    // collapse step halves the column count, which keeps powers-of-two
    // layouts (4 → 2 → 1) consistent and avoids fractional grids.
    //
    // Heuristic: if scaled width <= 60% of source per-column slot, drop
    // a level. Loop until we stop dropping.
    let nextTracks = tracks;
    const widthBudget = newFrameWidth;
    while (nextTracks.length > 1) {
      const slotTarget = widthBudget / nextTracks.length;
      const srcSlot = frame.width / tracks.length;
      // scaled slot is smaller than 60% of what the source had → halve
      if (slotTarget < srcSlot * 0.6) {
        nextTracks = halveGridTracks(nextTracks);
        continue;
      }
      break;
    }

    if (graphRef) {
      const updates: Record<string, unknown> = { width: newFrameWidth };
      if (nextTracks !== tracks) updates.gridTemplateColumns = nextTracks;
      graphRef.updateNode(frame.id, updates as any);
    } else {
      try { frame.resize(newFrameWidth, frame.height); } catch {}
    }
  }

  private prepareAutoChild(child: INode, ratios: ReflowRatios): void {
    // All writes go through graph.updateNode — wrapper-prop assignments
    // silently no-op on layout/text props (Bug #28 family). Without
    // this, x/y/textAutoResize/fontSize/lineHeight all stayed on
    // the JS instance and never reached the raw graph node, so resize
    // produced visually identical clones of the source.
    const graphRef = (child as any).graph as SceneGraph | undefined;
    const updates: Record<string, unknown> = {
      x: 0,
      y: 0,
      layoutAlignSelf: 'AUTO',
    };

    if (child.type === NodeType.Text) {
      // WIDTH_AND_HEIGHT: Yoga drives both dimensions via measureFunc,
      // which is the only branch in configureLeaf() that lets Yoga pass
      // its own content-width constraint into the measurer.
      updates.textAutoResize = 'WIDTH_AND_HEIGHT';

      // Font scaling — only touch if the ratio is meaningfully off.
      // Tolerance of ±5% avoids random font churn on near-square resizes.
      if (Math.abs(ratios.fontRatio - 1) > 0.05) {
        const currentSize = (child as any).fontSize;
        if (typeof currentSize === 'number' && currentSize > 0) {
          const role = (child as any).semanticRole;
          const floor = (role === 'caption' || role === 'disclaimer') ? 9 : 8;
          const scaled = Math.max(floor, Math.round(currentSize * ratios.fontRatio));
          updates.fontSize = scaled;
          const curLh = (child as any).lineHeight;
          if (typeof curLh === 'number' && curLh > 0) {
            updates.lineHeight = Math.round(curLh * ratios.fontRatio);
          }
        }
      }
    }

    if (graphRef) {
      graphRef.updateNode(child.id, updates as any);
    }
  }

  /**
   * Absolute-positioned children get proportional x/y/width/height so
   * decorative overlays (badges, callouts, chips pinned to a corner)
   * stay in the same relative location after the resize. Their subtree
   * also gets walked — text inside a pinned badge should still wrap
   * correctly at the new width.
   *
   * `rotation` is explicitly preserved. The intuitive move — scaling
   * the bounding box without touching the angle — produces the wrong
   * visual for a 45°-pinned label: the geometry stretches but the
   * rotation anchor shifts because Figma's rotation is around the
   * top-left corner of the original bbox. Keeping `rotation` as-is and
   * only scaling position + dimensions matches the pre-reflow look
   * modulo the uniform scale factor. If we ever need proper rotated
   * bbox math, layout.ts is the right place — reflow is not.
   */
  private prepareAbsoluteChild(child: INode, ratios: ReflowRatios): void {
    const newX = Math.round(child.x * ratios.widthRatio);
    const newY = Math.round(child.y * ratios.heightRatio);
    const newW = Math.round(child.width * ratios.widthRatio);
    const newH = Math.round(child.height * ratios.heightRatio);
    const graphRef = (child as any).graph as SceneGraph | undefined;
    if (graphRef) {
      graphRef.updateNode(child.id, {
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      } as any);
    } else {
      try { child.resize(newW, newH); } catch {}
    }
    // `rotation` is left untouched on purpose. If the source had a
    // 45°-rotated badge, the reflowed clone stays 45°-rotated.
  }
}

interface ReflowRatios {
  widthRatio: number;
  heightRatio: number;
  fontRatio: number;
}

/**
 * Halve a grid's track list while preserving its proportional shape.
 * `[1fr, 1fr, 1fr, 1fr]` → `[1fr, 1fr]` → `[1fr]`. Odd counts round up,
 * so a 3-col grid becomes 2-col not 1-col on the first halve.
 */
function halveGridTracks(
  tracks: Array<{ type: string; value: number }>,
): Array<{ type: string; value: number }> {
  const newLen = Math.max(1, Math.ceil(tracks.length / 2));
  // Take the first N tracks — they set the proportion. If the grid was
  // asymmetric (e.g. sidebar + main), the first half is a reasonable
  // approximation; perfect reconstruction would require re-merging
  // values which isn't worth it for v0.
  return tracks.slice(0, newLen) as Array<{ type: string; value: number }>;
}

export function createReflowPipeline(): ReflowPipeline {
  return new ReflowPipeline();
}
