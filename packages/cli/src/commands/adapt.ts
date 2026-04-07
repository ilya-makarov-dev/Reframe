/**
 * reframe adapt — adapt a design to target sizes.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { CliArgs } from '../args';
import { loadScene, importScene, exportScene, saveScene } from '../scene-io';
import {
  SceneGraph, StandaloneHost, setHost,
  parseTarget, adaptScene,
  type TargetSize,
} from '../engine-bridge';

export async function adapt(args: CliArgs): Promise<void> {
  const inputPath = args._[1];
  if (!inputPath) throw new Error('Missing input file. Usage: reframe adapt <scene.json> --target WxH');

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Parse targets
  const targets: TargetSize[] = [];
  if (args.target) {
    targets.push(parseTarget(args.target));
  }
  if (args.targets) {
    for (const spec of args.targets.split(',')) {
      targets.push(parseTarget(spec.trim()));
    }
  }
  if (targets.length === 0) {
    throw new Error('No targets specified. Use --target WxH or --targets WxH,WxH,...');
  }

  const strategy = args.strategy ?? 'smart';
  const format = args.format ?? 'json';

  // Load scene
  const scene = loadScene(inputPath);
  const graph = new SceneGraph();
  const host = new StandaloneHost(graph);
  setHost(host);

  const page = graph.addPage('Source');
  const rootId = importScene(graph, page.id, scene.root);

  const sourceRoot = graph.getNode(rootId)!;
  console.log(`Loaded: ${sourceRoot.name} (${sourceRoot.width}x${sourceRoot.height})`);
  console.log(`Strategy: ${strategy}`);
  console.log(`Targets: ${targets.map(t => `${t.width}x${t.height}`).join(', ')}`);
  console.log('');

  // Adapt to each target
  const results = [];
  for (const target of targets) {
    const result = adaptScene(graph, rootId, target, strategy);

    const label = target.label ?? `${target.width}x${target.height}`;
    console.log(
      `  ${label}: ${result.stats.nodesProcessed} nodes, ` +
      `scale ${result.stats.scaleX.toFixed(3)}x${result.stats.scaleY.toFixed(3)}, ` +
      `${result.stats.durationMs}ms`
    );

    results.push({ target, result });
  }

  console.log('');

  // Output
  if (targets.length === 1 && args.out) {
    // Single file output
    const { result } = results[0];
    const sceneJson = {
      version: 1,
      root: exportScene(result.graph, result.rootId),
    };
    saveScene(sceneJson, args.out);
    console.log(`Saved: ${args.out}`);
  } else if (args.outDir) {
    // Directory output
    if (!fs.existsSync(args.outDir)) {
      fs.mkdirSync(args.outDir, { recursive: true });
    }

    for (const { target, result } of results) {
      const label = `${target.width}x${target.height}`;
      const outPath = path.join(args.outDir, `${label}.json`);
      const sceneJson = {
        version: 1,
        root: exportScene(result.graph, result.rootId),
      };
      saveScene(sceneJson, outPath);
      console.log(`Saved: ${outPath}`);
    }
  } else if (format === 'summary') {
    // Just print summary
    for (const { target, result } of results) {
      const root = result.graph.getNode(result.rootId)!;
      console.log(`${target.width}x${target.height}:`);
      console.log(`  root: ${root.width}x${root.height}`);
      console.log(`  nodes: ${result.stats.nodesProcessed}`);
      console.log(`  scale: ${result.stats.scaleX.toFixed(4)} x ${result.stats.scaleY.toFixed(4)}`);
    }
  } else {
    // Default: print JSON to stdout
    if (results.length === 1) {
      const { result } = results[0];
      const sceneJson = { version: 1, root: exportScene(result.graph, result.rootId) };
      console.log(JSON.stringify(sceneJson, null, 2));
    } else {
      const all = results.map(({ target, result }) => ({
        target: `${target.width}x${target.height}`,
        scene: { version: 1, root: exportScene(result.graph, result.rootId) },
      }));
      console.log(JSON.stringify(all, null, 2));
    }
  }
}
