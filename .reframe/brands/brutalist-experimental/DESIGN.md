# Brutalist / Experimental — Are.na / Yale

> Category: Direction (no-brand seed)
> Loud type. Visible grid. System sans + a single oversized serif. Deliberate ugliness as confidence. Great for art, indie, agency, manifesto pages.

## Visual Theme & Atmosphere

Off-white printer paper. Oversized serif for display, monospace for body — yes, monospace as body, deliberately. Borders are full-strength foreground, not muted greys. Asymmetric layouts, almost no border-radius. References: Are.na, Yale Center for British Art, mschf, Read.cv.

## Color Palette & Roles

- **Background:** `#f2f2ef` — off-white printer paper <!-- ADAPT: source = oklch(96% 0.004 100) -->
- **Surface:** `#ffffff` — content panels
- **Foreground:** `#0d0b03` — near-black, slight warm <!-- ADAPT: source = oklch(15% 0.02 100) -->
- **Muted:** `#4a483c` — secondary, captions <!-- ADAPT: source = oklch(40% 0.02 100) -->
- **Border:** `#0d0b03` — borders are full-strength foreground (1.5–2px) <!-- ADAPT: source = oklch(15% 0.02 100); intentional same as fg -->
- **Accent:** `#e62b34` — hot red, used decisively (links, single decisive flourish) <!-- ADAPT: source = oklch(60% 0.22 25) -->

Never pure black (#000); use the warm-shifted near-black above. Never pure white for backgrounds.

## Typography Rules

- **Display / headings:** `'Times New Roman', 'Iowan Old Style', Georgia, serif`, weight 400
- **Body:** `ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace`, weight 400
- **Mono:** same as body (intentional)
- Scale (px): 12 · 14 · 16 · 20 · 28 · 56 · 96 · 160
- Line-height: 1.5 for body, 0.95 for display
- Letter-spacing: -0.01em on display sizes; default elsewhere
- Display sizes can use `clamp(80px, 12vw, 200px)` for hero — extreme is the point
- font-feature-settings: `"liga" 1, "kern" 1` <!-- ADAPT: no OpenType features specified upstream -->

## Component Stylings

- **Buttons:** **0px or 2px** radius, **2px solid foreground border**, transparent fill on secondary; foreground fill with bg label on primary. 12px padding-block, 20px padding-inline. Underline links instead of buttons where possible. Min height 44px.
- **Cards:** surface background, **2px solid foreground border** (not muted), 0px or 2px radius, 24px internal padding. **No shadow ever.**
- **Inputs:** 2px solid foreground baseline (underline only), 0px radius, mono text, 12px vertical padding.
- **Badge:** mono uppercase, 2px solid foreground border, 0px radius, accent text or fg text. 4px / 8px padding.
- **Nav:** mono nav links, all-lowercase or all-caps (pick one). 2px solid foreground bottom border on the nav strip.
- **Links:** underlined at rest (1px solid fg or accent), no hover decoration — let the typography carry it.

## Layout Principles

- **12-column grid, visible.** Use `outline: 1px dashed muted` on grid containers in development.
- 1280px max-width, 32px gutters.
- Asymmetric splits favored: 70/30, 60/40, never 33/33/33.
- Hero: oversized serif display (clamp(80px, 12vw, 200px)). Off-grid placement allowed.
- Section spacing: 64-128px desktop, vertical rhythm matters.
- One decisive accent flourish per page. Hot red on a single link, single mark, single moment.

## Depth & Elevation

Flat. **No shadows. No gradients. No glassmorphism.** Borders are 2px solid foreground; that's the entire elevation system.

## Do's and Don'ts

- ✅ Display = serif at extreme sizes (clamp(80px, 12vw, 200px)).
- ✅ Body = monospace, deliberately. (Yes, monospace as body.)
- ✅ Borders are full-strength foreground (1.5–2px), not muted greys.
- ✅ Asymmetric layouts: one column 70%, the other 30%.
- ✅ Underline links, no hover decoration.
- ✅ One decisive accent flourish per page (hot red).
- ❌ Almost no border-radius (0–2px max).
- ❌ No shadows.
- ❌ No gradients.
- ❌ No 3-equal-cards-horizontally — asymmetry only.
- ❌ No emoji as iconography.

## Responsive Behavior

- **Desktop ≥ 1024px:** asymmetric grid, full hero with extreme display sizing.
- **Tablet 640–1023px:** 70/30 collapses to stacked but borders stay 2px.
- **Phone < 640px:** single column; hero display drops to clamp(56px, 14vw, 80px); mono body stays.

## Agent Prompt Guide

- This is the right pick for art, indie, agency, manifesto, gallery pages — anywhere the brief embraces *deliberate ugliness as confidence*.
- The serif display + mono body pairing is the soul. Don't soften to sans body — that flattens the direction.
- Borders are 2px solid foreground. Not 1px hairline grey. Not no-border.
- Asymmetry is the rule. 70/30 / 60/40 / off-grid placement. Never 3-equal-cards.
- One accent flourish per page. Hot red on a single decisive moment — not on every link, not on every CTA.
- Underline links. Don't button-ify them. The typography carries it.
- Display sizes can be extreme (96-200px). The discomfort is the point.
- This is a confident direction; commit fully. Half-brutalist looks like a mistake.
