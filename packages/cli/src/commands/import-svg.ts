/**
 * CLI Command: import-svg
 *
 * Import an SVG file into reframe scene format.
 *
 * Usage:
 *   reframe import-svg input.svg --out scene.json
 *   reframe import-svg input.svg  (outputs to stdout)
 */

import * as fs from 'fs';
import * as path from 'path';
import { importFromSvg } from '../engine-bridge';

export async function importSvgCommand(args: any): Promise<void> {
  const inputFile = args._[1];
  if (!inputFile) {
    throw new Error('Missing input SVG file. Usage: reframe import-svg <file.svg>');
  }

  const inputPath = path.resolve(inputFile);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  const svgMarkup = fs.readFileSync(inputPath, 'utf-8');
  const name = path.basename(inputFile, path.extname(inputFile));

  const result = await importFromSvg(svgMarkup, { name });

  // Export scene to JSON
  const { graph, rootId } = result;
  const root = graph.getNode(rootId)!;
  const sceneJson = {
    version: '0.2.0',
    root: exportNode(graph, rootId),
  };

  const output = JSON.stringify(sceneJson, null, 2);
  const outFile = args.out || args.o;

  if (outFile) {
    const outPath = path.resolve(outFile);
    fs.writeFileSync(outPath, output);
    console.log(`Imported: ${name} (${Math.round(root.width)}x${Math.round(root.height)})`);
    console.log(`Elements: ${result.stats.elements}`);
    if (result.stats.unsupported.length > 0) {
      console.log(`Unsupported: ${result.stats.unsupported.join(', ')}`);
    }
    console.log(`Written: ${outPath}`);
  } else {
    process.stdout.write(output + '\n');
  }
}

function exportNode(graph: any, nodeId: string): any {
  const node = graph.getNode(nodeId);
  if (!node) return null;

  const result: any = {
    type: node.type,
    name: node.name,
    x: node.x, y: node.y,
    width: node.width, height: node.height,
  };

  if (node.rotation !== 0) result.rotation = node.rotation;
  if (!node.visible) result.visible = false;
  if (node.opacity !== 1) result.opacity = node.opacity;
  if (node.fills?.length > 0) result.fills = node.fills;
  if (node.strokes?.length > 0) result.strokes = node.strokes;
  if (node.effects?.length > 0) result.effects = node.effects;
  if (node.cornerRadius) result.cornerRadius = node.cornerRadius;
  if (node.clipsContent) result.clipsContent = true;
  if (node.type === 'TEXT') {
    result.text = node.text;
    result.fontSize = node.fontSize;
    result.fontFamily = node.fontFamily;
    result.fontWeight = node.fontWeight;
  }

  const children = node.childIds
    .map((id: string) => exportNode(graph, id))
    .filter(Boolean);
  if (children.length > 0) result.children = children;

  return result;
}
