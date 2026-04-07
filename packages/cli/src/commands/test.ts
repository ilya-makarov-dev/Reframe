/**
 * reframe test — run design assertions on all scenes.
 */

import * as path from 'path';
import { findConfig, loadConfigJson } from '../../../core/src/config/loader.js';
import { testAll, type TestLogger } from '../../../core/src/config/test.js';
import { initYoga } from '../engine-bridge.js';

export async function testCommand(args: string[]) {
  const configPath = args[0] || findConfig(process.cwd());
  if (!configPath) {
    console.error('No reframe.config.json found. Run "reframe init" to create one.');
    process.exit(1);
  }

  const config = loadConfigJson(path.resolve(configPath));
  const configDir = path.dirname(path.resolve(configPath));

  if (!config.assert || config.assert.length === 0) {
    console.log('No assertions defined in config. Add "assert" array to reframe.config.json.');
    process.exit(0);
  }

  await initYoga();

  let currentScene = '';

  const logger: TestLogger = {
    scene(name) {
      if (name !== currentScene) {
        console.log(`\n  ${name}`);
        currentScene = name;
      }
    },
    assertion(scene, size, type, passed, message) {
      const icon = passed ? '\u2713' : '\u2717';
      console.log(`    ${icon} ${size}: ${type} — ${message}`);
    },
    done(output) {
      console.log(`\n  ${output.passed + output.failed} checked, ${output.passed} passed, ${output.failed} failed (${output.totalMs}ms)`);
    },
  };

  const output = await testAll(config, configDir, logger);

  process.exit(output.failed > 0 ? 1 : 0);
}
