/**
 * Build engine — compiles all scenes from config.
 *
 * config → for each scene × size → compile → audit → export → write
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReframeConfig, BuildOutput, BuildResult, ExportFormat, LayoutStyle } from './types.js';
import { resolveDesignMd, resolveSceneSizes } from './loader.js';
import { compileTemplate, autoPickLayout } from '../compiler/index.js';
import { build } from '../builder.js';
import { ensureSceneLayout } from '../engine/layout.js';
import { exportToHtml } from '../exporters/html.js';
import { exportToSvg, exportSceneGraphToSvg } from '../exporters/svg.js';
import { exportToReact } from '../exporters/react.js';
import { parseDesignMd } from '../design-system/index.js';
import type { DesignSystem } from '../design-system/index.js';
import { StandaloneNode } from '../adapters/standalone/node.js';
import { StandaloneHost } from '../adapters/standalone/adapter.js';
import { setHost } from '../host/context.js';
import { audit, type AuditRule } from '../audit.js';
import { buildInspectAuditRules } from '../inspect-audit-rules.js';
import type { SceneGraph } from '../engine/scene-graph.js';

export interface BuildLogger {
  scene(name: string): void;
  size(scene: string, size: string, width: number, height: number): void;
  compiled(scene: string, size: string, layout: string): void;
  audited(scene: string, size: string, passed: boolean, fixed: number, remaining: number): void;
  exported(scene: string, size: string, format: string, bytes: number): void;
  error(scene: string, size: string, message: string): void;
  done(output: BuildOutput): void;
}

/** Simple auto-fix: apply audit fix CSS directly to node properties. */
function applySimpleFixes(graph: SceneGraph, rootId: string, issues: any[]): number {
  let fixed = 0;
  for (const issue of issues) {
    if (!issue.fix || !issue.nodeId) continue;
    const node = graph.getNode(issue.nodeId);
    if (!node) continue;

    // Simple font-size fix
    if (issue.rule === 'min-font-size' && node.fontSize < (issue.fix.value ?? 10)) {
      graph.updateNode(issue.nodeId, { fontSize: issue.fix.value ?? 10 });
      fixed++;
    }
  }
  return fixed;
}

export async function buildAll(
  config: ReframeConfig,
  configDir: string,
  logger?: BuildLogger,
): Promise<BuildOutput> {
  const t0 = Date.now();
  const results: BuildResult[] = [];

  // Parse design system
  const designMdContent = resolveDesignMd(config, configDir);
  const ds = parseDesignMd(designMdContent);

  const outDir = path.resolve(configDir, config.outDir ?? '.reframe/dist');
  fs.mkdirSync(outDir, { recursive: true });

  for (const [sceneName, sceneSpec] of Object.entries(config.scenes)) {
    logger?.scene(sceneName);
    const sizes = resolveSceneSizes(sceneSpec, config.sizes);
    const formats = sceneSpec.exports ?? config.exports ?? ['html'];

    for (const size of sizes) {
      const sizeT0 = Date.now();
      logger?.size(sceneName, size.name, size.width, size.height);

      try {
        // 1. Pick layout
        const layoutInput = (size.layout ?? sceneSpec.layout ?? 'auto') as LayoutStyle;
        const resolvedLayout = layoutInput === 'auto'
          ? autoPickLayout(size.width, size.height, sceneSpec.content)
          : layoutInput;

        // 2. Compile
        const blueprint = compileTemplate({
          designSystem: ds,
          width: size.width,
          height: size.height,
          layout: resolvedLayout,
          content: sceneSpec.content,
        });
        const { graph, root } = build(blueprint);
        const host = new StandaloneHost(graph);
        setHost(host);

        ensureSceneLayout(graph, root.id);

        logger?.compiled(sceneName, size.name, resolvedLayout ?? 'auto');

        // 3. Audit (same rule stack as MCP inspect + Studio AuditPanel)
        const rules: AuditRule[] = buildInspectAuditRules(ds as DesignSystem, {
          minFontSize: 8,
          minContrast: 3,
        });

        setHost(new StandaloneHost(graph));
        const wrappedRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
        let issues = audit(wrappedRoot, rules, ds as DesignSystem);
        const fixCount = applySimpleFixes(graph, root.id, issues);

        // Re-audit after fixes
        if (fixCount > 0) {
          setHost(new StandaloneHost(graph));
          const reWrapped = new StandaloneNode(graph, graph.getNode(root.id)!);
          issues = audit(reWrapped, rules, ds as any);
        }

        const errors = issues.filter(i => i.severity === 'error');
        const auditPassed = errors.length === 0;

        logger?.audited(sceneName, size.name, auditPassed, fixCount, errors.length);

        // 4. Export
        const sceneDir = path.join(outDir, sceneName);
        fs.mkdirSync(sceneDir, { recursive: true });

        const exportResults: Record<string, string> = {};

        for (const fmt of formats as ExportFormat[]) {
          try {
            let content: string;
            let ext: string;

            switch (fmt) {
              case 'html': {
                content = exportToHtml(graph, root.id, { fullDocument: true });
                ext = 'html';
                break;
              }
              case 'svg': {
                content = exportSceneGraphToSvg(graph, root.id);
                ext = 'svg';
                break;
              }
              case 'react': {
                setHost(new StandaloneHost(graph));
                const rRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
                content = exportToReact(rRoot);
                ext = 'tsx';
                break;
              }
              default:
                continue;
            }

            const fileName = `${size.name}.${ext}`;
            const filePath = path.join(sceneDir, fileName);
            fs.writeFileSync(filePath, content, 'utf8');
            exportResults[fmt] = filePath;

            logger?.exported(sceneName, size.name, fmt, content.length);
          } catch (err: any) {
            logger?.error(sceneName, size.name, `export ${fmt}: ${err.message}`);
          }
        }

        const sceneId = `${sceneName}-${size.name}`;
        results.push({
          scene: sceneName,
          size: size.name,
          width: size.width,
          height: size.height,
          layout: resolvedLayout ?? 'auto',
          sceneId,
          auditPassed,
          auditFixed: fixCount,
          auditRemaining: errors.length,
          exports: exportResults,
          durationMs: Date.now() - sizeT0,
        });
      } catch (err: any) {
        logger?.error(sceneName, size.name, err.message);
        results.push({
          scene: sceneName,
          size: size.name,
          width: size.width,
          height: size.height,
          layout: 'error',
          sceneId: '',
          auditPassed: false,
          auditFixed: 0,
          auditRemaining: -1,
          exports: {},
          durationMs: Date.now() - sizeT0,
        });
      }
    }
  }

  const output: BuildOutput = {
    results,
    passed: results.filter(r => r.auditPassed).length,
    failed: results.filter(r => !r.auditPassed).length,
    totalMs: Date.now() - t0,
  };

  logger?.done(output);
  return output;
}
