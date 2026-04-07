/**
 * Config loader — finds and parses reframe.config.ts/js/json.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ReframeConfig } from './types.js';

const CONFIG_NAMES = [
  'reframe.config.ts',
  'reframe.config.js',
  'reframe.config.json',
];

/** Find config file in directory, walking up to root. */
export function findConfig(startDir: string): string | null {
  let dir = path.resolve(startDir);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const fp = path.join(dir, name);
      if (fs.existsSync(fp)) return fp;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load config from a JSON file. For .ts/.js, caller must handle transpilation. */
export function loadConfigJson(filePath: string): ReframeConfig {
  const raw = fs.readFileSync(filePath, 'utf8');
  const config = JSON.parse(raw) as ReframeConfig;
  return validateConfig(config, path.dirname(filePath));
}

/** Load DESIGN.md content — from inline or file path. */
export function resolveDesignMd(config: ReframeConfig, configDir: string): string {
  if (config.designMd) return config.designMd;
  if (config.design) {
    const fp = path.resolve(configDir, config.design);
    if (!fs.existsSync(fp)) throw new Error(`DESIGN.md not found: ${fp}`);
    return fs.readFileSync(fp, 'utf8');
  }
  // Try default locations
  for (const name of ['design.md', 'DESIGN.md', '.reframe/design.md']) {
    const fp = path.resolve(configDir, name);
    if (fs.existsSync(fp)) return fs.readFileSync(fp, 'utf8');
  }
  throw new Error('No DESIGN.md found. Set "design" path in config or create design.md in project root.');
}

/** Validate and normalize config. */
function validateConfig(config: ReframeConfig, configDir: string): ReframeConfig {
  if (!config.sizes || Object.keys(config.sizes).length === 0) {
    throw new Error('Config must define at least one size in "sizes".');
  }
  if (!config.scenes || Object.keys(config.scenes).length === 0) {
    throw new Error('Config must define at least one scene in "scenes".');
  }

  // Validate scene size references
  for (const [sceneName, scene] of Object.entries(config.scenes)) {
    if (scene.sizes !== 'all') {
      for (const sizeName of scene.sizes) {
        if (!config.sizes[sizeName]) {
          throw new Error(`Scene "${sceneName}" references unknown size "${sizeName}". Available: ${Object.keys(config.sizes).join(', ')}`);
        }
      }
    }
  }

  // Defaults
  config.exports = config.exports ?? ['html'];
  config.outDir = config.outDir ?? '.reframe/dist';
  config.assert = config.assert ?? [];

  return config;
}

/** Resolve which sizes a scene should be compiled to. */
export function resolveSceneSizes(
  scene: ReframeConfig['scenes'][string],
  allSizes: ReframeConfig['sizes'],
): Array<{ name: string; width: number; height: number; layout?: string }> {
  const sizeNames = scene.sizes === 'all' ? Object.keys(allSizes) : scene.sizes;
  return sizeNames.map(name => ({
    name,
    width: allSizes[name].width,
    height: allSizes[name].height,
    layout: allSizes[name].layout ?? scene.layout,
  }));
}
