/**
 * CLI Command: export-html
 *
 * Export a scene to HTML + CSS.
 *
 * Usage:
 *   reframe export-html scene.json --out banner.html
 *   reframe export-html scene.json --out banner.html --classes --names
 */

import * as fs from 'fs';
import * as path from 'path';
import { SceneGraph } from '../engine-bridge';
import { exportToHtml } from '../../../core/src/exporters/html';

export function exportHtml(args: any): void {
  const inputFile = args._[1];
  if (!inputFile) {
    throw new Error('Missing input file. Usage: reframe export-html <scene.json> [--out <file>]');
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, 'utf-8');
  const json = JSON.parse(raw);

  const graph = new SceneGraph();
  const page = graph.addPage('Source');
  const rootId = importNode(graph, page.id, json.root ?? json);

  const html = exportToHtml(graph, rootId, {
    fullDocument: true,
    dataAttributes: !!(args.names || args.n),
    cssClasses: !!(args.classes || args.c),
    classPrefix: args.prefix ?? 'rf-',
  });

  const outFile = args.out || args.o;
  if (outFile) {
    const outPath = path.resolve(outFile);
    fs.writeFileSync(outPath, html);
    const root = graph.getNode(rootId)!;
    console.log(`Exported: ${root.name} (${Math.round(root.width)}x${Math.round(root.height)})`);
    console.log(`Written: ${outPath}`);
  } else {
    process.stdout.write(html + '\n');
  }
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
