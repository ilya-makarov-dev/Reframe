/**
 * Parse the "--- Audit ---" section from reframe_inspect text output into structured rows.
 * Format matches packages/mcp/src/tools/inspect.ts (issue lines + indented fix hints).
 */

export interface ParsedMcpAuditIssue {
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  fix?: string;
}

function extractUpdateTarget(fixLine: string): string | undefined {
  const m = fixLine.match(/update\s+"([^"]+)"/i);
  return m?.[1];
}

/**
 * @param text Full `reframe_inspect` tool response body
 */
export function parseInspectAuditSection(text: string): {
  issues: ParsedMcpAuditIssue[];
  passed: boolean;
  total: number;
} {
  const marker = '--- Audit';
  const start = text.indexOf(marker);
  if (start === -1) {
    return { issues: [], passed: true, total: 0 };
  }

  const rest = text.slice(start);
  const nextSection = rest.search(/\n--- (?!Audit)/);
  const body = nextSection === -1 ? rest : rest.slice(0, nextSection);

  const passed =
    /PASS — all checks passed/i.test(body)
    || /all checks passed/i.test(body);

  const issues: ParsedMcpAuditIssue[] = [];
  const lines = body.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const issueMatch = line.match(/^\[(x|!|i)\]\s+([^:]+):\s*(.+)$/);
    if (issueMatch) {
      const flag = issueMatch[1];
      const rule = issueMatch[2].trim();
      const message = issueMatch[3].trim();
      const severity: ParsedMcpAuditIssue['severity'] =
        flag === 'x' ? 'error' : flag === '!' ? 'warning' : 'info';
      if (flag === 'i' && /^\d+\s+info-level/i.test(message)) continue;
      issues.push({ rule, severity, message });
      continue;
    }

    const fixMatch = line.match(/^\s*→\s+(.+)$/);
    if (fixMatch && issues.length > 0) {
      const fixText = fixMatch[1].trim();
      const last = issues[issues.length - 1];
      const hint = extractUpdateTarget(fixText) ?? extractUpdateTarget(line);
      if (hint) last.nodeId = hint;
      last.fix = last.fix ? `${last.fix}\n${fixText}` : fixText;
    }
  }

  const blocking = issues.filter(i => i.severity === 'error' || i.severity === 'warning');
  const total = blocking.length;
  const derivedPass = passed || total === 0;

  return { issues, passed: derivedPass, total };
}
