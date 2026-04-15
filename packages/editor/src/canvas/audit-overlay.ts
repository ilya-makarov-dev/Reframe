/**
 * Audit Overlay — renders audit warnings on the CanvasKit canvas.
 *
 * After the main SkiaRenderer.render() draws the scene, the audit overlay
 * draws colored outlines around flagged nodes:
 *   - Red: errors (content-overflow, cta-visibility, etc.)
 *   - Orange: warnings (contrast, touch-target, etc.)
 *   - Blue: info (whitespace, hierarchy, density, etc.)
 *
 * Uses the editor's graph + SkiaRenderer's coordinate system
 * to position overlays correctly at any zoom/pan.
 */

import type { SceneGraph as OPSceneGraph } from '@open-pencil/core';
import type { SkiaRenderer } from '@open-pencil/core';

export interface AuditIssueOverlay {
  nodeId: string;
  severity: 'error' | 'warning' | 'info';
  rule: string;
  message: string;
}

export interface AuditOverlayState {
  /** Active audit issues to display. */
  issues: AuditIssueOverlay[];
  /** Whether to show the overlay. */
  visible: boolean;
  /** Which severity levels to show. */
  showErrors: boolean;
  showWarnings: boolean;
  showInfo: boolean;
}

export function createAuditOverlayState(): AuditOverlayState {
  return {
    issues: [],
    visible: true,
    showErrors: true,
    showWarnings: true,
    showInfo: false, // Info hidden by default — too noisy
  };
}

/**
 * Draw audit overlay on the canvas AFTER the main render.
 *
 * This uses CanvasKit's drawing API to render colored outlines
 * around flagged nodes. Must be called after renderer.render()
 * within the same animation frame.
 */
export function drawAuditOverlay(
  renderer: SkiaRenderer,
  graph: OPSceneGraph,
  state: AuditOverlayState,
): void {
  if (!state.visible || state.issues.length === 0) return;

  const ck = renderer.ck;
  const surface = renderer.surface;
  if (!ck || !surface) return;

  const canvas = surface.getCanvas();

  // Save canvas state
  canvas.save();

  // Apply viewport transform (same as renderer)
  const dpr = renderer.dpr || 1;
  canvas.scale(dpr, dpr);
  canvas.translate(renderer.panX, renderer.panY);
  canvas.scale(renderer.zoom, renderer.zoom);

  // Create paints for each severity
  const errorPaint = new ck.Paint();
  errorPaint.setStyle(ck.PaintStyle.Stroke);
  errorPaint.setColor(ck.Color4f(0.92, 0.2, 0.2, 0.8)); // Red
  errorPaint.setStrokeWidth(2 / renderer.zoom); // Scale-independent

  const warningPaint = new ck.Paint();
  warningPaint.setStyle(ck.PaintStyle.Stroke);
  warningPaint.setColor(ck.Color4f(0.95, 0.55, 0.0, 0.7)); // Orange
  warningPaint.setStrokeWidth(1.5 / renderer.zoom);

  const infoPaint = new ck.Paint();
  infoPaint.setStyle(ck.PaintStyle.Stroke);
  infoPaint.setColor(ck.Color4f(0.2, 0.5, 0.95, 0.5)); // Blue
  infoPaint.setStrokeWidth(1 / renderer.zoom);
  infoPaint.setPathEffect(ck.PathEffect.MakeDash(
    [4 / renderer.zoom, 4 / renderer.zoom],
    0,
  ));

  // Group issues by node
  const issuesByNode = new Map<string, AuditIssueOverlay[]>();
  for (const issue of state.issues) {
    if (issue.severity === 'error' && !state.showErrors) continue;
    if (issue.severity === 'warning' && !state.showWarnings) continue;
    if (issue.severity === 'info' && !state.showInfo) continue;

    if (!issue.nodeId) continue;
    const list = issuesByNode.get(issue.nodeId) ?? [];
    list.push(issue);
    issuesByNode.set(issue.nodeId, list);
  }

  // Draw outlines for each flagged node
  for (const [nodeId, issues] of issuesByNode) {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) continue;

    // Get absolute position
    const absPos = graph.getAbsolutePosition(nodeId);
    const x = absPos.x;
    const y = absPos.y;
    const w = node.width;
    const h = node.height;

    // Pick paint based on highest severity
    const maxSeverity = issues.some(i => i.severity === 'error') ? 'error'
      : issues.some(i => i.severity === 'warning') ? 'warning'
      : 'info';

    const paint = maxSeverity === 'error' ? errorPaint
      : maxSeverity === 'warning' ? warningPaint
      : infoPaint;

    // Draw rounded rect outline
    const pad = 2 / renderer.zoom;
    const rect = ck.LTRBRect(x - pad, y - pad, x + w + pad, y + h + pad);
    const radius = Math.min(4 / renderer.zoom, node.cornerRadius + 2 / renderer.zoom);
    const rrect = ck.RRectXY(rect, radius, radius);
    canvas.drawRRect(rrect, paint);

    // Draw issue count badge (top-right corner)
    if (issues.length > 1 || maxSeverity === 'error') {
      const badgeSize = 14 / renderer.zoom;
      const badgeX = x + w + pad;
      const badgeY = y - pad - badgeSize;

      const badgePaint = new ck.Paint();
      badgePaint.setStyle(ck.PaintStyle.Fill);
      badgePaint.setColor(
        maxSeverity === 'error' ? ck.Color4f(0.92, 0.2, 0.2, 1.0)
        : maxSeverity === 'warning' ? ck.Color4f(0.95, 0.55, 0.0, 1.0)
        : ck.Color4f(0.2, 0.5, 0.95, 1.0),
      );

      const badgeRect = ck.LTRBRect(
        badgeX - badgeSize,
        badgeY,
        badgeX,
        badgeY + badgeSize,
      );
      canvas.drawRRect(ck.RRectXY(badgeRect, badgeSize / 2, badgeSize / 2), badgePaint);
      badgePaint.delete();
    }
  }

  // Clean up paints
  errorPaint.delete();
  warningPaint.delete();
  infoPaint.delete();

  // Restore canvas
  canvas.restore();

  // Flush to display
  surface.flush();
}
