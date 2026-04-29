/**
 * Inspector color field semantics — Phase 1 UI-6a Pin #3.
 *
 * Pure helper deciding which color swatches to render for a given
 * node type. Text nodes have NO background — the engine paints text
 * with `fills` which exporter emits as the CSS `color` property, not
 * `background-color`. The legacy inspector showed both "Background"
 * and "Color" swatches on text nodes, with both writing the same
 * engine field — confusing for designers.
 *
 * After this pin, text-shaped nodes hide the Background swatch
 * entirely and show only the Color swatch (in the Type section).
 * Frame / container nodes keep both. Buttons/links count as text-
 * shaped because their visible "color" is text color, even though
 * they CAN have backgrounds — Figma surfaces those as "Fill" only,
 * never "Background", and we follow the same convention.
 */

const TEXT_SHAPED_TYPES: ReadonlySet<string> = new Set([
  'TEXT',
  'SPAN',
  'P',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'A',
  'LI',
  'LABEL',
  'BUTTON',
]);

/** Engine `props.type` is the INode kind label (TEXT/FRAME/...). */
export interface ColorFieldsInput {
  type?: string;
}

export interface ColorFieldsOutput {
  /** Whether to render the Fill (background) swatch row. */
  showBackground: boolean;
  /** Whether to render the text-color swatch row. */
  showColor: boolean;
  /** Display label for the color swatch when shown. */
  colorLabel: string;
}

export function getColorFieldsForNode(
  node: ColorFieldsInput | null | undefined,
): ColorFieldsOutput {
  const t = (node && node.type ? String(node.type).toUpperCase() : '');
  const isTextShaped = TEXT_SHAPED_TYPES.has(t);
  return {
    showBackground: !isTextShaped,
    showColor: isTextShaped,
    colorLabel: 'Color',
  };
}

export function isTextShapedType(type: string | undefined): boolean {
  if (!type) return false;
  return TEXT_SHAPED_TYPES.has(type.toUpperCase());
}
