# Tech / Utility — Datadog / GitHub

> Category: Direction (no-brand seed)
> Data-dense, monospace-friendly, dark or light + grid. Made for engineers and operators who want information per square inch, not vibes.

## Visual Theme & Atmosphere

Information density is the feature. One sans family for display + body (utility trumps editorial). Mono everywhere identifiers / hashes / code appear. Tabular numerics by default. References: Datadog, GitHub, Cloudflare dashboard, Sentry.

## Color Palette & Roles

- **Background:** `#f6f9fc` — near-white, cool <!-- ADAPT: source = oklch(98% 0.005 250) -->
- **Surface:** `#ffffff` — tables, panels, cards
- **Foreground:** `#121c23` — near-black, slight blue undertone <!-- ADAPT: source = oklch(22% 0.02 240) -->
- **Muted:** `#5a656d` — secondary text, axis labels <!-- ADAPT: source = oklch(50% 0.018 240) -->
- **Border:** `#d9dfe3` — hairline grids and table dividers <!-- ADAPT: source = oklch(90% 0.008 240) -->
- **Accent:** `#299236` — signal green; success states, primary CTA, status pills <!-- ADAPT: source = oklch(58% 0.16 145) -->

Never pure black; never pure white for backgrounds.

## Typography Rules

- **Display / headings:** `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif`, weight 600
- **Body:** `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif`, weight 400
- **Mono:** `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace` — IDs, hashes, code, numerics
- Scale (px): 11 · 12 · 13 · 14 · 16 · 20 · 28 · 40
- Line-height: 1.45 for body, 1.2 for headings
- Letter-spacing: -0.01em on display sizes; default elsewhere
- font-feature-settings: `"tnum" 1, "zero" 1` (tabular figures + slashed zero) <!-- ADAPT: applied via inline style on all numeric text -->

## Component Stylings

- **Buttons:** 4px radius (sharp), 6px padding-block, 12px padding-inline, weight 500. Primary = signal green fill, white label. Secondary = 1px border, transparent fill. Min height 32px on dense surfaces, 44px on hero/CTA.
- **Cards:** white, 1px border (`#d9dfe3`), 6px radius, 16px internal padding, no shadow.
- **Inputs:** 1px border, 4px radius, 6px vertical padding, signal-green border on focus. Mono variant for code/identifier inputs.
- **Badge / status pill:** 2-4px padding, 4px radius, mono weight 500. Tinted background per status: success (green-at-12%), warn (amber-at-12%), danger (red-at-12%), neutral (muted-at-12%).
- **Nav:** dense; logo + tabs + search + user. 12-13px sans labels. No marketing language.
- **Links:** signal green, no underline at rest, underline on hover.
- **Tables:** dense — 8px row padding, hairline borders, no zebra striping. Mono for IDs/hashes/timestamps.

## Layout Principles

- 12-column grid, 1280px max-width, 16px gutters (tight).
- Density first: as much real product as fits without overflow. No marketing whitespace on dashboards.
- Section spacing: 48px desktop, 32px tablet, 24px phone.
- Avoid: hero images, oversized headlines, marketing copy. Show the actual product.
- Tabular numerics everywhere. IDs, timestamps, file paths in mono.

## Depth & Elevation

Three levels:
- **Flat (0):** default — borders carry separation.
- **Raised (1):** dropdowns, modals, popovers. 0 1px 4px rgba(18, 28, 35, 0.08).
- **Raised (2):** floating side-panels. 0 4px 16px rgba(18, 28, 35, 0.10).

Inline status pills with restrained tinted backgrounds (12% tint). No glassmorphism.

## Do's and Don'ts

- ✅ One sans family for display + body (utility, not editorial).
- ✅ Mono everywhere identifiers / hashes / code appear.
- ✅ Tabular numerics on every metric, table, dashboard.
- ✅ Inline status pills for success/warn/danger.
- ❌ No hero images.
- ❌ No oversized marketing headlines.
- ❌ No row striping in tables (use hairline borders).
- ❌ No emoji in product UI (text status keywords only).

## Responsive Behavior

- **Desktop ≥ 1024px:** full 12-col density.
- **Tablet 640–1023px:** 8-col, side-panel collapses to drawer.
- **Phone < 640px:** 4-col, tables become stacked key-value pairs.

## Agent Prompt Guide

- This is the right pick when the brief is "dashboard", "admin", "ops console", "data tool", "log viewer", or anything internal.
- Show the product, not a marketing pitch. Tables, charts, status pills — these carry the page.
- Mono on every ID, hash, timestamp, file path, code snippet, log line.
- Tabular figures on every number — `font-variant-numeric: tabular-nums` is non-negotiable.
- Density is the feature. 16px gutters, 8px row padding, 32-48px section spacing.
- One family is intentional. Don't pair a serif display with sans body in this direction.
- Status pills: success / warn / danger / neutral with 12% tinted backgrounds and 100% saturated borders.
