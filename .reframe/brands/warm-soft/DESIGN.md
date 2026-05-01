# Warm & Soft — Stripe pre-2020 / Headspace

> Category: Direction (no-brand seed)
> Cream backgrounds, soft accent, gentle radii. Reads like a thoughtful product magazine — friendly without being cute. Good for fintech, wellness, indie SaaS.

## Visual Theme & Atmosphere

Warm cream paper, soft serif display + sans body. One terracotta accent at most twice per page. Gentle radii (12-16px). No hard 0px corners on content. References: Stripe pre-2020, Headspace, Substack, Mercury.

## Color Palette & Roles

- **Background:** `#fdf3e8` — warm cream <!-- ADAPT: source = oklch(97% 0.018 70) -->
- **Surface:** `#fffbf6` — elevated cards <!-- ADAPT: source = oklch(99% 0.008 70) -->
- **Foreground:** `#221812` — near-black, warm <!-- ADAPT: source = oklch(22% 0.02 50) -->
- **Muted:** `#6c605a` — secondary text, metadata <!-- ADAPT: source = oklch(50% 0.018 50) -->
- **Border:** `#e4ddd4` — soft hairline <!-- ADAPT: source = oklch(90% 0.014 70) -->
- **Accent:** `#cf6a5f` — terracotta; primary CTA + one editorial flourish <!-- ADAPT: source = oklch(64% 0.13 28) -->

Never pure black; never pure white for backgrounds.

## Typography Rules

- **Display / headings:** `'Tiempos Headline', 'Newsreader', 'Iowan Old Style', Georgia, serif`, weight 500
- **Body:** `'Söhne', -apple-system, BlinkMacSystemFont, system-ui, sans-serif`, weight 400
- **Mono:** `ui-monospace, 'JetBrains Mono', monospace` — code blocks only
- Scale (px): 12 · 14 · 16 · 20 · 28 · 40 · 56 · 80
- Line-height: 1.6 for body, 1.15 for display
- Letter-spacing: -0.015em on display sizes ≥ 40px; default elsewhere
- font-feature-settings: `"liga" 1, "kern" 1` <!-- ADAPT: no OpenType features specified upstream -->

## Component Stylings

- **Buttons:** 14px radius (gentle), 12px padding-block, 22px padding-inline, weight 500. Primary = terracotta fill, cream label. Secondary = 1px foreground border, transparent fill. Min height 44px.
- **Cards:** surface background, 1px soft border (`#e4ddd4`), 16px radius, 28px internal padding. **Soft inner glow** instead of drop shadow on hero cards: `inset 0 1px 0 rgba(255, 255, 255, 0.6)`.
- **Inputs:** 1px border, 12px radius, 14px vertical padding, terracotta border on focus.
- **Badge:** 4px / 10px padding, 999px radius (pill), accent text on cream-tinted fill.
- **Nav:** transparent over cream bg; serif wordmark; sans nav links 14-15px.
- **Links:** terracotta, 1px terracotta-at-40% underline at rest, no underline on hover (swap for terracotta-at-8% background).

## Layout Principles

- 12-column grid, 1200px max-width, 24px gutters.
- Hero: serif display headline, 56-80px. One real photograph or illustration, never abstract gradient.
- Section spacing: 96px desktop, 64px tablet, 40px phone.
- Avoid icon noise. Use real photography, screenshots, or illustration when possible.
- Single accent: primary CTA + ONE editorial flourish (a quote mark, a stat, a callout).

## Depth & Elevation

Two levels:
- **Flat (0):** default; soft border carries separation.
- **Raised (1):** hover state on cards, modals. **Soft inner glow** preferred over drop shadow on hero cards. If shadow is needed: 0 2px 16px rgba(34, 24, 18, 0.06).

No neumorphism. No heavy drop shadows.

## Do's and Don'ts

- ✅ Serif display, soft sans body.
- ✅ Gentle radii (12-16px) on content cards.
- ✅ Real photographs / illustrations — not abstract gradients or stock vectors.
- ✅ Single accent: CTA + one editorial flourish.
- ❌ No hard 0px corners on content cards.
- ❌ No iconography next to every heading.
- ❌ No drop shadows on inputs.
- ❌ No invented stats ("10× faster") — use specific or honest placeholders.

## Responsive Behavior

- **Desktop ≥ 1024px:** 12-col grid; full hero with photograph.
- **Tablet 640–1023px:** 8-col grid; hero photograph stacks above text.
- **Phone < 640px:** 4-col grid; hero photograph 100% width, text below; -33% padding.

## Agent Prompt Guide

- Lean into warmth: cream + terracotta + serif is the soul of this direction.
- One editorial flourish per page. A pull quote, a big number with serif tnum digits, an oversized capital letter — pick one.
- Honor the photograph rule: prefer real imagery to stock vectors, gradients, or AI illustrations.
- Avoid icons-next-to-every-heading. Editorial pages don't need that decoration.
- Single accent: CTA + one flourish max. A second terracotta usage is a regression.
- Numbers in serif when they matter (pricing, stats) — pairs with the display family.
