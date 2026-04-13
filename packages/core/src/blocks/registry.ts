/**
 * Block Registry — in-memory block catalog.
 *
 * Stores BlockDefinitions keyed by name. Supports filtering by
 * category and keyword search across name/description/tags.
 */

import type { BlockDefinition, BlockCategory } from './types';

// ─── State ──────────────────────────────────────────────────

const blocks = new Map<string, BlockDefinition>();

// ─── Public API ─────────────────────────────────────────────

/** Register a block definition. Overwrites if name already exists. */
export function registerBlock(def: BlockDefinition): void {
  blocks.set(def.name, def);
}

/** Get a block by its unique name. */
export function getBlock(name: string): BlockDefinition | undefined {
  return blocks.get(name);
}

/** Remove a block by name. Returns true if it existed. */
export function removeBlock(name: string): boolean {
  return blocks.delete(name);
}

/** List all blocks, optionally filtered by category. */
export function listBlocks(category?: BlockCategory): BlockDefinition[] {
  const all = [...blocks.values()];
  if (!category) return all;
  return all.filter(b => b.category === category);
}

/** Search blocks by keyword across name, description, and tags. */
export function searchBlocks(query: string): BlockDefinition[] {
  const q = query.toLowerCase();
  return [...blocks.values()].filter(b => {
    if (b.name.toLowerCase().includes(q)) return true;
    if (b.description.toLowerCase().includes(q)) return true;
    if (b.tags?.some(t => t.toLowerCase().includes(q))) return true;
    return false;
  });
}

/** Get all registered block names. */
export function listBlockNames(): string[] {
  return [...blocks.keys()];
}

/** Get count of registered blocks. */
export function blockCount(): number {
  return blocks.size;
}

/** Clear all blocks from the registry. */
export function clearBlocks(): void {
  blocks.clear();
}
