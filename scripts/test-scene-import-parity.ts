/**
 * Test runner — scene import parity (HTML → INode round-trip).
 */
import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('── phase1-semantic-import.test.ts (parity)');
execSync(`npx tsx packages/core/src/tests/phase1-semantic-import.test.ts`, {
  cwd: ROOT,
  stdio: 'inherit',
  timeout: 120_000,
});

console.log('Parity test passed.');
