/**
 * Data display components — table, progress, meter, keyValue, definition list.
 */

import { frame as rawFrame, text as rawText, rect as rawRect, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { row, stack } from './layout.js';
import { body, label, divider } from './atoms.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS, STATUS_COLORS } from './defaults.js';

// ─── Table ───────────────────────────────────────────────────

export interface TableProps extends StyleOverrides {
  columns: string[];
  rows: string[][];
  headerColor?: string;
  headerTextColor?: string;
  cellColor?: string;
  textColor?: string;
  borderColor?: string;
  striped?: boolean;
}

/** Table — header row + data rows. */
export function table(props: TableProps): NodeBlueprint {
  const {
    columns, rows,
    headerColor = DEFAULTS.surfaceAlt, headerTextColor = DEFAULTS.text,
    cellColor = DEFAULTS.textInverse, textColor = DEFAULTS.chipText,
    borderColor = DEFAULTS.borderLight, striped = false,
    ...rest
  } = props;

  const headerCells = columns.map((col, i) =>
    rawFrame({
      layoutGrow: 1, layoutMode: 'HORIZONTAL', counterAxisAlign: 'CENTER',
      paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
    },
      rawText(col, { fontSize: 13, fontWeight: 600, fills: [solid(headerTextColor)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    )
  );

  const header = rawFrame({
    layoutMode: 'HORIZONTAL', layoutAlignSelf: 'STRETCH',
    fills: [solid(headerColor)],
  }, ...headerCells);

  const dataRows = rows.map((rowData, ri) => {
    const bgColor = striped && ri % 2 === 1 ? headerColor : cellColor;
    const cells = rowData.map(cell =>
      rawFrame({
        layoutGrow: 1, layoutMode: 'HORIZONTAL', counterAxisAlign: 'CENTER',
        paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
      },
        rawText(cell, { fontSize: 14, fills: [solid(textColor)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
      )
    );
    return rawFrame({
      layoutMode: 'HORIZONTAL', layoutAlignSelf: 'STRETCH',
      fills: [solid(bgColor)],
      strokes: [solid(borderColor, 0.3) as any],
    }, ...cells);
  });

  return rawFrame({
    name: 'Table',
    layoutMode: 'VERTICAL',
    layoutAlignSelf: 'STRETCH',
    cornerRadius: 8,
    clipsContent: true,
    strokes: [solid(borderColor, 0.5) as any],
    ...rest,
  }, header, ...dataRows);
}

// ─── Progress bar ────────────────────────────────────────────

export function progress(value: number, props?: StyleOverrides & {
  color?: string; trackColor?: string; height?: number; showLabel?: boolean;
}): NodeBlueprint {
  const { color = DEFAULTS.primary, trackColor = DEFAULTS.borderLight, height = 8, showLabel = false, ...rest } = props ?? {};
  const pct = Math.max(0, Math.min(1, value));

  const children: NodeBlueprint[] = [
    rawFrame({
      name: 'ProgressTrack',
      layoutMode: 'HORIZONTAL',
      layoutAlignSelf: 'STRETCH',
      height,
      cornerRadius: height / 2,
      fills: [solid(trackColor)],
      clipsContent: true,
    },
      rawRect({
        name: 'ProgressFill',
        width: Math.round(pct * 200),
        height,
        fills: [solid(color)],
        cornerRadius: height / 2,
      }),
    ),
  ];

  if (showLabel) {
    children.push(
      rawText(`${Math.round(pct * 100)}%`, {
        fontSize: 12, fontWeight: 500, fills: [solid(color)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
      })
    );
  }

  return rawFrame({
    name: 'Progress',
    layoutMode: 'VERTICAL',
    layoutAlignSelf: 'STRETCH',
    itemSpacing: 6,
    ...rest,
  }, ...children);
}

// ─── Key-Value pair ──────────────────────────────────────────

export function keyValue(key: string, value: string, props?: StyleOverrides & {
  keyColor?: string; valueColor?: string; direction?: 'horizontal' | 'vertical';
}): NodeBlueprint {
  const { keyColor = DEFAULTS.textMuted, valueColor = DEFAULTS.text, direction = 'horizontal', ...rest } = props ?? {};
  if (direction === 'vertical') {
    return stack({ gap: 2, ...rest } as any,
      rawText(key, { fontSize: 12, fontWeight: 500, fills: [solid(keyColor)], textAutoResize: 'WIDTH_AND_HEIGHT', textCase: 'UPPER' }),
      rawText(value, { fontSize: 16, fontWeight: 600, fills: [solid(valueColor)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    );
  }
  return row({ justify: 'between', align: 'center', ...rest } as any,
    rawText(key, { fontSize: 14, fills: [solid(keyColor)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
    rawText(value, { fontSize: 14, fontWeight: 500, fills: [solid(valueColor)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
  );
}

// ─── Toggle / Switch ─────────────────────────────────────────

export function toggle(on: boolean = false, props?: StyleOverrides & { color?: string }): NodeBlueprint {
  const { color = DEFAULTS.primary, ...rest } = props ?? {};
  const trackW = 44, trackH = 24, knobSize = 20;
  return rawFrame({
    name: 'Toggle',
    width: trackW, height: trackH,
    cornerRadius: trackH / 2,
    fills: [solid(on ? color : DEFAULTS.border)],
    ...rest,
  },
    rawRect({
      name: 'Knob',
      layoutPositioning: 'ABSOLUTE',
      x: on ? trackW - knobSize - 2 : 2,
      y: 2,
      width: knobSize, height: knobSize,
      cornerRadius: knobSize / 2,
      fills: [solid(DEFAULTS.textInverse)],
      effects: [{ type: 'DROP_SHADOW', visible: true, radius: 2, offset: { x: 0, y: 1 }, color: { r: 0, g: 0, b: 0, a: 0.15 }, spread: 0 } as any],
    }),
  );
}

// ─── Select / Dropdown ───────────────────────────────────────

export function select(value: string, options?: string[], props?: StyleOverrides): NodeBlueprint {
  return rawFrame({
    name: 'Select',
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'SPACE_BETWEEN',
    counterAxisAlign: 'CENTER',
    paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
    cornerRadius: 8,
    fills: [],
    strokes: [solid(DEFAULTS.border) as any],
    ...props,
  },
    rawText(value, { fontSize: 15, fills: [solid(DEFAULTS.text)], textAutoResize: 'WIDTH_AND_HEIGHT', layoutGrow: 1 }),
    rawText('▾', { fontSize: 14, fills: [solid(DEFAULTS.placeholder)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
  );
}

// ─── Textarea ────────────────────────────────────────────────

export function textarea(content: string, props?: StyleOverrides & { rows?: number }): NodeBlueprint {
  const rows = props?.rows ?? 4;
  return rawFrame({
    name: 'Textarea',
    layoutMode: 'VERTICAL',
    paddingTop: 10, paddingBottom: 10, paddingLeft: 14, paddingRight: 14,
    cornerRadius: 8,
    fills: [],
    strokes: [solid(DEFAULTS.border) as any],
    minHeight: rows * 24,
    layoutAlignSelf: 'STRETCH',
    ...props,
  },
    rawText(content, {
      fontSize: 15, lineHeight: 24, fills: [solid(DEFAULTS.text)],
      textAutoResize: 'HEIGHT', layoutAlignSelf: 'STRETCH',
    }),
  );
}

// ─── Tabs ────────────────────────────────────────────────────

export function tabs(items: string[], activeIndex: number = 0, props?: StyleOverrides & {
  color?: string; borderColor?: string;
}): NodeBlueprint {
  const { color = DEFAULTS.primary, borderColor = DEFAULTS.borderLight, ...rest } = props ?? {};
  return rawFrame({
    name: 'Tabs',
    layoutMode: 'HORIZONTAL',
    layoutAlignSelf: 'STRETCH',
    itemSpacing: 0,
    strokes: [solid(borderColor, 0.5) as any],
    borderTopWeight: 0, borderLeftWeight: 0, borderRightWeight: 0, borderBottomWeight: 1,
    independentStrokeWeights: true,
    ...rest,
  },
    ...items.map((item, i) => {
      const isActive = i === activeIndex;
      return rawFrame({
        layoutMode: 'HORIZONTAL',
        primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER',
        paddingTop: 12, paddingBottom: 12, paddingLeft: 20, paddingRight: 20,
        strokes: isActive ? [solid(color) as any] : [],
        borderTopWeight: 0, borderLeftWeight: 0, borderRightWeight: 0, borderBottomWeight: isActive ? 2 : 0,
        independentStrokeWeights: true,
      },
        rawText(item, {
          fontSize: 14, fontWeight: isActive ? 600 : 400,
          fills: [solid(isActive ? color : DEFAULTS.textMuted)],
          textAutoResize: 'WIDTH_AND_HEIGHT',
        }),
      );
    }),
  );
}

// ─── Accordion ───────────────────────────────────────────────

export function accordion(items: Array<{ title: string; content: string; open?: boolean }>, props?: StyleOverrides & {
  borderColor?: string;
}): NodeBlueprint {
  const { borderColor = DEFAULTS.borderLight, ...rest } = props ?? {};
  return rawFrame({
    name: 'Accordion',
    layoutMode: 'VERTICAL',
    layoutAlignSelf: 'STRETCH',
    cornerRadius: 8,
    strokes: [solid(borderColor, 0.5) as any],
    clipsContent: true,
    ...rest,
  },
    ...items.map((item, i) => {
      const children: NodeBlueprint[] = [
        // Header
        rawFrame({
          layoutMode: 'HORIZONTAL', primaryAxisAlign: 'SPACE_BETWEEN', counterAxisAlign: 'CENTER',
          layoutAlignSelf: 'STRETCH',
          paddingTop: 14, paddingBottom: 14, paddingLeft: 16, paddingRight: 16,
          fills: item.open ? [solid(DEFAULTS.hover)] : [],
        },
          rawText(item.title, { fontSize: 15, fontWeight: 500, fills: [solid(DEFAULTS.text)], textAutoResize: 'WIDTH_AND_HEIGHT', layoutGrow: 1 }),
          rawText(item.open ? '−' : '+', { fontSize: 18, fills: [solid(DEFAULTS.placeholder)], textAutoResize: 'WIDTH_AND_HEIGHT' }),
        ),
      ];

      if (item.open) {
        children.push(
          rawFrame({
            layoutMode: 'VERTICAL', layoutAlignSelf: 'STRETCH',
            paddingTop: 0, paddingBottom: 14, paddingLeft: 16, paddingRight: 16,
          },
            rawText(item.content, {
              fontSize: 14, lineHeight: 22, fills: [solid(DEFAULTS.textMuted)],
              textAutoResize: 'HEIGHT', layoutAlignSelf: 'STRETCH',
            }),
          )
        );
      }

      // Add border between items (not on first)
      if (i > 0) {
        return rawFrame({ layoutMode: 'VERTICAL', layoutAlignSelf: 'STRETCH' },
          rawRect({ height: 1, layoutAlignSelf: 'STRETCH', fills: [solid(borderColor, 0.5)] }),
          ...children,
        );
      }
      return rawFrame({ layoutMode: 'VERTICAL', layoutAlignSelf: 'STRETCH' }, ...children);
    }),
  );
}
