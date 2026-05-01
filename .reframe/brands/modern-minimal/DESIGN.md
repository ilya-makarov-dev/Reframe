# Modern Minimal — Linear / Vercel

> Category: Direction (no-brand seed)
> Quiet, precise, software-native. System fonts, near-greyscale palette, a single saturated accent. The chrome disappears so content is the only thing that registers.

## Visual Theme & Atmosphere

Software-native, content-led, near-greyscale. One saturated cobalt accent for links and the primary CTA. Hairline borders only. No hero illustrations. References: Linear, Vercel, Notion 2024, Stripe docs.

## Color Palette & Roles

- **Background:** `#fbfcfd` — near-white with cool undertone <!-- ADAPT: source = oklch(99% 0.002 240) -->
- **Surface:** `#ffffff` — cards, modals
- **Foreground:** `#0e1217` — near-black, slight cool tint <!-- ADAPT: source = oklch(18% 0.012 250) -->
- **Muted:** `#6a6f76` — secondary text, captions <!-- ADAPT: source = oklch(54% 0.012 250) -->
- **Border:** `#e2e5e8` — hairline dividers <!-- ADAPT: source = oklch(92% 0.005 250) -->
- **Accent:** `#1779e1` — cobalt; links + primary CTA only <!-- ADAPT: source = oklch(58% 0.18 255) -->

Never pure black; never pure white for backgrounds.

## Typography Rules

- **Display / headings:** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif`, weight 600
- **Body:** `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif`, weight 400
- **Mono:** `ui-monospace, 'JetBrains Mono', monospace` — code + numerics
- Scale (px): 12 · 13 · 14 · 16 · 20 · 28 · 40 · 56
- Line-height: 1.5 for body, 1.1 for display
- Letter-spacing: -0.02em on display sizes; default elsewhere
- font-feature-settings: `"tnum" 1` on numerics (tabular figures) <!-- ADAPT: applied via inline style on numeric text -->

## Component Stylings

- **Buttons:** 6px radius, 8px padding-block, 14px padding-inline, weight 500. Primary = cobalt fill, white label, no shadow. Secondary = 1px border, transparent fill. Min height 36px on dense surfaces, 44px on hero.
- **Cards:** white, 1px border (`#e2e5e8`), 8px radius, 16px internal padding, **no shadow** unless dropdown/modal.
- **Inputs:** 1px border, 6px radius, 8px vertical padding, cobalt border on focus.
- **Badge:** 4px / 8px padding, 4px radius, muted text on neutral fill.
- **Nav:** sticky frosted (12px backdrop-blur, surface at 80% opacity), hairline bottom border. Logo on left, links right, primary CTA on far right.
- **Links:** cobalt, no underline at rest, underline on hover.

## Layout Principles

- 12-column grid, 1200px max-width, 24px gutters.
- Hero: content-led, never a centered illustration. Headline left, CTA inline below, no oversized hero image.
- Section spacing: 96px desktop, 64px tablet, 48px phone.
- Tabular numerics with `font-variant-numeric: tabular-nums` on prices, stats, dashboards.
- Single accent color: links + primary CTA. Nothing else gets cobalt.

## Depth & Elevation

Two levels only:
- **Flat (0):** default — borders carry separation.
- **Raised (1):** dropdowns, modals, frosted nav. 0 2px 8px rgba(14, 18, 23, 0.08), 12px backdrop-blur for nav.

No neumorphism, no glassmorphism beyond the frosted nav.

## Do's and Don'ts

- ✅ Tight letter-spacing on display sizes (-0.02em).
- ✅ Hairline borders only; no shadows except dropdowns/modals.
- ✅ Tabular numerics on dashboards and pricing.
- ✅ Sticky frosted nav, content-led layouts.
- ❌ No hero illustrations.
- ❌ No more than one accent color.
- ❌ No 3-equal-card features.
- ❌ No shadows on inputs or cards.

## Responsive Behavior

- **Desktop ≥ 1024px:** 12-col grid; sticky frosted nav.
- **Tablet 640–1023px:** 8-col grid; nav stays sticky; hero stacks if needed.
- **Phone < 640px:** 4-col grid; hamburger nav; section spacing -33%.

## Agent Prompt Guide

- This is the safe default for SaaS / dev-tools / B2B utility. When in doubt, this is the right pick.
- The chrome disappears: keep borders hairline, keep accent rare, let the content and type carry it.
- Single accent rule is non-negotiable: cobalt on links + primary CTA, *nothing else*.
- Avoid hero illustrations; this aesthetic relies on type and grid.
- Numerics use tabular figures — apply `font-variant-numeric: tabular-nums` on every stat/price/metric.
- One family for display + body (system stack) is intentional, not a regression.
