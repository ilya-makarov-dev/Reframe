/**
 * Tailwind → INode pipeline test.
 * Verifies: Tailwind HTML sections compile through the preprocessor into valid INode trees.
 */

import { importFromHtml } from '../packages/core/src/importers/html';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SECTIONS_DIR = join(process.cwd(), 'packages/core/src/sections');

async function main() {
  const files = readdirSync(SECTIONS_DIR).filter(f => f.endsWith('.html'));
  console.log(`Testing ${files.length} Tailwind sections...\n`);

  let passed = 0;
  let failed = 0;

  for (const file of files) {
    const html = readFileSync(join(SECTIONS_DIR, file), 'utf-8');
    try {
      const result = await importFromHtml(html, { name: file.replace('.html', ''), width: 1440 });
      const root = result.graph.getNode(result.rootId);

      if (result.stats.elements > 0 && root) {
        console.log(`  \x1b[32m✓\x1b[0m ${file} — ${result.stats.elements} nodes, ${result.stats.textNodes} text`);
        passed++;
      } else {
        console.log(`  \x1b[31m✗\x1b[0m ${file} — empty graph`);
        failed++;
      }
    } catch (e: any) {
      console.log(`  \x1b[31m✗\x1b[0m ${file} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${files.length}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
