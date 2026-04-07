/**
 * Navigation components — sidebar, breadcrumb, pagination, stepper, menuItem.
 *
 * All return NodeBlueprint. Fully composable.
 */

import { frame as rawFrame, text as rawText, rect as rawRect, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { row, stack } from './layout.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS, STATUS_COLORS } from './defaults.js';

// ─── Sidebar ────────────────────────────────────────────────

/** Sidebar — vertical nav with labeled items, optional active highlight. */
export function sidebar(items: Array<{ label: string; active?: boolean; icon?: string }>, props?: StyleOverrides): NodeBlueprint {
  const sidebarItems = items.map(item => {
    const children: NodeBlueprint[] = [];
    if (item.icon) {
      children.push(rawText(item.icon, {
        fontSize: 14,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: [solid(item.active ? DEFAULTS.textInverse : DEFAULTS.placeholder)],
      }));
    }
    children.push(rawText(item.label, {
      fontSize: 14,
      fontWeight: item.active ? 600 : 400,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: [solid(item.active ? DEFAULTS.textInverse : DEFAULTS.placeholder)],
    }));

    return rawFrame({
      name: item.active ? 'SidebarItem-active' : 'SidebarItem',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      counterAxisAlign: 'CENTER',
      itemSpacing: 8,
      paddingTop: 10,
      paddingBottom: 10,
      paddingLeft: 16,
      paddingRight: 16,
      cornerRadius: 8,
      fills: item.active ? [solid(DEFAULTS.primary)] : [],
      layoutAlignSelf: 'STRETCH',
    }, ...children);
  });

  return rawFrame({
    name: 'Sidebar',
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    width: 260,
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
    itemSpacing: 4,
    fills: [solid(DEFAULTS.surfaceDark)],
    ...props,
  }, ...sidebarItems);
}

// ─── Breadcrumb ─────────────────────────────────────────────

/** Breadcrumb — horizontal path trail. Last item is bold/primary, rest are muted. */
export function breadcrumb(items: string[], props?: StyleOverrides): NodeBlueprint {
  const children: NodeBlueprint[] = [];

  items.forEach((item, i) => {
    const isLast = i === items.length - 1;

    if (i > 0) {
      children.push(rawText('/', {
        fontSize: 14,
        fontWeight: 400,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: [solid(DEFAULTS.placeholder)],
      }));
    }

    children.push(rawText(item, {
      fontSize: 14,
      fontWeight: isLast ? 600 : 400,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: [solid(isLast ? DEFAULTS.primary : DEFAULTS.placeholder)],
    }));
  });

  return rawFrame({
    name: 'Breadcrumb',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    itemSpacing: 8,
    ...props,
  }, ...children);
}

// ─── Pagination ─────────────────────────────────────────────

/** Pagination — page navigation with prev/next and numbered buttons. */
export function pagination(current: number, total: number, props?: StyleOverrides): NodeBlueprint {
  const primaryColor = DEFAULTS.primary;
  const children: NodeBlueprint[] = [];

  // Previous button
  children.push(rawFrame({
    name: 'PrevBtn',
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    width: 32,
    height: 32,
    cornerRadius: 8,
    fills: [],
  },
    rawText('<', {
      fontSize: 14,
      fontWeight: 500,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: [solid(current <= 1 ? DEFAULTS.border : DEFAULTS.chipText)],
    }),
  ));

  // Page numbers with ellipsis for large totals
  const pages = buildPageNumbers(current, total);
  for (const page of pages) {
    if (page === '...') {
      children.push(rawText('...', {
        fontSize: 14,
        fontWeight: 400,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: [solid(DEFAULTS.placeholder)],
      }));
    } else {
      const num = page as number;
      const isActive = num === current;
      children.push(rawFrame({
        name: isActive ? 'Page-active' : 'Page',
        layoutMode: 'HORIZONTAL',
        primaryAxisAlign: 'CENTER',
        counterAxisAlign: 'CENTER',
        width: 32,
        height: 32,
        cornerRadius: 8,
        fills: isActive ? [solid(primaryColor)] : [],
      },
        rawText(String(num), {
          fontSize: 14,
          fontWeight: isActive ? 600 : 400,
          textAutoResize: 'WIDTH_AND_HEIGHT',
          fills: [solid(isActive ? DEFAULTS.textInverse : DEFAULTS.chipText)],
        }),
      ));
    }
  }

  // Next button
  children.push(rawFrame({
    name: 'NextBtn',
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    width: 32,
    height: 32,
    cornerRadius: 8,
    fills: [],
  },
    rawText('>', {
      fontSize: 14,
      fontWeight: 500,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: [solid(current >= total ? DEFAULTS.border : DEFAULTS.chipText)],
    }),
  ));

  return rawFrame({
    name: 'Pagination',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    itemSpacing: 4,
    ...props,
  }, ...children);
}

/** Build page number list with ellipsis for large totals. */
function buildPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | '...')[] = [1];
  if (current > 3) pages.push('...');
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}

