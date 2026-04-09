/**
 * Audit Panel — shows design issues with severity, auto-fix, click-to-select.
 *
 * Runs the same inspect audit rules as MCP `reframe_inspect` (19 + palette when DESIGN.md is loaded).
 */

import { useCallback } from 'react';
import { useSceneStore, getActiveArtboard } from '../store/scene';

const SEVERITY_COLORS: Record<string, string> = {
  error: 'var(--error)',
  warning: 'var(--warning)',
  info: 'var(--text-accent)',
};

const SEVERITY_ICONS: Record<string, string> = {
  error: '●',
  warning: '▲',
  info: 'ℹ',
};

export function AuditPanel() {
  const ab = useSceneStore(s => getActiveArtboard(s));
  const auditIssues = ab?.auditIssues ?? [];
  const runAudit = useSceneStore(s => s.runAudit);
  const select = useSceneStore(s => s.select);
  const graph = ab?.graph ?? null;
  const rootId = ab?.rootId ?? null;
  const designSystem = useSceneStore(s => s.designSystem);

  const handleRunAudit = useCallback(() => { runAudit(); }, [runAudit]);

  const handleClickIssue = useCallback((nodeId: string) => {
    if (nodeId) select([nodeId]);
  }, [select]);

  const errorCount = auditIssues.filter(i => i.severity === 'error').length;
  const warnCount = auditIssues.filter(i => i.severity === 'warning').length;
  const infoCount = auditIssues.filter(i => i.severity === 'info').length;

  return (
    <div className="audit-panel">
      <div className="panel-header">
        <span>
          Design check
          {auditIssues.length > 0 && (
            <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {errorCount > 0 && <span style={{ color: 'var(--error)', marginRight: 6 }}>{errorCount} errors</span>}
              {warnCount > 0 && <span style={{ color: 'var(--warning)', marginRight: 6 }}>{warnCount} warnings</span>}
              {infoCount > 0 && <span style={{ color: 'var(--text-accent)' }}>{infoCount} info</span>}
            </span>
          )}
        </span>
        <button
          type="button"
          className="toolbar__btn audit-panel__scan"
          onClick={handleRunAudit}
          disabled={!graph || !rootId}
          title="Same rules as MCP reframe_inspect: contrast, touch targets, type scale, tokens, …"
        >
          Scan
        </button>
      </div>

      <div className="audit-panel__list">
        {designSystem && (
          <div className="audit-panel__ds-note">
            DESIGN.md loaded — brand palette rules on
          </div>
        )}

        {auditIssues.map((issue, i) => (
          <div
            key={i}
            onClick={() => issue.nodeId && handleClickIssue(issue.nodeId)}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              cursor: issue.nodeId ? 'pointer' : 'default',
              borderBottom: '1px solid var(--border-subtle)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{
              color: SEVERITY_COLORS[issue.severity] ?? 'var(--text-muted)',
              flexShrink: 0,
              fontSize: 10,
              marginTop: 1,
            }}>
              {SEVERITY_ICONS[issue.severity] ?? '●'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text-primary)' }}>{issue.message}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                {issue.rule}
                {issue.nodeName && <span> · {issue.nodeName}</span>}
              </div>
              {issue.fix?.css && (
                <div style={{
                  marginTop: 3, padding: '2px 6px', fontSize: 10,
                  background: 'var(--bg-input)', borderRadius: 3,
                  fontFamily: 'var(--font-mono)', color: 'var(--success)',
                }}>
                  fix: {issue.fix.css}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
