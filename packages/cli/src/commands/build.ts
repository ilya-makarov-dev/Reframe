/**
 * reframe build — compile all scenes from reframe.config.
 */

import * as path from 'path';
import { findConfig, loadConfigJson } from '../../../core/src/config/loader.js';
import { buildAll, type BuildLogger } from '../../../core/src/config/build.js';
import { initYoga } from '../engine-bridge.js';

const ICONS = { ok: '[OK]', fail: '[!!]', warn: '[!]', scene: '>>' };

export async function buildCommand(args: string[]) {
  const configPath = args[0] || findConfig(process.cwd());
  if (!configPath) {
    console.error('No reframe.config.json found. Run "reframe init" to create one.');
    process.exit(1);
  }

  const config = loadConfigJson(path.resolve(configPath));
  const configDir = path.dirname(path.resolve(configPath));

  await initYoga();

  const logger: BuildLogger = {
    scene(name) {
      console.log(`\n${ICONS.scene} ${name}`);
    },
    size(_scene, size, w, h) {
      process.stdout.write(`  ${size} ${w}×${h} `);
    },
    compiled(_scene, _size, layout) {
      process.stdout.write(`compiled (${layout}) `);
    },
    audited(_scene, _size, passed, fixed, remaining) {
      if (passed) {
        process.stdout.write(`${ICONS.ok} audit passed`);
        if (fixed > 0) process.stdout.write(` (${fixed} auto-fixed)`);
      } else {
        process.stdout.write(`${ICONS.fail} ${remaining} issue(s)`);
      }
    },
    exported(_scene, _size, format, bytes) {
      process.stdout.write(` → ${format} (${bytes}b)`);
    },
    error(scene, size, message) {
      console.error(`\n  ${ICONS.fail} ${scene}/${size}: ${message}`);
    },
    done(output) {
      console.log(`\n\n${output.passed + output.failed} scenes: ${output.passed} passed, ${output.failed} failed (${output.totalMs}ms)`);
      console.log(`Output: ${config.outDir ?? '.reframe/dist/'}`);
    },
  };

  const output = await buildAll(config, configDir, logger);

  process.exit(output.failed > 0 ? 1 : 0);
}
