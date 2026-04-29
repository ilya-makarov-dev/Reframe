/**
 * Inspector helpers — pure functions backing the right-panel UI
 * (Phase 1 UI-3). Lives server-side as TS for two reasons:
 *
 *   1. Multi-select intersection is computed on the API surface (in
 *      /platform/api/node/get-many) and shipped to the JS UI as a
 *      pre-merged shape — keeps the client thin and lets contract
 *      tests exercise the logic without a browser.
 *   2. Type inference and metadata summaries are shared between the
 *      Inspector + the Layers panel + future palette work; one
 *      source of truth beats N copies in JS files.
 *
 * Every export here is pure: same inputs → same outputs, no I/O,
 * no DOM, no global state.
 */

/**
 * Sentinel value placed in shared-prop maps where the underlying
 * nodes disagree. The JS UI renders this as a "Mixed" placeholder
 * the user can click to override across all selected nodes.
 *
 * Symbol-typed via a unique string token (rather than a JS Symbol)
 * because the value must JSON-serialize across the wire to the JS
 * client. No real INode prop value can equal this exact string.
 */
export const MIXED_VALUE = '__reframe_mixed__';

export type PropMap = Record<string, unknown>;

/**
 * Compute the shared-props view across N nodes' prop maps. For every
 * key that appears in ALL nodes:
 *   - if every value is `===` equal → emit that value
 *   - otherwise → emit MIXED_VALUE
 *
 * Keys present in some-but-not-all nodes are dropped (Phase 1 brief:
 * "Props unique to single node → hidden in multi-select view").
 *
 * Equality uses JSON.stringify for object-valued props so deep-equal
 * objects (e.g. identical `effects: [...]`) collapse rather than
 * surfacing as Mixed when they're effectively the same.
 */
export function intersectSharedProps(propMaps: ReadonlyArray<PropMap>): PropMap {
  if (propMaps.length === 0) return {};
  if (propMaps.length === 1) return { ...propMaps[0] };

  // Start from the first map's keys; drop any not present in every
  // subsequent map. Then per surviving key, decide same vs Mixed.
  const out: PropMap = {};
  const firstKeys = Object.keys(propMaps[0]);
  for (const key of firstKeys) {
    let presentInAll = true;
    for (let i = 1; i < propMaps.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(propMaps[i], key)) {
        presentInAll = false;
        break;
      }
    }
    if (!presentInAll) continue;
    const baseline = propMaps[0][key];
    let allSame = true;
    for (let i = 1; i < propMaps.length; i++) {
      if (!valueEquals(baseline, propMaps[i][key])) {
        allSame = false;
        break;
      }
    }
    out[key] = allSame ? baseline : MIXED_VALUE;
  }
  return out;
}

function valueEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  // Cheap deep-equal via JSON. Acceptable because INode prop values
  // are JSON-shaped (no Date / Function / cyclic) — anything that
  // can't be JSON-serialized never reaches a prop map.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Filter prop entries whose keys match the search query. Case-
 * insensitive substring match on the prop key. Intended for the
 * inspector's top "Filter properties..." input — Phase 1 is name-
 * only, no value or regex search.
 *
 * Empty / whitespace-only queries return the input unchanged so
 * the caller can skip the filter without an extra branch.
 */
export function filterPropsByQuery(props: PropMap, query: string): PropMap {
  const q = query.trim().toLowerCase();
  if (!q) return props;
  const out: PropMap = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.toLowerCase().includes(q)) out[key] = value;
  }
  return out;
}

/**
 * Map a (key, value) pair to the control-type the JS UI should
 * render. Keys are CSS-property-style names emitted by
 * `nodeToCssProps` in the platform API.
 *
 * Falls through to 'string' for anything we don't explicitly
 * recognize — UI renders those as plain text inputs and the user
 * can still edit them, just without bespoke ergonomics.
 */
export type ControlType =
  | 'color'
  | 'number'
  | 'range'
  | 'enum'
  | 'boolean'
  | 'string'
  | 'shadow'
  | 'padding'
  | 'borderRadius'
  | 'fills'
  | 'metadata-summary';

const NUMBER_KEYS = new Set([
  'width', 'height', 'x', 'y',
  'gap',
  'font-size', 'font-weight', 'line-height', 'letter-spacing',
  'border-width', 'stroke-weight',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'grid-col-gap', 'grid-row-gap',
]);

const RANGE_KEYS = new Set([
  'opacity', 'background-opacity',
]);

const COLOR_KEYS = new Set([
  'background', 'color', 'border-color',
]);

const ENUM_KEYS: Record<string, ReadonlyArray<string>> = {
  display: ['flex-row', 'flex-col', 'NONE', 'GRID'],
  'justify-content': ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
  'align-items': ['MIN', 'CENTER', 'MAX'],
  'text-align': ['left', 'center', 'right', 'justify'],
  'stroke-align': ['INSIDE', 'OUTSIDE', 'CENTER'],
  'stroke-cap': ['NONE', 'ROUND', 'SQUARE', 'BUTT'],
  'stroke-join': ['MITER', 'ROUND', 'BEVEL'],
};

const BOOLEAN_KEYS = new Set([
  'visible', 'clips-content',
]);

const COMPOSITE_KEYS: Record<string, ControlType> = {
  'border-radius': 'borderRadius',
  effects: 'shadow',
};

const METADATA_KEYS = new Set([
  'annotations', 'interactive', 'entrance', 'hero', 'narrative',
]);

