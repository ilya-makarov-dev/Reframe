/**
 * Composites — higher-level components built from atoms + layout.
 *
 * button(), card(), avatar(), badge(), chip(), listItem(),
 * navbar(), input(), tag(), stat(), quote()
 *
 * All return NodeBlueprint. Fully composable.
 */

import { frame as rawFrame, text as rawText, rect as rawRect, ellipse as rawEllipse, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { heading, body, label, caption } from './atoms.js';
import { row, stack, center } from './layout.js';

type StyleOverrides = Partial<NodeProps>;

import { DEFAULTS } from './defaults.js';

// ─── Interactive ─────────────────────────────────────────────

/** Button — labeled clickable rectangle. */
export function button(text: string, props?: StyleOverrides & {
  variant?: 'filled' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  color?: string;
}): NodeBlueprint {
  const { variant = 'filled', size = 'md', color = DEFAULTS.primary, ...rest } = props ?? {};
  const sizes = { sm: { fontSize: 13, padV: 6, padH: 14 }, md: { fontSize: 15, padV: 10, padH: 20 }, lg: { fontSize: 17, padV: 14, padH: 28 } };
  const s = sizes[size];

  const btnFills = variant === 'filled' ? [solid(color)]
    : variant === 'outline' ? [] : [];
  const textColor = variant === 'filled' ? DEFAULTS.textInverse : color;

  return rawFrame({
    name: 'Button',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: s.padV,
    paddingBottom: s.padV,
    paddingLeft: s.padH,
    paddingRight: s.padH,
    cornerRadius: 8,
    fills: btnFills,
    strokes: variant === 'outline' ? [solid(color) as any] : [],
    ...rest,
  },
    rawText(text, {
      fontSize: s.fontSize,
      fontWeight: 600,
      fills: [solid(textColor)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}

/** Link — styled text that looks clickable. */
export function link(text: string, props?: StyleOverrides & { color?: string }): NodeBlueprint {
  return rawText(text, {
    name: 'Link',
    fontSize: 15,
    fontWeight: 500,
    fills: [solid(props?.color ?? DEFAULTS.primary)],
    textDecoration: 'UNDERLINE',
    textAutoResize: 'WIDTH_AND_HEIGHT',
    ...props,
  });
}

/** Input field — text box with border. */
export function input(placeholder: string, props?: StyleOverrides & { value?: string }): NodeBlueprint {
  return rawFrame({
    name: 'Input',
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER',
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 14,
    paddingRight: 14,
    cornerRadius: 8,
    fills: [],
    strokes: [solid(DEFAULTS.border) as any],
    ...props,
  },
    rawText(props?.value || placeholder, {
      fontSize: 15,
      fills: [solid(props?.value ? DEFAULTS.text : DEFAULTS.placeholder)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      layoutGrow: 1,
    }),
  );
}

// ─── Content containers ──────────────────────────────────────

/** Card — elevated container with padding and rounded corners. */
export function card(props: StyleOverrides & { pad?: number; elevated?: boolean }, ...children: NodeBlueprint[]): NodeBlueprint {
  const p = props?.pad ?? 24;
  const elevated = props?.elevated !== false;
  return rawFrame({
    name: 'Card',
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    paddingTop: p,
    paddingRight: p,
    paddingBottom: p,
    paddingLeft: p,
    cornerRadius: 12,
    fills: [solid(DEFAULTS.surface)],
    effects: elevated ? [{
      type: 'DROP_SHADOW', visible: true, radius: 16,
      offset: { x: 0, y: 4 }, color: { r: 0, g: 0, b: 0, a: 0.08 }, spread: 0,
    } as any] : [],
    ...props,
  }, ...children);
}

/** Badge — small label with background. */
export function badge(text: string, props?: StyleOverrides & { color?: string }): NodeBlueprint {
  const color = props?.color ?? DEFAULTS.primary;
  return rawFrame({
    name: 'Badge',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 3,
    paddingBottom: 3,
    paddingLeft: 8,
    paddingRight: 8,
    cornerRadius: 9999,
    fills: [solid(color, 0.1)],
    ...props,
  },
    rawText(text, {
      fontSize: 11,
      fontWeight: 600,
      fills: [solid(color)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}

/** Chip — removable tag/filter. */
export function chip(text: string, props?: StyleOverrides & { color?: string }): NodeBlueprint {
  return rawFrame({
    name: 'Chip',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 12,
    paddingRight: 12,
    cornerRadius: 9999,
    fills: [solid(DEFAULTS.surfaceAlt)],
    ...props,
  },
    rawText(text, {
      fontSize: 13,
      fontWeight: 500,
      fills: [solid(DEFAULTS.chipText)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}

/** Tag — small colored label. */
export function tag(text: string, props?: StyleOverrides & { color?: string }): NodeBlueprint {
  const color = props?.color ?? DEFAULTS.success;
  return rawFrame({
    name: 'Tag',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 2,
    paddingBottom: 2,
    paddingLeft: 6,
    paddingRight: 6,
    cornerRadius: 4,
    fills: [solid(color, 0.15)],
    ...props,
  },
    rawText(text, {
      fontSize: 11,
      fontWeight: 600,
      fills: [solid(color)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
      textCase: 'UPPER',
    }),
  );
}

// ─── Data display ────────────────────────────────────────────

/** Avatar — circular image/initials placeholder. */
export function avatar(props?: StyleOverrides & { initials?: string; size?: number; color?: string }): NodeBlueprint {
  const sz = props?.size ?? 40;
  const color = props?.color ?? DEFAULTS.avatarBg;
  if (props?.initials) {
    return center({
      name: 'Avatar', width: sz, height: sz, cornerRadius: sz / 2,
      fills: [solid(color)],
      ...props,
    },
      rawText(props.initials.slice(0, 2).toUpperCase(), {
        fontSize: sz * 0.4, fontWeight: 600, fills: [solid(DEFAULTS.chipText)],
        textAutoResize: 'WIDTH_AND_HEIGHT',
      }),
    );
  }
  return rawEllipse({ name: 'Avatar', width: sz, height: sz, fills: [solid(color)], ...props });
}

/** Stat — big number with label. */
export function stat(value: string, labelText: string, props?: StyleOverrides): NodeBlueprint {
  const { fills, ...frameProps } = (props ?? {}) as any;
  const textFills = fills ?? [];
  return stack({ name: 'Stat', gap: 4, align: 'center', ...frameProps } as any,
    rawText(value, { fontSize: 32, fontWeight: 700, textAutoResize: 'WIDTH_AND_HEIGHT', fills: textFills }),
    rawText(labelText, { fontSize: 13, fontWeight: 400, opacity: 0.6, textAutoResize: 'WIDTH_AND_HEIGHT', fills: textFills }),
  );
}

/** Quote — blockquote with attribution. */
export function quote(text: string, author?: string, props?: StyleOverrides): NodeBlueprint {
  const { fills, ...frameProps } = (props ?? {}) as any;
  const textFills = fills ?? [];
  const children: NodeBlueprint[] = [
    rawText(`"${text}"`, {
      fontSize: 18, fontWeight: 400, italic: true, lineHeight: 28,
      textAutoResize: 'WIDTH_AND_HEIGHT', fills: textFills,
    }),
  ];
  if (author) {
    children.push(rawText(`— ${author}`, {
      fontSize: 14, fontWeight: 500, opacity: 0.6,
      textAutoResize: 'WIDTH_AND_HEIGHT', fills: textFills,
    }));
  }
  return stack({
    name: 'Quote',
    gap: 12,
    paddingLeft: 20,
    strokes: [solid(DEFAULTS.quoteBorder, 0.3) as any],
    ...frameProps,
  } as any, ...children);
}

/** List item — icon/bullet + text row. */
export function listItem(text: string, props?: StyleOverrides & { bullet?: string }): NodeBlueprint {
  const { fills, bullet = '•', ...frameProps } = (props ?? {}) as any;
  const textFills = fills ?? [];
  return row({ name: 'ListItem', gap: 8, align: 'center', ...frameProps } as any,
    rawText(bullet, { fontSize: 16, fontWeight: 400, textAutoResize: 'WIDTH_AND_HEIGHT', opacity: 0.4, fills: textFills }),
    rawText(text, { fontSize: 16, fontWeight: 400, lineHeight: 24, textAutoResize: 'WIDTH_AND_HEIGHT', fills: textFills }),
  );
}

/** Nav item — text with hover state. */
export function navItem(text: string, props?: StyleOverrides & { active?: boolean }): NodeBlueprint {
  return rawFrame({
    name: 'NavItem',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 12,
    paddingRight: 12,
    cornerRadius: 6,
    fills: props?.active ? [solid(DEFAULTS.surfaceAlt)] : [],
    ...props,
  },
    rawText(text, {
      fontSize: 14,
      fontWeight: props?.active ? 600 : 400,
      fills: [solid(props?.active ? DEFAULTS.text : DEFAULTS.textMuted)],
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );
}
