/**
 * DTCG Token Format — W3C Design Tokens Community Group (2025.10)
 *
 * Provides bidirectional conversion between reframe's SceneGraph
 * Variable system and the W3C DTCG JSON format (.tokens.json).
 *
 * Enables interop with:
 *   - Tokens Studio for Figma
 *   - Style Dictionary v4
 *   - Specify SDTF
 *   - Any tool supporting application/design-tokens+json
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { Variable, VariableValue, VariableCollection, Color } from '../engine/types';
import type { DesignSystem } from './types';
import { TOKEN_COLLECTION_NAME, MODE_LIGHT, MODE_DARK, colorToHex, hexToColor } from './tokens';
import type { TokenIndex } from './tokens';

// ─── DTCG Types (W3C 2025.10 stable spec) ──────────────────

/**
 * A single design token as specified by the DTCG format.
 * @see https://www.w3.org/community/design-tokens/
 */
export interface DTCGToken {
  $value: unknown;
  $type: string;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

/**
 * A group of tokens. Groups can nest recursively.
 * Keys starting with '$' are metadata, others are children.
 */
export interface DTCGGroup {
  $description?: string;
  $type?: string;
  [key: string]: DTCGToken | DTCGGroup | string | undefined;
}

/** Root-level DTCG file. */
export type DTCGFile = DTCGGroup;

// ─── Type Mappings ──────────────────────────────────────────

const VARIABLE_TYPE_TO_DTCG: Record<string, string> = {
  COLOR: 'color',
  FLOAT: 'number',
  STRING: 'string',
  BOOLEAN: 'string',  // DTCG has no boolean type; encode as string
};

const DTCG_TYPE_TO_VARIABLE: Record<string, string> = {
  color: 'COLOR',
  number: 'FLOAT',
  dimension: 'FLOAT',
  fontFamily: 'STRING',
  fontWeight: 'FLOAT',
  string: 'STRING',
  boolean: 'STRING',
};

// ─── Internal helpers ───────────────────────────────────────

/** Infer DTCG $type from token name convention. */
function inferDTCGTypeFromName(name: string, variableType: string): string {
  if (variableType === 'COLOR') return 'color';
  if (name.startsWith('type.') && name.endsWith('.family')) return 'fontFamily';
  if (name.startsWith('type.') && name.endsWith('.weight')) return 'fontWeight';
  if (name.startsWith('type.') && (name.endsWith('.size') || name.endsWith('.lineHeight') || name.endsWith('.letterSpacing'))) return 'dimension';
  if (name.startsWith('space.') || name.startsWith('radius.')) return 'dimension';
  return VARIABLE_TYPE_TO_DTCG[variableType] ?? 'string';
}

/** Convert a VariableValue to a DTCG-compatible JSON value. */
function variableValueToDTCG(value: VariableValue, variableType: string): unknown {
  if (variableType === 'COLOR' && typeof value === 'object' && value !== null && 'r' in value) {
    return colorToHex(value as Color);
  }
  if (typeof value === 'object' && value !== null && 'aliasId' in value) {
    // Alias reference — DTCG uses `{path.to.token}` syntax
    return `{${(value as { aliasId: string }).aliasId}}`;
  }
  return value;
}

/** Parse a DTCG $value back to a VariableValue. */
function dtcgValueToVariable(value: unknown, dtcgType: string): VariableValue {
  if (dtcgType === 'color' && typeof value === 'string') {
    return hexToColor(value);
  }
  if ((dtcgType === 'number' || dtcgType === 'dimension' || dtcgType === 'fontWeight') && typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    // Check for alias reference: {path.to.token}
    const aliasMatch = value.match(/^\{(.+)\}$/);
    if (aliasMatch) {
      return { aliasId: aliasMatch[1] };
    }
    return value;
  }
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

/** Set a nested value in an object using a dot-separated path. */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/** Recursively walk a DTCG tree and collect all tokens with their dot-paths. */
function flattenDTCG(
  node: DTCGGroup,
  parentPath: string[],
  parentType: string | undefined,
  result: Array<{ path: string; token: DTCGToken }>,
): void {
  const groupType = node.$type ?? parentType;
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;  // metadata keys
    if (val === undefined || val === null) continue;
    if (typeof val !== 'object') continue;
    const child = val as Record<string, unknown>;
    if ('$value' in child) {
      // This is a token
      const token = child as unknown as DTCGToken;
      if (!token.$type && groupType) token.$type = groupType;
      result.push({ path: [...parentPath, key].join('.'), token });
    } else {
      // This is a group — recurse
      flattenDTCG(child as DTCGGroup, [...parentPath, key], groupType, result);
    }
  }
}

// ─── Export: SceneGraph → DTCG ──────────────────────────────

/**
 * Export SceneGraph Variables to W3C DTCG JSON format.
 *
 * @param graph - SceneGraph containing Variables and VariableCollections
 * @param collectionId - Optional specific collection to export. If omitted, exports
 *                       the first 'design-tokens' collection found.
 * @returns DTCGFile ready to serialize as .tokens.json
 */
export function exportToDTCG(graph: SceneGraph, collectionId?: string): DTCGFile {
  // Find the target collection
  let collection: VariableCollection | undefined;
  if (collectionId) {
    collection = graph.variableCollections.get(collectionId);
  } else {
    for (const col of graph.variableCollections.values()) {
      if (col.name === TOKEN_COLLECTION_NAME) {
        collection = col;
        break;
      }
    }
    // Fallback: first collection
    if (!collection) {
      collection = graph.variableCollections.values().next().value as VariableCollection | undefined;
    }
  }

  if (!collection) return {};

  const result: DTCGFile = {};
  const lightMode = collection.modes.find(m => m.name === MODE_LIGHT) ?? collection.modes[0];
  const darkMode = collection.modes.find(m => m.name === MODE_DARK);

  for (const variable of graph.variables.values()) {
    if (variable.collectionId !== collection.id) continue;

    const dtcgType = inferDTCGTypeFromName(variable.name, variable.type);
    const lightValue = lightMode ? variable.valuesByMode[lightMode.modeId] : undefined;
    const darkValue = darkMode ? variable.valuesByMode[darkMode.modeId] : undefined;

    const token: DTCGToken = {
      $value: variableValueToDTCG(lightValue ?? Object.values(variable.valuesByMode)[0], variable.type),
      $type: dtcgType,
    };

    if (variable.description) {
      token.$description = variable.description;
    }

    // Multi-mode support via extensions
    if (darkValue !== undefined && darkMode) {
      const darkConverted = variableValueToDTCG(darkValue, variable.type);
      const lightConverted = token.$value;
      // Only add extensions if dark differs from light
      if (JSON.stringify(darkConverted) !== JSON.stringify(lightConverted)) {
        token.$extensions = {
          'com.reframe.modes': {
            [MODE_LIGHT]: lightConverted,
            [MODE_DARK]: darkConverted,
          },
        };
      }
    }

    // Build nested path: color.primary → { color: { primary: token } }
    const pathParts = variable.name.split('.');
    setNestedValue(result as Record<string, unknown>, pathParts, token);
  }

  return result;
}

// ─── Import: DTCG → SceneGraph ──────────────────────────────

export interface DTCGImportOptions {
  /** Collection name to use. Default: 'design-tokens'. */
  collectionName?: string;
  /** If true, create both light and dark modes from extensions. Default: true. */
  importModes?: boolean;
}

/**
 * Import DTCG JSON tokens into a SceneGraph as Variables.
 *
 * @param graph - Target SceneGraph
 * @param dtcg - DTCG JSON to import
 * @param options - Import options
 * @returns TokenIndex for the imported collection
 */
export function importFromDTCG(
  graph: SceneGraph,
  dtcg: DTCGFile,
  options: DTCGImportOptions = {},
): TokenIndex {
  const collectionName = options.collectionName ?? TOKEN_COLLECTION_NAME;
  const importModes = options.importModes ?? true;

  // Check for mode data in any token
  let hasDarkMode = false;
  const flatTokens: Array<{ path: string; token: DTCGToken }> = [];
  flattenDTCG(dtcg, [], undefined, flatTokens);

  if (importModes) {
    for (const { token } of flatTokens) {
      const modes = (token.$extensions as Record<string, unknown>)?.['com.reframe.modes'] as Record<string, unknown> | undefined;
      if (modes && MODE_DARK in modes) {
        hasDarkMode = true;
        break;
      }
    }
  }

  // Create or find collection
  let collection: VariableCollection | undefined;
  for (const col of graph.variableCollections.values()) {
    if (col.name === collectionName) {
      collection = col;
      break;
    }
  }

  const lightModeId = `mode-light-${Date.now()}`;
  const darkModeId = hasDarkMode ? `mode-dark-${Date.now()}` : undefined;

  if (!collection) {
    const modes = [{ modeId: lightModeId, name: MODE_LIGHT }];
    if (darkModeId) modes.push({ modeId: darkModeId, name: MODE_DARK });

    collection = {
      id: `col-${Date.now()}`,
      name: collectionName,
      modes,
      defaultModeId: lightModeId,
      variableIds: [],
    };
    graph.variableCollections.set(collection.id, collection);
  }

  const existingLightMode = collection.modes.find(m => m.name === MODE_LIGHT);
  const existingDarkMode = collection.modes.find(m => m.name === MODE_DARK);
  const effectiveLightModeId = existingLightMode?.modeId ?? lightModeId;
  const effectiveDarkModeId = existingDarkMode?.modeId ?? darkModeId;

  if (!existingLightMode) {
    collection.modes.push({ modeId: effectiveLightModeId, name: MODE_LIGHT });
  }
  if (hasDarkMode && !existingDarkMode && effectiveDarkModeId) {
    collection.modes.push({ modeId: effectiveDarkModeId, name: MODE_DARK });
  }

  // Create Variables from flattened tokens
  const tokenMap = new Map<string, string>();

  for (const { path, token } of flatTokens) {
    const dtcgType = token.$type ?? 'string';
    const variableType = (DTCG_TYPE_TO_VARIABLE[dtcgType] ?? 'STRING') as 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

    const valuesByMode: Record<string, VariableValue> = {};

    // Light mode value
    const modes = (token.$extensions as Record<string, unknown>)?.['com.reframe.modes'] as Record<string, unknown> | undefined;
    if (modes && MODE_LIGHT in modes) {
      valuesByMode[effectiveLightModeId] = dtcgValueToVariable(modes[MODE_LIGHT], dtcgType);
    } else {
      valuesByMode[effectiveLightModeId] = dtcgValueToVariable(token.$value, dtcgType);
    }

    // Dark mode value
    if (effectiveDarkModeId && modes && MODE_DARK in modes) {
      valuesByMode[effectiveDarkModeId] = dtcgValueToVariable(modes[MODE_DARK], dtcgType);
    } else if (effectiveDarkModeId) {
      // Copy light value as fallback
      valuesByMode[effectiveDarkModeId] = valuesByMode[effectiveLightModeId];
    }

    const varId = `var-${path.replace(/\./g, '-')}-${Date.now()}`;
    const variable: Variable = {
      id: varId,
      name: path,
      type: variableType,
      collectionId: collection.id,
      valuesByMode,
      description: token.$description ?? '',
      hiddenFromPublishing: false,
    };

    graph.variables.set(varId, variable);
    collection.variableIds.push(varId);
    tokenMap.set(path, varId);
  }

  return {
    collectionId: collection.id,
    tokens: tokenMap,
    modeIds: { light: effectiveLightModeId, dark: effectiveDarkModeId },
  };
}

// ─── Convenience: DesignSystem ↔ DTCG ───────────────────────

/**
 * Convert a parsed DesignSystem directly to DTCG JSON
 * without going through SceneGraph Variables.
 */
export function designSystemToDTCG(ds: DesignSystem): DTCGFile {
  const result: DTCGFile = {};

  // Colors
  if (ds.colors?.roles) {
    const colorGroup: DTCGGroup = {};
    for (const [role, hex] of ds.colors.roles.entries()) {
      colorGroup[role] = { $value: hex, $type: 'color' } satisfies DTCGToken;
    }
    result.color = colorGroup;
  }

  // Typography
  if (ds.typography?.hierarchy) {
    const typeGroup: DTCGGroup = {};
    for (const rule of ds.typography.hierarchy) {
      const roleGroup: DTCGGroup = {};
      if (rule.fontSize) roleGroup.size = { $value: rule.fontSize, $type: 'dimension' } satisfies DTCGToken;
      if (rule.fontWeight) roleGroup.weight = { $value: rule.fontWeight, $type: 'fontWeight' } satisfies DTCGToken;
      if (rule.lineHeight) roleGroup.lineHeight = { $value: rule.lineHeight, $type: 'number' } satisfies DTCGToken;
      if (rule.letterSpacing != null) roleGroup.letterSpacing = { $value: rule.letterSpacing, $type: 'dimension' } satisfies DTCGToken;
      if (rule.fontFamily) roleGroup.family = { $value: rule.fontFamily, $type: 'fontFamily' } satisfies DTCGToken;
      typeGroup[rule.role] = roleGroup;
    }
    result.type = typeGroup;
  }

  // Spacing
  if (ds.layout?.spacingUnit) {
    const spaceGroup: DTCGGroup = {};
    spaceGroup.unit = { $value: ds.layout.spacingUnit, $type: 'dimension' } satisfies DTCGToken;
    if (ds.layout.spacingScale) {
      for (const [key, val] of Object.entries(ds.layout.spacingScale)) {
        spaceGroup[key] = { $value: val, $type: 'dimension' } satisfies DTCGToken;
      }
    }
    result.space = spaceGroup;
  }

  // Radius
  if (ds.layout?.borderRadiusScale) {
    const radiusGroup: DTCGGroup = {};
    for (let i = 0; i < ds.layout.borderRadiusScale.length; i++) {
      radiusGroup[String(i)] = { $value: ds.layout.borderRadiusScale[i], $type: 'dimension' } satisfies DTCGToken;
    }
    result.radius = radiusGroup;
  }

  return result;
}

// Re-export hexToColor for internal use
export { hexToColor };
