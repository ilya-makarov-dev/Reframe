/**
 * Block I/O — disk persistence for block definitions.
 *
 * Blocks are stored as .block.json files under .reframe/blocks/{category}/.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';
import type { BlockDefinition, BlockCategory } from './types';
import { registerBlock } from './registry';

// ─── Paths ──────────────────────────────────────────────────

function blocksDir(projectDir: string): string {
  return join(projectDir, 'blocks');
}

function categoryDir(projectDir: string, category: BlockCategory): string {
  return join(blocksDir(projectDir), category);
}

function blockPath(projectDir: string, category: BlockCategory, name: string): string {
  return join(categoryDir(projectDir, category), `${name}.block.json`);
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Save a block definition to disk.
 * @returns The file path written.
 */
export function saveBlock(projectDir: string, def: BlockDefinition): string {
  const dir = categoryDir(projectDir, def.category);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = blockPath(projectDir, def.category, def.name);
  writeFileSync(filePath, JSON.stringify(def, null, 2), 'utf-8');
  return filePath;
}

/**
 * Load a single block from disk.
 */
export function loadBlock(projectDir: string, category: BlockCategory, name: string): BlockDefinition | null {
  const filePath = blockPath(projectDir, category, name);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as BlockDefinition;
  } catch {
    return null;
  }
}

/**
 * Delete a block from disk.
 * @returns true if the file existed and was deleted.
 */
export function deleteBlockFile(projectDir: string, category: BlockCategory, name: string): boolean {
  const filePath = blockPath(projectDir, category, name);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load all blocks from disk into the in-memory registry.
 * Scans .reframe/blocks/{category}/*.block.json.
 * @returns Number of blocks loaded.
 */
export function loadBlocksFromDisk(projectDir: string): number {
  const base = blocksDir(projectDir);
  if (!existsSync(base)) return 0;

  let loaded = 0;
  let dirs: string[];
  try {
    dirs = readdirSync(base);
  } catch {
    return 0;
  }

  for (const catDir of dirs) {
    const catPath = join(base, catDir);
    let files: string[];
    try {
      files = readdirSync(catPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.block.json')) continue;
      const filePath = join(catPath, file);
      try {
        const raw = readFileSync(filePath, 'utf-8');
        const def = JSON.parse(raw) as BlockDefinition;
        registerBlock(def);
        loaded++;
      } catch {
        // Skip malformed files
      }
    }
  }

  return loaded;
}

/**
 * List all block files on disk (without loading into memory).
 */
export function listBlockFiles(projectDir: string): Array<{ category: string; name: string; path: string }> {
  const base = blocksDir(projectDir);
  if (!existsSync(base)) return [];

  const results: Array<{ category: string; name: string; path: string }> = [];
  let dirs: string[];
  try {
    dirs = readdirSync(base);
  } catch {
    return [];
  }

  for (const catDir of dirs) {
    const catPath = join(base, catDir);
    let files: string[];
    try {
      files = readdirSync(catPath);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.block.json')) continue;
      const name = basename(file, '.block.json');
      results.push({ category: catDir, name, path: join(catPath, file) });
    }
  }

  return results;
}
