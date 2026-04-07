#!/usr/bin/env node
/**
 * Reframe CLI — Programmable Design Engine
 *
 * Primary workflow:
 *   reframe init                    Create reframe.config.json + design.md
 *   reframe build                   Compile all scenes → .reframe/dist/
 *   reframe test                    Run design assertions on all scenes
 *
 * Legacy commands still supported for direct file operations.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from './args';
import { buildCommand } from './commands/build';
import { testCommand } from './commands/test';
import { initCommand } from './commands/init';
import { adapt } from './commands/adapt';
import { inspect } from './commands/inspect';
import { info } from './commands/info';
import { figma } from './commands/figma';
import { exportSvg } from './commands/export-svg';
import { importSvgCommand } from './commands/import-svg';
import { exportRaster } from './commands/export-raster';
import { exportHtml } from './commands/export-html';
import { initYoga } from './engine-bridge';

const HELP = `
  reframe — Programmable Design Engine

  BUILD SYSTEM:
    init                Scaffold reframe.config.json + design.md
    build [config]      Compile all scenes from config → .reframe/dist/
    test  [config]      Run design assertions on all scenes

  LEGACY COMMANDS:
    adapt <input>       Adapt a design to target sizes
    inspect <input>     Inspect a scene file (node tree, stats)
    info                Show engine info and capabilities
    figma <file-key>    Import a Figma file to reframe scene format
    import-svg <input>  Import an SVG file to reframe scene format
    export-svg <input>  Export a scene to SVG
    export-png <input>  Export a scene to PNG (CanvasKit WASM)
    export-html <input> Export a scene to HTML + CSS

  OPTIONS (adapt):
    --target <WxH>          Single target size (e.g. 1080x1920)
    --targets <WxH,WxH,...> Multiple targets, comma-separated
    --out <file>            Output file (single target)
    --out-dir <dir>         Output directory (multiple targets)
    --strategy <name>       Strategy: smart|contain|cover|stretch|constraints
    --format <fmt>          Output format: json|summary
    --verbose               Show detailed progress

  OPTIONS (figma):
    --token <token>         Figma API token (or set FIGMA_TOKEN env var)
    --node-ids <id,id,...>  Import specific node IDs
    --out <file>            Output file
    --include-hidden        Include invisible nodes

  OPTIONS (export-svg):
    --out <file>            Output SVG file (default: stdout)
    --names                 Include node names as data attributes
    --bg <color>            Background color (e.g. white, #f0f0f0)

  EXAMPLES:
    reframe adapt banner.json --target 1080x1920
    reframe adapt banner.json --targets 728x90,300x250 --strategy constraints
    reframe figma abc123XYZ --token figd_... --out scene.json
    reframe export-svg scene.json --out banner.svg
    reframe adapt scene.json --target 300x250 | reframe export-svg --out ad.svg
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args._.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args._[0];

  // Initialize Yoga WASM layout engine
  await initYoga();

  try {
    switch (command) {
      case 'init':
        await initCommand(args._.slice(1));
        break;
      case 'build':
        await buildCommand(args._.slice(1));
        break;
      case 'test':
        await testCommand(args._.slice(1));
        break;
      case 'adapt':
        await adapt(args);
        break;
      case 'inspect':
        inspect(args);
        break;
      case 'info':
        info();
        break;
      case 'figma':
        await figma(args);
        break;
      case 'import-svg':
        await importSvgCommand(args);
        break;
      case 'export-svg':
        exportSvg(args);
        break;
      case 'export-png':
        await exportRaster(args, 'png');
        break;
      case 'export-jpeg':
      case 'export-jpg':
        await exportRaster(args, 'jpeg');
        break;
      case 'export-html':
        exportHtml(args);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    if (args.verbose) console.error(err.stack);
    process.exit(1);
  }
}

main();
