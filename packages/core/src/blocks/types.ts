/**
 * Block Library Types
 *
 * A Block is a reusable section template stored as serialized INodeJSON.
 * Blocks have slots (replaceable content) and token bindings (brandable).
 */

import type { INodeJSON } from '../serialize';

// ─── Categories ─────────────────────────────────────────────

export type BlockCategory =
  | 'hero'
  | 'features'
  | 'pricing'
  | 'testimonials'
  | 'cta'
  | 'stats'
  | 'team'
  | 'faq'
  | 'footer'
  | 'nav'
  | 'contact'
  | 'content'
  | 'gallery';

export const ALL_BLOCK_CATEGORIES: BlockCategory[] = [
  'hero', 'features', 'pricing', 'testimonials', 'cta', 'stats',
  'team', 'faq', 'footer', 'nav', 'contact', 'content', 'gallery',
];

// ─── Slot ───────────────────────────────────────────────────

export type SlotType = 'text' | 'node' | 'fill' | 'image';

export interface BlockSlot {
  /** Slot name matching node.slot or node.name in the tree. e.g. "headline" */
  name: string;
  /** Semantic role of this slot. */
  role: string;
  /** What kind of content this slot accepts. */
  type: SlotType;
  /** Fallback content if no value provided. */
  defaultValue?: string;
}

// ─── Block Definition ───────────────────────────────────────

export interface BlockDefinition {
  /** Schema version for migration. */
  version: 1;
  /** Section category. */
  category: BlockCategory;
  /** Unique slug: "hero-centered", "pricing-3col". */
  name: string;
  /** Human description. */
  description: string;
  /** Search tags. */
  tags?: string[];
  /** Content slots that can be replaced on instantiation. */
  slots: BlockSlot[];
  /** Default token bindings: dot-path to node property → token name. */
  defaultTokenBindings?: Record<string, string>;
  /** Serialized INode tree (format version 2). */
  tree: INodeJSON;
  /** Optional responsive overrides. */
  responsive?: Array<{ maxWidth: number; tree: INodeJSON }>;
}

// ─── Block Instance Params ──────────────────────────────────

export interface BlockInstantiateParams {
  /** Block name to instantiate. */
  name: string;
  /** Slot values: slot name → content string or INodeJSON subtree. */
  slots?: Record<string, string | INodeJSON>;
  /** Brand slug to apply after instantiation. */
  brand?: string;
}
