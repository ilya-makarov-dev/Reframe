/**
 * Audit Panel — shows design issues with severity, auto-fix, click-to-select.
 *
 * Runs 17 rules against the INode tree. Issues link to nodes on canvas.
 */

import { useCallback } from 'react';
import { useSceneStore } from '../store/scene';

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
  const auditIssues = useSceneStore(s => s.auditIssues);
  const runAudit = useSceneStore(s => s.runAudit);
  const select = useSceneStore(s => s.select);
  const graph = useSceneStore(s => s.graph);
  const rootId = useSceneStore(s => s.rootId);
  const designSystem = useSceneStore(s => s.designSystem);

  const handleRunAudit = useCallback(() => { runAudit(); }, [runAudit]);

  const handleClickIssue = useCallback((nodeId: string) => {
    if (nodeId) select([nodeId]);
  }, [select]);

  const errorCount = auditIssues.filter(i => i.severity === 'error').length;
  const warnCount = auditIssues.filter(i => i.severity === 'warning').length;
  const infoCount = auditIssues.filter(i => i.severity === 'info').length;

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div className="panel-header">
        <span>
          Audit
          {auditIssues.length > 0 && (
            <span style={{ marginLeft: 8, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {errorCount > 0 && <span style={{ color: 'var(--error)', marginRight: 6 }}>{errorCount} errors</span>}
              {warnCount > 0 && <span style={{ color: 'var(--warning)', marginRight: 6 }}>{warnCount} warnings</span>}
              {infoCount > 0 && <span style={{ color: 'var(--text-accent)' }}>{infoCount} info</span>}
            </span>
          )}
          {auditIssues.length === 0 && graph && rootId && (
            <span style={{ marginLeft: 8, color: 'var(--success)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              Clean
            </span>
          )}
        </span>
        <button
          className="toolbar__btn"
          style={{ fontSize: 10, padding: '2px 8px' }}
          onClick={handleRunAudit}
          disabled={!graph || !rootId}
        >
          Run
        </button>
      </div>

      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {!graph && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
            Import a design to audit
          </div>
        )}

        {designSystem && (
          <div style={{
            padding: '4px 12px', fontSize: 10, color: 'var(--success)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            Design system loaded — brand compliance rules active
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
