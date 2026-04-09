/**
 * reframe inspect — inspect a scene file.
 */

import type { CliArgs } from '../args';
import { loadScene, graphFromSceneEnvelope } from '../scene-io';

export function inspect(args: CliArgs): void {
  const inputPath = args._[1];
  if (!inputPath) throw new Error('Missing input file. Usage: reframe inspect <scene.json>');

  const scene = loadScene(inputPath);
  const { graph, rootId } = graphFromSceneEnvelope(scene);

  const root = graph.getNode(rootId)!;

  console.log(`Scene: ${root.name}`);
  console.log(`Size: ${root.width} x ${root.height}`);
  console.log(`Aspect: ${(root.width / root.height).toFixed(4)}`);
  console.log('');

  // Stats
  const stats = {
    total: 0,
    byType: {} as Record<string, number>,
    maxDepth: 0,
    textNodes: 0,
    imageNodes: 0,
    autoLayoutFrames: 0,
  };

  function walk(nodeId: string, depth: number): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    stats.total++;
    stats.byType[node.type] = (stats.byType[node.type] ?? 0) + 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (node.type === 'TEXT') stats.textNodes++;
    if (node.fills?.some((f: any) => f.type === 'IMAGE')) stats.imageNodes++;
    if (node.layoutMode !== 'NONE') stats.autoLayoutFrames++;

    for (const childId of node.childIds) {
      walk(childId, depth + 1);
    }
  }

  walk(rootId, 0);

  console.log(`Nodes: ${stats.total}`);
  console.log(`Max depth: ${stats.maxDepth}`);
  console.log(`Text nodes: ${stats.textNodes}`);
  console.log(`Image nodes: ${stats.imageNodes}`);
  console.log(`Auto-layout frames: ${stats.autoLayoutFrames}`);
  console.log('');

  console.log('Node types:');
  for (const [type, count] of Object.entries(stats.byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log('');

  // Tree view
  console.log('Tree:');
  function printTree(nodeId: string, indent: string, isLast: boolean): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const prefix = indent + (isLast ? '└── ' : '├── ');
    const sizeStr = `${node.width}x${node.height}`;
    const posStr = `@(${Math.round(node.x)},${Math.round(node.y)})`;
    const extra = node.type === 'TEXT' ? ` "${node.text?.slice(0, 30)}${(node.text?.length ?? 0) > 30 ? '...' : ''}"` : '';

    console.log(`${prefix}[${node.type}] ${node.name} ${sizeStr} ${posStr}${extra}`);

    const children = node.childIds;
    const nextIndent = indent + (isLast ? '    ' : '│   ');
    for (let i = 0; i < children.length; i++) {
      printTree(children[i], nextIndent, i === children.length - 1);
    }
  }

  printTree(rootId, '', true);
}
