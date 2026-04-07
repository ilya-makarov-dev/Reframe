/**
 * CLI Command: export-png / export-jpeg
 *
 * Export a scene to PNG or JPEG using CanvasKit WASM.
 *
 * Usage:
 *   reframe export-png scene.json --out banner.png
 *   reframe export-png scene.json --out banner.png --scale 2
 *   reframe export-jpeg scene.json --out banner.jpg --quality 85
 */

import * as fs from 'fs';
import * as path from 'path';
import { SceneGraph } from '../engine-bridge';
import { exportToRaster, initCanvasKit } from '../../../core/src/exporters/raster';

interface SceneIO {
  graph: SceneGraph;
  rootId: string;
  name: string;
}

function loadScene(filePath: string): SceneIO {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(raw);

  const graph = new SceneGraph();
  const page = graph.addPage('Source');
  const rootId = importNode(graph, page.id, json.root ?? json);
  const root = graph.getNode(rootId)!;

  return { graph, rootId, name: root.name };
}

function importNode(graph: SceneGraph, parentId: string, data: any): string {
  const overrides: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'type' || key === 'children' || key === 'name') continue;
    overrides[key] = value;
  }

  const node = graph.createNode(data.type ?? 'FRAME', parentId, {
    name: data.name ?? data.type ?? 'Node',
    ...overrides,
  });

  if (data.children) {
    for (const child of data.children) {
      importNode(graph, node.id, child);
    }
  }

  return node.id;
}

export async function exportRaster(args: any, format: 'png' | 'jpeg'): Promise<void> {
  const inputFile = args._[1];
  if (!inputFile) {
    throw new Error(`Missing input file. Usage: reframe export-${format} <scene.json> --out <file>`);
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const outFile = args.out || args.o;
  if (!outFile) {
    throw new Error(`--out is required for ${format} export`);
  }

  const { graph, rootId, name } = loadScene(inputPath);
  const root = graph.getNode(rootId)!;

  await initCanvasKit();

  const scale = parseFloat(args.scale ?? '1');
  const quality = parseInt(args.quality ?? '90', 10);

  const bytes = await exportToRaster(graph, rootId, {
    format,
    scale,
    quality,
    background: args.bg ?? args.background,
  });

  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, bytes);

  const suffix = scale > 1 ? ` @${scale}x` : '';
  console.log(`Exported: ${name} (${Math.round(root.width)}x${Math.round(root.height)})${suffix}`);
  console.log(`Format: ${format.toUpperCase()}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`Written: ${outPath}`);
}
