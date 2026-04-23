// reframe ship — compile every scene in the project to a portable
// production bundle at `.reframe/dist/`.
//
// v1 = HTML-only bundle. Later versions will add a manifest (dist.json)
// describing the exported surfaces (scenes, site, videos) for deploy
// tools to consume.
//
// Usage:
//   reframe ship             — build every scene → .reframe/dist/<slug>.html
//   reframe ship --format=react  — (future) per-scene TSX bundle

import * as fs from 'node:fs';
import * as path from 'node:path';

export async function shipCommand(args: string[], flags: Record<string, string | undefined>): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, '.reframe', 'project.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`Not a reframe project (no .reframe/project.json).`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const scenes = (manifest.scenes ?? []) as Array<{ id: string; slug: string; file: string }>;
  if (scenes.length === 0) {
    console.log('No scenes to ship. Compile one first with reframe_compile.');
    return;
  }

  const distDir = path.join(cwd, '.reframe', 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  // Lazy-require engine bridge so ship works even when editor deps are missing
  const { initYoga } = await import('../engine-bridge.js');
  await initYoga();

  const format = flags.format ?? 'html';

  // For v1: shell out to the runtime's /preview/:id endpoint if a sidecar is
  // running. If not, we spawn a one-shot process that boots the engine and
  // serializes the scene straight from disk. The Robust Path is the latter
  // so `reframe ship` works without requiring `reframe serve` to be alive.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadSceneFromProject } = require(path.join(cwd, 'node_modules', '@reframe', 'core', 'dist', 'core', 'src', 'project', 'io.js'));
  const { exportToHtml } = require(path.join(cwd, 'node_modules', '@reframe', 'core', 'dist', 'core', 'src', 'exporters', 'html.js'));
  const { ensureSceneLayout } = require(path.join(cwd, 'node_modules', '@reframe', 'core', 'dist', 'core', 'src', 'engine', 'layout.js'));

  let okCount = 0;
  for (const s of scenes) {
    try {
      const { graph, rootId } = loadSceneFromProject(cwd, s.id);
      ensureSceneLayout(graph, rootId);
      const html = exportToHtml(graph, rootId, { fullDocument: true, dataAttributes: true });
      const outPath = path.join(distDir, `${s.slug}.${format === 'html' ? 'html' : 'html'}`);
      fs.writeFileSync(outPath, html, 'utf-8');
      console.log(`  🟢 ${s.slug}  →  ${path.relative(cwd, outPath)}`);
      okCount++;
    } catch (e: any) {
      console.error(`  🔴 ${s.slug}  FAILED  ${e?.message ?? e}`);
    }
  }

  console.log(`\n🟢 Shipped ${okCount}/${scenes.length} scenes to ${path.relative(cwd, distDir)}`);
}
