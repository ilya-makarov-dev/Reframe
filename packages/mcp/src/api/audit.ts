/**
 * Audit API endpoint.
 *
 * GET /api/audit/:sceneId?aesthetic=true
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getScene } from '../store.js';
import { jsonResponse } from './router.js';

export async function handleAuditApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const sceneId = url.pathname.split('/api/audit/')[1];
  const includeAesthetic = url.searchParams.get('aesthetic') === 'true';

  const stored = getScene(sceneId);
  if (!stored) {
    jsonResponse(res, 404, { error: `Scene "${sceneId}" not found` });
    return;
  }

  const { ensureSceneLayout } = await import('../../../core/src/engine/layout.js');
  ensureSceneLayout(stored.graph, stored.rootId);

  const { StandaloneNode } = await import('../../../core/src/adapters/standalone/node.js');
  const { StandaloneHost } = await import('../../../core/src/adapters/standalone/adapter.js');
  const { setHost } = await import('../../../core/src/host/context.js');
  const { audit } = await import('../../../core/src/audit.js');
  const { buildInspectAuditRules } = await import('../../../core/src/inspect-audit-rules.js');

  const host = new StandaloneHost(stored.graph);
  setHost(host);
  const rootNode = new StandaloneNode(stored.graph, stored.graph.getNode(stored.rootId)!);

  const rules = buildInspectAuditRules(undefined);
  const issues = audit(rootNode as any, rules);

  const result: Record<string, unknown> = {
    sceneId,
    totalRules: rules.length,
    issues: issues.map(i => ({
      rule: i.rule,
      severity: i.severity,
      message: i.message,
      nodeId: i.nodeId,
      nodeName: i.nodeName,
      fix: i.fix,
    })),
    summary: {
      errors: issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      info: issues.filter(i => i.severity === 'info').length,
    },
  };

  if (includeAesthetic) {
    try {
      const { computeAestheticScore } = await import('../../../core/src/aesthetic/index.js');
      result.aesthetic = computeAestheticScore(stored.graph, stored.rootId);
    } catch (err: any) {
      result.aestheticError = err.message;
    }
  }

  jsonResponse(res, 200, result);
}
