/**
 * Form components — interactive form controls.
 *
 * checkbox(), radio(), slider(), formGroup(), formRow(),
 * searchInput(), radioGroup(), checkboxGroup()
 *
 * All return NodeBlueprint. Compose them inside layouts.
 */

import { frame as rawFrame, text as rawText, rect as rawRect, ellipse as rawEllipse, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { row, stack } from './layout.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS, STATUS_COLORS } from './defaults.js';

const PRIMARY = DEFAULTS.primary;

// ─── Checkbox ───────────────────────────────────────────────

/** Checkbox with optional label. */
export function checkbox(checked: boolean, label?: string, props?: StyleOverrides): NodeBlueprint {
  const box = rawFrame({
    name: 'CheckboxBox',
    width: 18,
    height: 18,
    cornerRadius: 4,
    layoutMode: 'VERTICAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    fills: checked ? [solid(PRIMARY)] : [],
    strokes: checked ? [] : [solid(DEFAULTS.border) as any],
    ...(!label ? props : {}),
  },
    ...(checked
      ? [rawText('\u2713', {
          fontSize: 12,
          fontWeight: 700,
          fills: [solid(DEFAULTS.textInverse)],
          textAutoResize: 'WIDTH_AND_HEIGHT',
          textAlignHorizontal: 'CENTER',
        })]
      : []),
  );

  if (!label) return box;

  return row({ name: 'Checkbox', gap: 8, align: 'center', ...props } as any,
    box,
    rawText(label, {
      fontSize: 14,
      fontWeight: 400,
      fills: [solid(DEFAULTS.text)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}

// ─── Radio ──────────────────────────────────────────────────

/** Radio button with optional label. */
export function radio(selected: boolean, label?: string, props?: StyleOverrides): NodeBlueprint {
  const circle = rawFrame({
    name: 'RadioCircle',
    width: 18,
    height: 18,
    cornerRadius: 9,
    layoutMode: 'VERTICAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    fills: [],
    strokes: [solid(selected ? PRIMARY : DEFAULTS.border) as any],
    ...(!label ? props : {}),
  },
    ...(selected
      ? [rawEllipse({
          width: 8,
          height: 8,
          fills: [solid(PRIMARY)],
        })]
      : []),
  );

  if (!label) return circle;

  return row({ name: 'Radio', gap: 8, align: 'center', ...props } as any,
    circle,
    rawText(label, {
      fontSize: 14,
      fontWeight: 400,
      fills: [solid(DEFAULTS.text)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}

// ─── Slider ─────────────────────────────────────────────────

/** Range slider (0-1). */
export function slider(value: number, props?: StyleOverrides): NodeBlueprint {
  const clamped = Math.max(0, Math.min(1, value));
  const trackWidth = (props?.width as number) ?? 200;
  const fillWidth = Math.round(trackWidth * clamped);

  const track = rawRect({
    name: 'SliderTrack',
    width: trackWidth,
    height: 4,
    cornerRadius: 2,
    fills: [solid(DEFAULTS.borderLight)],
  });

  const fill = rawRect({
    name: 'SliderFill',
    width: fillWidth,
    height: 4,
    cornerRadius: 2,
    fills: [solid(PRIMARY)],
    layoutPositioning: 'ABSOLUTE',
    x: 0,
    y: 6,
  });

  const thumb = rawEllipse({
    name: 'SliderThumb',
    width: 16,
    height: 16,
    fills: [solid(DEFAULTS.textInverse)],
    effects: [{
      type: 'DROP_SHADOW', visible: true, radius: 4,
      offset: { x: 0, y: 1 }, color: { r: 0, g: 0, b: 0, a: 0.2 }, spread: 0,
    } as any],
    strokes: [solid(DEFAULTS.border) as any],
    layoutPositioning: 'ABSOLUTE',
    x: Math.max(0, fillWidth - 8),
    y: 0,
  });

  return rawFrame({
    name: 'Slider',
    width: trackWidth,
    height: 16,
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER',
    ...props,
  },
    track,
    fill,
    thumb,
  );
}

// ─── Form Group ─────────────────────────────────────────────

/** Labeled form field wrapper. */
export function formGroup(label: string, children: NodeBlueprint[], props?: StyleOverrides): NodeBlueprint {
  return stack({
    name: 'FormGroup',
    gap: 6,
    layoutAlignSelf: 'STRETCH',
    ...props,
  } as any,
    rawText(label, {
      fontSize: 13,
      fontWeight: 500,
      fills: [solid(DEFAULTS.textMuted)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
    ...children,
  );
}

// ─── Form Row ───────────────────────────────────────────────

/** Horizontal form row for placing multiple fields side by side. */
export function formRow(children: NodeBlueprint[], props?: StyleOverrides): NodeBlueprint {
  return row({ name: 'FormRow', gap: 16, align: 'end', ...props } as any,
    ...children,
  );
}

// ─── Search Input ───────────────────────────────────────────

/** Search input with icon. */
export function searchInput(placeholder?: string, props?: StyleOverrides): NodeBlueprint {
  return rawFrame({
    name: 'SearchInput',
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 14,
    cornerRadius: 8,
    fills: [],
    strokes: [solid(DEFAULTS.border) as any],
    itemSpacing: 8,
    ...props,
  },
    rawText('\u2315', {
      fontSize: 15,
      fills: [solid(DEFAULTS.placeholder)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
    rawText(placeholder ?? 'Search...', {
      fontSize: 15,
      fills: [solid(DEFAULTS.placeholder)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      layoutGrow: 1,
    }),
  );
}

// ─── Radio Group ────────────────────────────────────────────

/** Group of radio buttons (vertical). */
export function radioGroup(options: string[], selected: number, props?: StyleOverrides): NodeBlueprint {
  return stack({ name: 'RadioGroup', gap: 8, ...props } as any,
    ...options.map((opt, i) => radio(i === selected, opt)),
  );
}

// ─── Checkbox Group ─────────────────────────────────────────

/** Group of checkboxes (vertical). */
export function checkboxGroup(options: string[], checked: boolean[], props?: StyleOverrides): NodeBlueprint {
  return stack({ name: 'CheckboxGroup', gap: 8, ...props } as any,
    ...options.map((opt, i) => checkbox(checked[i] ?? false, opt)),
  );
}
