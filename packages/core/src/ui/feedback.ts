/**
 * Feedback & overlay components — modal, toast, tooltip, alert, banner, emptyState, skeleton.
 *
 * Each function returns a NodeBlueprint. Compose inside layouts or use standalone.
 */

import { frame as rawFrame, text as rawText, rect as rawRect, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { row, stack, center } from './layout.js';
import { body, heading, caption } from './atoms.js';
import { button } from './composites.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS, STATUS_COLORS } from './defaults.js';

// ─── Variant colors ─────────────────────────────────────────

const variantColors: Record<string, string> = {
  info: DEFAULTS.info,
  success: DEFAULTS.success,
  warning: DEFAULTS.warning,
  error: DEFAULTS.error,
};

// ─── Modal ──────────────────────────────────────────────────

/** Modal dialog overlay — dark backdrop with centered card. */
export function modal(
  props: StyleOverrides & { title: string; width?: number; onClose?: boolean },
  ...children: NodeBlueprint[]
): NodeBlueprint {
  const { title, width = 480, onClose, ...rest } = props;

  // Header row: title + optional close button
  const headerChildren: NodeBlueprint[] = [
    heading(title, { level: 3 }),
  ];
  if (onClose) {
    headerChildren.push(
      rawFrame({
        name: 'CloseBtn',
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'HUG',
        counterAxisSizing: 'HUG',
        primaryAxisAlign: 'CENTER',
        counterAxisAlign: 'CENTER',
        paddingTop: 4,
        paddingBottom: 4,
        paddingLeft: 8,
        paddingRight: 8,
        cornerRadius: 6,
      },
        rawText('\u00d7', {
          fontSize: 20,
          fontWeight: 400,
          fills: [solid(DEFAULTS.textMuted)],
          textAutoResize: 'WIDTH_AND_HEIGHT',
        }),
      ),
    );
  }

  const header = row(
    { name: 'ModalHeader', justify: 'between', align: 'center' } as any,
    ...headerChildren,
  );

  // Inner card
  const card = stack({
    name: 'ModalCard',
    width,
    gap: 24,
    pad: 32,
    fills: [solid(DEFAULTS.textInverse)],
    cornerRadius: 16,
    effects: [{
      type: 'DROP_SHADOW', visible: true, radius: 32,
      offset: { x: 0, y: 8 }, color: { r: 0, g: 0, b: 0, a: 0.15 }, spread: 0,
    } as any],
  } as any,
    header,
    ...children,
  );

  // Outer overlay
  return center({
    name: 'Modal',
    w: 9999,
    h: 9999,
    fills: [solid(DEFAULTS.text, 0.5)],
    ...rest,
  } as any,
    card,
  );
}

// ─── Toast ──────────────────────────────────────────────────

/** Notification toast — small bar with icon dot and message. */
export function toast(
  message: string,
  props?: StyleOverrides & { variant?: 'info' | 'success' | 'warning' | 'error' },
): NodeBlueprint {
  const { variant = 'info', ...rest } = props ?? {};
  const color = variantColors[variant];

  const dot = rawRect({
    name: 'Icon',
    width: 8,
    height: 8,
    cornerRadius: 4,
    fills: [solid(color)],
  });

  return row({
    name: 'Toast',
    gap: 12,
    align: 'center',
    pad: [12, 16],
    maxWidth: 400,
    cornerRadius: 10,
    fills: [solid(DEFAULTS.textInverse)],
    effects: [{
      type: 'DROP_SHADOW', visible: true, radius: 16,
      offset: { x: 0, y: 4 }, color: { r: 0, g: 0, b: 0, a: 0.1 }, spread: 0,
    } as any],
    ...rest,
  } as any,
    dot,
    body(message, { fontSize: 14 }),
  );
}

// ─── Tooltip ────────────────────────────────────────────────

/** Tooltip label — dark background, white text, small caret. */
export function tooltip(
  text: string,
  props?: StyleOverrides,
): NodeBlueprint {
  const label = rawFrame({
    name: 'Tooltip',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 10,
    paddingRight: 10,
    cornerRadius: 6,
    fills: [solid(DEFAULTS.surfaceDark)],
    ...props,
  },
    rawText(text, {
      fontSize: 12,
      fontWeight: 500,
      fills: [solid(DEFAULTS.textInverse)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );

  // Small caret arrow (downward triangle)
  const caret = rawRect({
    name: 'Caret',
    width: 8,
    height: 8,
    rotation: 45,
    fills: [solid(DEFAULTS.surfaceDark)],
    layoutAlignSelf: 'CENTER',
  });

  return stack(
    { name: 'TooltipGroup', gap: -4, align: 'center' } as any,
    label,
    caret,
  );
}

// ─── Alert ──────────────────────────────────────────────────

/** Alert banner — full-width colored bar with icon dot, optional title, and message. */
export function alert(
  message: string,
  props?: StyleOverrides & { variant?: 'info' | 'success' | 'warning' | 'error'; title?: string },
): NodeBlueprint {
  const { variant = 'info', title, ...rest } = props ?? {};
  const color = variantColors[variant];

  const dot = rawRect({
    name: 'Icon',
    width: 10,
    height: 10,
    cornerRadius: 5,
    fills: [solid(color)],
  });

  const textChildren: NodeBlueprint[] = [];
  if (title) {
    textChildren.push(rawText(title, {
      name: 'AlertTitle',
      fontSize: 14,
      fontWeight: 600,
      fills: [solid(color)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }));
  }
  textChildren.push(body(message, { fontSize: 14 }));

  const textCol = stack({ gap: 4 } as any, ...textChildren);

  return row({
    name: 'Alert',
    gap: 12,
    align: 'start',
    pad: 16,
    fills: [solid(color, 0.1)],
    cornerRadius: 8,
    independentStrokeWeights: true,
    borderLeftWeight: 3,
    strokes: [solid(color) as any],
    ...rest,
  } as any,
    dot,
    textCol,
  );
}

// ─── Banner ─────────────────────────────────────────────────

/** Top-of-page announcement banner — full width, centered text. */
export function banner(
  message: string,
  props?: StyleOverrides & { color?: string; textColor?: string },
): NodeBlueprint {
  const { color = DEFAULTS.primary, textColor = DEFAULTS.textInverse, ...rest } = props ?? {};

  return center({
    name: 'Banner',
    pad: [10, 16],
    fills: [solid(color)],
    ...rest,
  } as any,
    rawText(message, {
      fontSize: 14,
      fontWeight: 500,
      fills: [solid(textColor)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textAlignHorizontal: 'CENTER',
    }),
  );
}

// ─── Empty state ────────────────────────────────────────────

/** Empty/placeholder state — centered icon, title, description, optional action. */
export function emptyState(
  props: StyleOverrides & { title: string; description?: string; action?: string },
): NodeBlueprint {
  const { title, description, action, ...rest } = props;

  const children: NodeBlueprint[] = [];

  // Icon placeholder circle
  children.push(rawRect({
    name: 'IconPlaceholder',
    width: 64,
    height: 64,
    cornerRadius: 32,
    fills: [solid(DEFAULTS.borderLight)],
    layoutAlignSelf: 'CENTER',
  }));

  // Title
  children.push(rawText(title, {
    name: 'EmptyTitle',
    fontSize: 18,
    fontWeight: 600,
    fills: [solid(DEFAULTS.chipText)],
    textAutoResize: 'WIDTH_AND_HEIGHT',
    textAlignHorizontal: 'CENTER',
    layoutAlignSelf: 'CENTER',
  }));

  // Description
  if (description) {
    children.push(rawText(description, {
      name: 'EmptyDescription',
      fontSize: 14,
      fontWeight: 400,
      fills: [solid(DEFAULTS.placeholder)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textAlignHorizontal: 'CENTER',
      layoutAlignSelf: 'CENTER',
    }));
  }

  // Action button
  if (action) {
    children.push(button(action, { size: 'md', layoutAlignSelf: 'CENTER' }));
  }

  return stack({
    name: 'EmptyState',
    gap: 16,
    pad: 48,
    align: 'center',
    ...rest,
  } as any,
    ...children,
  );
}

// ─── Skeleton ───────────────────────────────────────────────

/** Loading placeholder — rounded gray shape. */
export function skeleton(
  props?: StyleOverrides & { width?: number; height?: number; variant?: 'text' | 'circle' | 'rect' },
): NodeBlueprint {
  const { variant = 'rect', ...rest } = props ?? {};

  if (variant === 'circle') {
    const size = rest.width ?? 40;
    return rawRect({
      name: 'Skeleton',
      width: size,
      height: size,
      cornerRadius: size / 2,
      fills: [solid(DEFAULTS.borderLight)],
      ...rest,
    });
  }

  if (variant === 'text') {
    return rawRect({
      name: 'Skeleton',
      height: 16,
      layoutAlignSelf: 'STRETCH',
      cornerRadius: 4,
      fills: [solid(DEFAULTS.borderLight)],
      ...rest,
    });
  }

  // rect (default)
  return rawRect({
    name: 'Skeleton',
    height: rest.height ?? 100,
    layoutAlignSelf: 'STRETCH',
    cornerRadius: 8,
    fills: [solid(DEFAULTS.borderLight)],
    ...rest,
  });
}
