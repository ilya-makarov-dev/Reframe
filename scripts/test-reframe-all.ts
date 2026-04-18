/**
 * Test runner — MCP platform HTTP tests.
 */
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tests = [
  'packages/mcp/src/tests/phase7-platform-http.test.ts',
];

for (const t of tests) {
  console.log(`── ${path.basename(t)}`);
  execSync(`npx tsx ${t}`, { cwd: ROOT, stdio: 'inherit', timeout: 120_000 });
}

console.log('All MCP tests passed.');
