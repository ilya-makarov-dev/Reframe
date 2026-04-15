/**
 * Audit Panel — displays reframe's 37-rule audit results.
 *
 * Shows errors/warnings/info grouped by severity.
 * Click on an issue → selects the flagged node on canvas.
 * "Auto-fix" button runs the auto-fix pipeline.
 */

import type { AuditIssueOverlay } from '../canvas/audit-overlay.js';

export interface AuditPanelData {
  issues: AuditIssueOverlay[];
  /** Aesthetic score (0-100). */
  aestheticScore: number | null;
  /** Brand fidelity score (0-100). */
  brandFidelity: number | null;
  /** Whether auto-fix is available. */
  canAutoFix: boolean;
}

/** Render the audit panel as HTML string. */
export function renderAuditPanel(data: AuditPanelData): string {
  const sections: string[] = [];

  // ── Scores ──
  if (data.aestheticScore != null || data.brandFidelity != null) {
    sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;display:flex;gap:12px;">
      ${data.aestheticScore != null ? scoreCard('Aesthetic', data.aestheticScore) : ''}
      ${data.brandFidelity != null ? scoreCard('Brand', data.brandFidelity) : ''}
    </div>`);
  }

  // ── Summary ──
  const errors = data.issues.filter(i => i.severity === 'error');
  const warnings = data.issues.filter(i => i.severity === 'warning');
  const infos = data.issues.filter(i => i.severity === 'info');

  const summaryParts: string[] = [];
  if (errors.length) summaryParts.push(`<span style="color:#ef4444;">${errors.length}E</span>`);
  if (warnings.length) summaryParts.push(`<span style="color:#f59e0b;">${warnings.length}W</span>`);
  if (infos.length) summaryParts.push(`<span style="color:#3b82f6;">${infos.length}I</span>`);

  const allClean = data.issues.length === 0;

  sections.push(`<div style="padding:12px 0;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:13px;">
      ${allClean
        ? '<span style="color:#22c55e;">All clear</span>'
        : summaryParts.join(' / ')
      }
    </div>
    ${data.canAutoFix && !allClean ? `<button data-action="auto-fix" style="
      padding:4px 10px;border-radius:4px;border:1px solid #333;
      background:#1a1a1a;color:#e5e5e5;font-size:11px;cursor:pointer;
    ">Auto-fix</button>` : ''}
  </div>`);

  // ── Issues by severity ──
  if (errors.length > 0) {
    sections.push(issueGroup('Errors', errors, '#ef4444'));
  }
  if (warnings.length > 0) {
    sections.push(issueGroup('Warnings', warnings, '#f59e0b'));
  }
  if (infos.length > 0) {
    sections.push(issueGroup('Info', infos, '#3b82f6'));
  }

  return sections.join('');
}

// ─── Helpers ──────────────────────────────────────────────

function scoreCard(label: string, score: number): string {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : '#ef4444';
  return `<div style="flex:1;background:#1a1a1a;border-radius:6px;padding:10px;text-align:center;">
    <div style="font-size:24px;font-weight:700;color:${color};">${score}</div>
    <div style="font-size:10px;color:#666;margin-top:2px;">${label}</div>
  </div>`;
}

function issueGroup(title: string, issues: AuditIssueOverlay[], color: string): string {
  let html = `<div style="padding:12px 0;border-bottom:1px solid #222;">
    <div style="font-size:11px;font-weight:600;color:${color};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">${title} (${issues.length})</div>`;

  for (const issue of issues.slice(0, 20)) {
    html += `<button data-action="select-node" data-node-id="${issue.nodeId}" style="
      display:block;width:100%;text-align:left;padding:6px 8px;margin-bottom:2px;
      background:transparent;border:1px solid transparent;border-radius:4px;
      color:#e5e5e5;cursor:pointer;font-family:inherit;font-size:11px;line-height:1.4;
    " onmouseover="this.style.background='#1a1a1a';this.style.borderColor='#262626'" onmouseout="this.style.background='transparent';this.style.borderColor='transparent'">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span style="color:#888;font-size:10px;">${issue.rule}</span>
      </div>
      <div style="margin-top:2px;color:#ccc;">${escHtml(issue.message.slice(0, 100))}</div>
    </button>`;
  }

  if (issues.length > 20) {
    html += `<div style="font-size:11px;color:#555;padding:4px 8px;">...and ${issues.length - 20} more</div>`;
  }

  html += `</div>`;
  return html;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
