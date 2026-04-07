/**
 * reframe export-svg — export a scene to SVG.
 *
 * Usage:
 *   reframe export-svg scene.json [--out output.svg] [--names] [--bg white]
 */

import * as fs from 'fs';
import type { CliArgs } from '../args';
import { loadScene } from '../scene-io';
import { exportToSvg } from '../../../core/src/exporters/svg';

export function exportSvg(args: CliArgs): void {
  const inputPath = args._[1];
  if (!inputPath) {
    throw new Error('Missing input file. Usage: reframe export-svg <scene.json> [--out output.svg]');
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const scene = loadScene(inputPath);

  const svg = exportToSvg(scene as any, {
    includeNames: args.names === true,
    background: typeof args.bg === 'string' ? args.bg : undefined,
  });

  if (args.out) {
    fs.writeFileSync(args.out, svg, 'utf-8');
    console.log(`SVG saved: ${args.out} (${svg.length} bytes)`);
  } else {
    process.stdout.write(svg);
  }
}
