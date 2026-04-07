/**
 * Sections — composable page sections for @reframe/ui.
 *
 * Higher-level building blocks that combine primitives into common page patterns.
 * Each returns a NodeBlueprint.
 *
 * heroSection(), featureGrid(), pricingSection(), testimonialSection(),
 * ctaSection(), footerSection(), navbarSection(), logoBar(), statsBar()
 */

import { frame as rawFrame, text as rawText, rect as rawRect, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';
import { row, stack, center, wrap } from './layout.js';
import { heading, body, label, caption, display, divider, circle } from './atoms.js';
import { button, card, badge, tag, listItem, stat, link, navItem, quote as quoteComp } from './composites.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS, STATUS_COLORS } from './defaults.js';

// ─── Helpers ────────────────────────────────────────────────

/** Section wrapper — vertical stack with padding and optional background. */
function sectionFrame(
  name: string,
  fills: any[] | undefined,
  rest: StyleOverrides,
  padV: number,
  padH: number,
  ...children: NodeBlueprint[]
): NodeBlueprint {
  return rawFrame({
    name,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    counterAxisAlign: 'STRETCH',
    paddingTop: padV,
    paddingBottom: padV,
    paddingLeft: padH,
    paddingRight: padH,
    fills: fills ? fills.map(f => typeof f === 'string' ? solid(f) : f) : [],
    ...rest,
  }, ...children);
}

// ─── 1. Hero Section ────────────────────────────────────────

export function heroSection(props: {
  badge?: string;
  headline: string;
  subheadline?: string;
  primaryCta?: string;
  secondaryCta?: string;
  caption?: string;
  align?: 'center' | 'left';
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const {
    badge: badgeText, headline, subheadline, primaryCta, secondaryCta,
    caption: captionText, align = 'center', fills,
    ...rest
  } = props;

  const isCenter = align === 'center';
  const textAlign: NodeProps['textAlignHorizontal'] = isCenter ? 'CENTER' : 'LEFT';

  const children: NodeBlueprint[] = [];

  // Badge
  if (badgeText) {
    children.push(
      isCenter
        ? row({ justify: 'center' }, badge(badgeText))
        : badge(badgeText),
    );
  }

  // Headline
  children.push(display(headline, {
    textAlignHorizontal: textAlign,
    ...(isCenter ? { layoutAlignSelf: 'CENTER' } : {}),
  }));

  // Subheadline
  if (subheadline) {
    children.push(body(subheadline, {
      fontSize: 20,
      lineHeight: 30,
      opacity: 0.7,
      textAlignHorizontal: textAlign,
      ...(isCenter ? { layoutAlignSelf: 'CENTER' } : {}),
    }));
  }

  // CTA buttons
  if (primaryCta || secondaryCta) {
    const buttons: NodeBlueprint[] = [];
    if (primaryCta) buttons.push(button(primaryCta, { variant: 'filled', size: 'lg' }));
    if (secondaryCta) buttons.push(button(secondaryCta, { variant: 'outline', size: 'lg' }));
    children.push(
      row({
        gap: 16,
        ...(isCenter ? { justify: 'center' } : {}),
      }, ...buttons),
    );
  }

  // Caption
  if (captionText) {
    children.push(caption(captionText, {
      textAlignHorizontal: textAlign,
      ...(isCenter ? { layoutAlignSelf: 'CENTER' } : {}),
    }));
  }

  const contentBlock = isCenter
    ? center({ name: 'HeroContent', gap: 24 }, ...children)
    : stack({ name: 'HeroContent', gap: 24 }, ...children);

  return sectionFrame('Hero', fills, rest, 120, 80, contentBlock);
}

// ─── 2. Feature Grid ────────────────────────────────────────

export function featureGrid(props: {
  title?: string;
  subtitle?: string;
  features: Array<{ tag?: string; tagColor?: string; title: string; description: string }>;
  columns?: 2 | 3;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { title, subtitle, features, columns = 3, fills, ...rest } = props;

  const children: NodeBlueprint[] = [];

  // Section header
  if (title || subtitle) {
    const headerChildren: NodeBlueprint[] = [];
    if (title) headerChildren.push(heading(title, { level: 2, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }));
    if (subtitle) headerChildren.push(body(subtitle, { muted: true, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }));
    children.push(center({ gap: 12 }, ...headerChildren));
  }

  // Feature cards
  const featureCards = features.map(f => {
    const cardChildren: NodeBlueprint[] = [];
    if (f.tag) cardChildren.push(tag(f.tag, { color: f.tagColor }));
    cardChildren.push(heading(f.title, { level: 4 }));
    cardChildren.push(body(f.description, { muted: true }));
    return card({ itemSpacing: 12 }, stack({ gap: 12 }, ...cardChildren));
  });

  // Calculate card width: rough estimate assuming 1200px content area
  const gap = 24;
  const cardWidth = Math.floor((1200 - 80 * 2 - gap * (columns - 1)) / columns);
  const sizedCards = featureCards.map(c => rawFrame({ width: cardWidth, layoutMode: 'VERTICAL' }, c));

  children.push(wrap({ gap, crossGap: gap, justify: 'center' }, ...sizedCards));

  return sectionFrame('Features', fills, rest, 80, 80, stack({ gap: 48 }, ...children));
}

// ─── 3. Pricing Section ─────────────────────────────────────

export function pricingSection(props: {
  title?: string;
  subtitle?: string;
  plans: Array<{
    name: string;
    price: string;
    period?: string;
    description?: string;
    features: string[];
    cta: string;
    highlighted?: boolean;
  }>;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { title, subtitle, plans, fills, ...rest } = props;

  const children: NodeBlueprint[] = [];

  // Section header
  if (title || subtitle) {
    const headerChildren: NodeBlueprint[] = [];
    if (title) headerChildren.push(heading(title, { level: 2, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }));
    if (subtitle) headerChildren.push(body(subtitle, { muted: true, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }));
    children.push(center({ gap: 12 }, ...headerChildren));
  }

  // Plan cards
  const planCards = plans.map(plan => {
    const isHighlighted = plan.highlighted === true;
    const cardChildren: NodeBlueprint[] = [];

    // Plan name
    cardChildren.push(rawText(plan.name, {
      fontSize: 18,
      fontWeight: 600,
      textAutoResize: 'WIDTH_AND_HEIGHT',
      fills: isHighlighted ? [solid(DEFAULTS.textInverse)] : [solid(DEFAULTS.text)],
    }));

    // Price row
    const priceChildren: NodeBlueprint[] = [
      rawText(plan.price, {
        fontSize: 40,
        fontWeight: 800,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: isHighlighted ? [solid(DEFAULTS.textInverse)] : [solid(DEFAULTS.text)],
      }),
    ];
    if (plan.period) {
      priceChildren.push(rawText(plan.period, {
        fontSize: 16,
        fontWeight: 400,
        opacity: 0.6,
        textAutoResize: 'WIDTH_AND_HEIGHT',
        fills: isHighlighted ? [solid(DEFAULTS.textInverse)] : [solid(DEFAULTS.text)],
      }));
    }
    cardChildren.push(row({ gap: 4, align: 'end' }, ...priceChildren));

    // Description
    if (plan.description) {
      cardChildren.push(body(plan.description, {
        muted: true,
        fills: isHighlighted ? [solid(DEFAULTS.textInverse, 0.8)] : undefined,
      }));
    }

    // Divider
    cardChildren.push(divider({ color: isHighlighted ? DEFAULTS.textInverse : DEFAULTS.text }));

    // Features list
    const featureItems = plan.features.map(f =>
      listItem(f, {
        bullet: '\u2713',
        fills: isHighlighted ? [solid(DEFAULTS.textInverse)] : undefined,
      }),
    );
    cardChildren.push(stack({ gap: 8 }, ...featureItems));

    // CTA button
    cardChildren.push(
      button(plan.cta, {
        variant: isHighlighted ? 'outline' : 'filled',
        size: 'lg',
        ...(isHighlighted ? {
          strokes: [solid(DEFAULTS.textInverse) as any],
          fills: [],
        } : {}),
        layoutAlignSelf: 'STRETCH',
      }),
    );

    return card({
      itemSpacing: 20,
      fills: isHighlighted ? [solid(DEFAULTS.primary)] : [solid(DEFAULTS.textInverse)],
      effects: isHighlighted ? [{
        type: 'DROP_SHADOW', visible: true, radius: 24,
        offset: { x: 0, y: 8 }, color: { r: 0.39, g: 0.4, b: 0.95, a: 0.25 }, spread: 0,
      } as any] : [{
        type: 'DROP_SHADOW', visible: true, radius: 16,
        offset: { x: 0, y: 4 }, color: { r: 0, g: 0, b: 0, a: 0.08 }, spread: 0,
      } as any],
      width: 320,
    }, stack({ gap: 20 }, ...cardChildren));
  });

  children.push(row({ gap: 24, justify: 'center', align: 'start' }, ...planCards));

  return sectionFrame('Pricing', fills, rest, 80, 80, stack({ gap: 48 }, ...children));
}

// ─── 4. Testimonial Section ─────────────────────────────────

export function testimonialSection(props: {
  title?: string;
  testimonials: Array<{
    quote: string;
    name: string;
    role: string;
    company?: string;
  }>;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { title, testimonials, fills, ...rest } = props;

  const children: NodeBlueprint[] = [];

  if (title) {
    children.push(center({}, heading(title, { level: 2, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' })));
  }

  const testimonialCards = testimonials.map(t => {
    const roleText = t.company ? `${t.role}, ${t.company}` : t.role;

    return card({ itemSpacing: 20, width: 360 },
      stack({ gap: 20 },
        // Quote
        quoteComp(t.quote),
        // Author row
        row({ gap: 12, align: 'center' },
          circle(40, { fills: [solid(DEFAULTS.borderLight)] }),
          stack({ gap: 2 },
            rawText(t.name, {
              fontSize: 15,
              fontWeight: 600,
              textAutoResize: 'WIDTH_AND_HEIGHT',
            }),
            rawText(roleText, {
              fontSize: 13,
              fontWeight: 400,
              opacity: 0.6,
              textAutoResize: 'WIDTH_AND_HEIGHT',
            }),
          ),
        ),
      ),
    );
  });

  children.push(row({ gap: 24, justify: 'center' }, ...testimonialCards));

  return sectionFrame('Testimonials', fills, rest, 80, 80, stack({ gap: 48 }, ...children));
}

// ─── 5. CTA Section ─────────────────────────────────────────

export function ctaSection(props: {
  headline: string;
  subheadline?: string;
  primaryCta?: string;
  secondaryCta?: string;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { headline, subheadline, primaryCta, secondaryCta, fills, ...rest } = props;

  const children: NodeBlueprint[] = [];

  children.push(heading(headline, { level: 2, textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER' }));

  if (subheadline) {
    children.push(body(subheadline, {
      muted: true,
      fontSize: 18,
      textAlignHorizontal: 'CENTER',
      layoutAlignSelf: 'CENTER',
    }));
  }

  if (primaryCta || secondaryCta) {
    const buttons: NodeBlueprint[] = [];
    if (primaryCta) buttons.push(button(primaryCta, { variant: 'filled', size: 'lg' }));
    if (secondaryCta) buttons.push(button(secondaryCta, { variant: 'outline', size: 'lg' }));
    children.push(row({ gap: 16, justify: 'center' }, ...buttons));
  }

  return sectionFrame('CTA', fills, rest, 120, 80,
    center({ gap: 24 }, ...children),
  );
}

// ─── 6. Footer Section ─────────────────────────────────────

export function footerSection(props: {
  copyright: string;
  links?: string[];
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { copyright, links, fills, ...rest } = props;

  const leftSide = rawText(copyright, {
    fontSize: 13,
    fontWeight: 400,
    opacity: 0.5,
    textAutoResize: 'WIDTH_AND_HEIGHT',
  });

  const rightSide = links && links.length > 0
    ? row({ gap: 24 },
        ...links.map(l => link(l, {
          fontSize: 13,
          fontWeight: 400,
          opacity: 0.5,
          textDecoration: 'NONE',
          color: DEFAULTS.textMuted,
        })),
      )
    : undefined;

  const rowChildren: NodeBlueprint[] = [leftSide];
  if (rightSide) rowChildren.push(rightSide);

  return sectionFrame('Footer', fills, rest, 32, 80,
    row({ justify: 'between', align: 'center' }, ...rowChildren),
  );
}

// ─── 7. Navbar Section ──────────────────────────────────────

export function navbarSection(props: {
  brand: string;
  links?: string[];
  cta?: string;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { brand, links: navLinks, cta, fills, ...rest } = props;

  const leftSide = rawText(brand, {
    name: 'Brand',
    fontSize: 20,
    fontWeight: 700,
    textAutoResize: 'WIDTH_AND_HEIGHT',
  });

  const navChildren: NodeBlueprint[] = [leftSide];

  // Center links
  if (navLinks && navLinks.length > 0) {
    navChildren.push(
      row({ gap: 4 }, ...navLinks.map(l => navItem(l))),
    );
  }

  // Right CTA
  if (cta) {
    navChildren.push(button(cta, { variant: 'filled', size: 'sm' }));
  }

  return sectionFrame('Navbar', fills, rest, 16, 80,
    row({ justify: 'between', align: 'center' }, ...navChildren),
  );
}

// ─── 8. Logo Bar ────────────────────────────────────────────

export function logoBar(props: {
  title?: string;
  logos: string[];
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { title, logos, fills, ...rest } = props;

  const children: NodeBlueprint[] = [];

  if (title) {
    children.push(center({},
      label(title, { textAlignHorizontal: 'CENTER', layoutAlignSelf: 'CENTER', textCase: 'UPPER', letterSpacing: 1 }),
    ));
  }

  const logoItems = logos.map(name =>
    rawText(name, {
      fontSize: 18,
      fontWeight: 600,
      opacity: 0.3,
      textAutoResize: 'WIDTH_AND_HEIGHT',
    }),
  );

  children.push(row({ gap: 48, justify: 'center', align: 'center' }, ...logoItems));

  return sectionFrame('LogoBar', fills, rest, 48, 80, stack({ gap: 24 }, ...children));
}

// ─── 9. Stats Bar ───────────────────────────────────────────

export function statsBar(props: {
  stats: Array<{ value: string; label: string }>;
  fills?: any[];
} & StyleOverrides): NodeBlueprint {
  const { stats: statsData, fills, ...rest } = props;

  const items: NodeBlueprint[] = [];
  statsData.forEach((s, i) => {
    if (i > 0) {
      items.push(rawRect({
        name: 'Divider',
        width: 1,
        height: 48,
        fills: [solid(DEFAULTS.text, 0.1)],
      }));
    }
    items.push(stat(s.value, s.label));
  });

  return sectionFrame('Stats', fills, rest, 48, 80,
    row({ gap: 48, justify: 'center', align: 'center' }, ...items),
  );
}