export function inferControlType(key: string, value: unknown): ControlType {
  if (METADATA_KEYS.has(key)) return 'metadata-summary';
  if (key in COMPOSITE_KEYS) return COMPOSITE_KEYS[key];
  if (key === 'fills' || key === 'strokes') return 'fills';
  if (COLOR_KEYS.has(key)) return 'color';
  if (RANGE_KEYS.has(key)) return 'range';
  if (BOOLEAN_KEYS.has(key)) return 'boolean';
  if (key in ENUM_KEYS) return 'enum';
  if (NUMBER_KEYS.has(key)) return 'number';
  if (key.startsWith('padding-')) return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  return 'string';
}

/** Allowed values for an enum control — empty array if not enum. */
export function enumOptions(key: string): ReadonlyArray<string> {
  return ENUM_KEYS[key] ?? [];
}

/**
 * Build a one-line summary of a metadata field (annotations /
 * interactive / entrance / hero / narrative). The Inspector's
 * Metadata section shows these as click-to-drilldown rows; the
 * one-line summary fits in the row before the chevron.
 *
 * Returns null when the metadata field isn't populated — the JS UI
 * uses null as the "skip this row entirely" signal.
 */
export function summarizeMeta(key: string, value: unknown): string | null {
  if (value == null) return null;
  switch (key) {
    case 'annotations': {
      if (!Array.isArray(value)) return null;
      if (value.length === 0) return null;
      return `${value.length} annotation${value.length === 1 ? '' : 's'}`;
    }
    case 'interactive': {
      const v = value as { type?: string };
      if (!v?.type) return null;
      return `Interactive: ${v.type}`;
    }
    case 'entrance': {
      const v = value as { type?: string };
      if (!v?.type) return null;
      return `Entrance: ${v.type}`;
    }
    case 'hero': {
      const v = value as { mode?: string };
      if (!v?.mode) return null;
      return `Hero: ${v.mode}`;
    }
    case 'narrative': {
      const v = value as { kind?: string; frameCount?: number };
      if (!v?.kind) return null;
      const frames = typeof v.frameCount === 'number' ? ` (${v.frameCount} frames)` : '';
      return `Narrative: ${v.kind}${frames}`;
    }
    default: return null;
  }
}

/**
 * Group props into the 7 Inspector sections defined by the brief.
 * Returns a Record<sectionName, PropMap> with empty sections
 * omitted. Section order matches the brief's diagram.
 *
 * Keys not assignable to a known section land in 'Effects' (the
 * catch-all for decoration / effects-adjacent props) so they're
 * still editable rather than silently dropped.
 */
export type InspectorSection =
  | 'Layout'
  | 'Position'
  | 'Size'
  | 'Appearance'
  | 'Typography'
  | 'Effects'
  | 'Metadata';

const SECTION_FOR_KEY: Record<string, InspectorSection> = {
  // Layout
  display: 'Layout',
  gap: 'Layout',
  'justify-content': 'Layout',
  'align-items': 'Layout',
  'padding-top': 'Layout',
  'padding-right': 'Layout',
  'padding-bottom': 'Layout',
  'padding-left': 'Layout',
  'grid-col-gap': 'Layout',
  'grid-row-gap': 'Layout',
  'grid-columns': 'Layout',
  // Position
  x: 'Position',
  y: 'Position',
  // Size
  width: 'Size',
  height: 'Size',
  // Appearance
  background: 'Appearance',
  'background-opacity': 'Appearance',
  color: 'Appearance',
  'border-color': 'Appearance',
  'border-width': 'Appearance',
  'stroke-weight': 'Appearance',
  'stroke-align': 'Appearance',
  'stroke-cap': 'Appearance',
  'stroke-join': 'Appearance',
  fills: 'Appearance',
  visible: 'Appearance',
  'clips-content': 'Appearance',
  'token-bindings': 'Appearance',
  // Typography
  'font-family': 'Typography',
  'font-size': 'Typography',
  'font-weight': 'Typography',
  'line-height': 'Typography',
  'letter-spacing': 'Typography',
  'text-align': 'Typography',
  'text-content': 'Typography',
  // Effects
  'border-radius': 'Effects',
  opacity: 'Effects',
  effects: 'Effects',
  // Metadata
  annotations: 'Metadata',
  interactive: 'Metadata',
  entrance: 'Metadata',
  hero: 'Metadata',
  narrative: 'Metadata',
};

export const SECTION_ORDER: ReadonlyArray<InspectorSection> = [
  'Layout', 'Position', 'Size', 'Appearance', 'Typography', 'Effects', 'Metadata',
];

export function groupPropsBySection(props: PropMap): Record<InspectorSection, PropMap> {
  const out: Record<InspectorSection, PropMap> = {
    Layout: {},
    Position: {},
    Size: {},
    Appearance: {},
    Typography: {},
    Effects: {},
    Metadata: {},
  };
  // Identity / misc keys we don't surface — id, type, name, role
  // are rendered separately in the Inspector header.
  const HIDE = new Set(['id', 'type', 'name', 'role', 'states', 'responsive']);
  for (const [key, value] of Object.entries(props)) {
    if (HIDE.has(key)) continue;
    const section = SECTION_FOR_KEY[key] ?? 'Effects';
    out[section][key] = value;
  }
  return out;
}

/**
 * Determine whether an Inspector section is relevant to a node —
 * Typography is hidden for nodes without typography props, etc.
 * The brief: "Section irrelevant to node type → hidden, не shown empty."
 */
export function sectionIsRelevant(section: InspectorSection, props: PropMap): boolean {
  const grouped = groupPropsBySection(props);
  return Object.keys(grouped[section]).length > 0;
}