// ─── Stepper ────────────────────────────────────────────────

/** Stepper — multi-step progress indicator with circles and labels. */
export function stepper(steps: string[], currentStep: number, props?: StyleOverrides): NodeBlueprint {
  const primaryColor = DEFAULTS.primary;
  const mutedColor = DEFAULTS.border;
  const children: NodeBlueprint[] = [];

  steps.forEach((label, i) => {
    const stepNum = i + 1;
    const isCompleted = stepNum < currentStep;
    const isCurrent = stepNum === currentStep;

    // Connector line before this step (skip first)
    if (i > 0) {
      children.push(rawRect({
        name: 'Connector',
        height: 2,
        layoutGrow: 1,
        fills: [solid(isCompleted || isCurrent ? primaryColor : mutedColor)],
      }));
    }

    // Step column: circle + label
    const circleColor = isCompleted || isCurrent ? primaryColor : mutedColor;
    const circleText = isCompleted ? '\u2713' : String(stepNum);
    const circleTextColor = isCompleted || isCurrent ? DEFAULTS.textInverse : DEFAULTS.textMuted;

    children.push(
      stack({ name: `Step-${stepNum}`, gap: 8, align: 'center' } as any,
        rawFrame({
          name: 'StepCircle',
          layoutMode: 'HORIZONTAL',
          primaryAxisAlign: 'CENTER',
          counterAxisAlign: 'CENTER',
          width: 32,
          height: 32,
          cornerRadius: 16,
          fills: [solid(circleColor)],
        },
          rawText(circleText, {
            fontSize: 14,
            fontWeight: 600,
            textAutoResize: 'WIDTH_AND_HEIGHT',
            fills: [solid(circleTextColor)],
          }),
        ),
        rawText(label, {
          fontSize: 12,
          fontWeight: isCurrent ? 600 : 400,
          textAutoResize: 'WIDTH_AND_HEIGHT',
          fills: [solid(isCurrent ? DEFAULTS.text : DEFAULTS.textMuted)],
        }),
      ),
    );
  });

  return rawFrame({
    name: 'Stepper',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    itemSpacing: 0,
    ...props,
  }, ...children);
}

// ─── Menu item ──────────────────────────────────────────────

/** MenuItem — single menu/dropdown item with optional active/disabled states. */
export function menuItem(label: string, props?: StyleOverrides & { active?: boolean; disabled?: boolean }): NodeBlueprint {
  const { active = false, disabled = false, ...rest } = props ?? {};
  const textColor = disabled ? DEFAULTS.placeholder : active ? DEFAULTS.primary : DEFAULTS.text;

  return rawFrame({
    name: 'MenuItem',
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 12,
    paddingRight: 12,
    cornerRadius: 6,
    fills: active ? [solid(DEFAULTS.surfaceAlt)] : [],
    opacity: disabled ? 0.5 : 1,
    layoutAlignSelf: 'STRETCH',
    ...rest,
  },
    rawText(label, {
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: [solid(textColor)],
    }),
  );
}
