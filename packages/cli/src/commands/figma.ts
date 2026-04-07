/**
 * reframe figma — import a Figma file into reframe scene format.
 *
 * Usage:
 *   reframe figma <file-key> --token <token> [--out scene.json] [--node-ids 1:2,3:4]
 */

import * as fs from 'fs';
import type { CliArgs } from '../args';
import { importFromFigma } from '../../../core/src/importers/figma-rest';

export async function figma(args: CliArgs): Promise<void> {
  const fileKey = args._[1];
  if (!fileKey) {
    throw new Error(
      'Missing Figma file key.\n' +
      'Usage: reframe figma <file-key> --token <token>\n' +
      'File key is the part after /file/ in the Figma URL.'
    );
  }

  const token = args.token || process.env.FIGMA_TOKEN;
  if (!token) {
    throw new Error(
      'Missing Figma API token.\n' +
      'Provide via --token <token> or FIGMA_TOKEN environment variable.\n' +
      'Get a token at: https://www.figma.com/developers/api#access-tokens'
    );
  }

  const nodeIds = args['node-ids']
    ? args['node-ids'].split(',').map((id: string) => id.trim())
    : undefined;

  console.log(`Fetching Figma file: ${fileKey}...`);

  const result = await importFromFigma(fileKey, {
    token,
    nodeIds,
    includeHidden: args['include-hidden'] === true,
  });

  console.log(`Imported: ${result.meta.name}`);
  console.log(`  Version: ${result.meta.version}`);
  console.log(`  Nodes: ${result.meta.nodeCount}`);
  console.log(`  Last modified: ${result.meta.lastModified}`);

  const json = JSON.stringify(result.scene, null, 2);

  if (args.out) {
    fs.writeFileSync(args.out, json, 'utf-8');
    console.log(`\nSaved: ${args.out}`);
  } else {
    console.log('');
    console.log(json);
  }
}
