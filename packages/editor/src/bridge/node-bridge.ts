/**
 * Node Bridge — Field mapping between OpenPencil SceneNode and reframe SceneNode.
 *
 * Both share ~85% of fields identically. This module handles the differences:
 * - GridTrack: OP uses { sizing, value }, reframe uses { type, value }
 * - Reframe-only fields: semanticRole, states, responsive, meta, fontFeatureSettings, etc.
 * - OP-only fields: pluginData, sharedPluginData, layoutDirection, textDirection
 */

import type {
  SceneNode as OPSceneNode,
  GridTrack as OPGridTrack,
} from '@open-pencil/core';

import type { SceneNode as RFSceneNode } from '@reframe/core';

// ─── Reframe Extension Fields ─────────────────────────────────
// Fields that exist on reframe SceneNode but NOT on OpenPencil SceneNode.
// Stored in a side-channel Map<nodeId, ReframeExtension> alongside the OP graph.

export interface ReframeExtension {
  semanticRole?: RFSceneNode['semanticRole'];
  slot?: string | null;
  href?: string | null;
  contentSlots?: RFSceneNode['contentSlots'];
  states?: RFSceneNode['states'];
  responsive?: RFSceneNode['responsive'];
  variantProperties?: Record<string, string>;
  componentPropertyDefinitions?: RFSceneNode['componentPropertyDefinitions'];
  isDefaultVariant?: boolean;
  meta?: RFSceneNode['meta'];
  fontFeatureSettings?: string[];
}

// ─── GridTrack Conversion ─────────────────────────────────────

/** OP GridTrack { sizing, value } → reframe GridTrack { type, value } */
export function opGridTrackToReframe(track: OPGridTrack): { type: 'FIXED' | 'FR' | 'AUTO'; value: number } {
  return { type: track.sizing as 'FIXED' | 'FR' | 'AUTO', value: track.value };
}

/** reframe GridTrack { type, value } → OP GridTrack { sizing, value } */
export function reframeGridTrackToOP(track: { type: string; value: number }): OPGridTrack {
  return { sizing: track.type as 'FIXED' | 'FR' | 'AUTO', value: track.value };
}

// ─── Extension Extraction ─────────────────────────────────────

/** Extract reframe-only fields from a reframe SceneNode into an extension. */
export function extractExtension(rfNode: RFSceneNode): ReframeExtension {
  const ext: ReframeExtension = {};

  if (rfNode.semanticRole != null) ext.semanticRole = rfNode.semanticRole;
  if (rfNode.slot != null) ext.slot = rfNode.slot;
  if (rfNode.href != null) ext.href = rfNode.href;
  if (rfNode.contentSlots?.length) ext.contentSlots = rfNode.contentSlots;
  if (rfNode.states && Object.keys(rfNode.states).length > 0) ext.states = rfNode.states;
  if (rfNode.responsive?.length) ext.responsive = rfNode.responsive;
  if (rfNode.variantProperties && Object.keys(rfNode.variantProperties).length > 0) {
    ext.variantProperties = rfNode.variantProperties;
  }
  if (rfNode.componentPropertyDefinitions) ext.componentPropertyDefinitions = rfNode.componentPropertyDefinitions;
  if (rfNode.isDefaultVariant) ext.isDefaultVariant = true;
  if (rfNode.meta && Object.keys(rfNode.meta).length > 0) ext.meta = rfNode.meta;
  if (rfNode.fontFeatureSettings?.length) ext.fontFeatureSettings = rfNode.fontFeatureSettings;

  return ext;
}

/** Merge extension back onto a reframe SceneNode. */
export function applyExtension(rfNode: any, ext: ReframeExtension): void {
  if (ext.semanticRole !== undefined) rfNode.semanticRole = ext.semanticRole;
  if (ext.slot !== undefined) rfNode.slot = ext.slot;
  if (ext.href !== undefined) rfNode.href = ext.href;
  if (ext.contentSlots) rfNode.contentSlots = ext.contentSlots;
  if (ext.states) rfNode.states = ext.states;
  if (ext.responsive) rfNode.responsive = ext.responsive;
  if (ext.variantProperties) rfNode.variantProperties = ext.variantProperties;
  if (ext.componentPropertyDefinitions) rfNode.componentPropertyDefinitions = ext.componentPropertyDefinitions;
  if (ext.isDefaultVariant) rfNode.isDefaultVariant = ext.isDefaultVariant;
  if (ext.meta) rfNode.meta = ext.meta;
  if (ext.fontFeatureSettings) rfNode.fontFeatureSettings = ext.fontFeatureSettings;
}

/** Check if an extension has any non-empty data. */
export function isExtensionEmpty(ext: ReframeExtension): boolean {
  return Object.keys(ext).every(k => {
    const val = (ext as any)[k];
    if (val == null) return true;
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === 'object') return Object.keys(val).length === 0;
    return false;
  });
}
