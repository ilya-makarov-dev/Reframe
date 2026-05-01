# Editorial — Monocle

> Category: Direction (no-brand seed)
> Print-magazine feel. Generous whitespace, large serif headlines, restrained palette of off-white paper + ink + a single warm accent. Confident, quietly intelligent.

## Visual Theme & Atmosphere

Print-magazine on screen. Off-white paper. Ink fg. One warm rust/clay accent, used at most twice per page. Borders + whitespace do the structural work — never shadows. References: Monocle, The Financial Times Weekend, NYT Magazine, It's Nice That.

## Color Palette & Roles

- **Background:** `#f9f4ec` — off-white paper <!-- ADAPT: source = oklch(97% 0.012 80) -->
- **Surface:** `#fefbf8` — elevated content cards <!-- ADAPT: source = oklch(99% 0.005 80) -->
- **Foreground:** `#1d140d` — ink <!-- ADAPT: source = oklch(20% 0.02 60) -->
- **Muted:** `#645c55` — captions, kickers, metadata <!-- ADAPT: source = oklch(48% 0.015 60) -->
- **Border:** `#dfdad2` — hairlines on cards/dividers <!-- ADAPT: source = oklch(89% 0.012 80) -->
- **Accent:** `#c64e31` — warm rust / clay, used at most twice per screen <!-- ADAPT: source = oklch(58% 0.16 35) -->

Never pure black; never pure white for backgrounds.

## Typography Rules

- **Display / headings:** `'Iowan Old Style', 'Charter', Georgia, serif`, weight 600
- **Body:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`, weight 400
- **Mono:** `ui-monospace, 'IBM Plex Mono', Menlo, monospace` — metadata only (kicker, eyebrow, caption)
- Scale (px): 12 · 14 · 16 · 20 · 28 · 40 · 56 · 80
- Line-height: 1.55 for body, 1.1 for display
- Letter-spacing: -0.02em on display sizes ≥ 40px; +0.06em uppercase tracking on mono kickers
- font-feature-settings: `"liga" 1, "kern" 1` <!-- ADAPT: no OpenType features specified upstream -->

## Component Stylings

- **Buttons:** **0px** radius (or 2px max), 1px foreground border, transparent fill on secondary; accent fill on primary with off-white label. 12px padding-block, 22px padding-inline. Min height 44px.
- **Cards:** surface background, 1px border (`#dfdad2`), **0px radius** — magazine page panels, not "cards". 32px internal padding. No shadow ever.
- **Inputs:** underline only (no box). 1px muted baseline. Foreground baseline on focus. 14px vertical padding.
- **Badge:** mono uppercase, accent text on `surface`, hairline border, 0px radius, 4px / 8px padding.
- **Nav:** serif wordmark or fg-only. Mono small caps for nav links (12-14px, +0.08em tracking, uppercase).
- **Links:** accent on hover only, foreground at rest, 1px accent-at-40% underline.

## Layout Principles

- 12-column grid, 1100px max-width, 32px gutters.
- Hero: one decisive image, cropped only at the bottom edge, captioned in mono.
- Section spacing: 96px desktop, 64px tablet, 40px phone.
- Asymmetric column splits favored (5/7, 4/8). Avoid 3-equal-cards.
- Kicker / eyebrow above each major section (mono uppercase, accent or muted).
- One decisive image per spread; no clipart, no abstract gradient blobs.

## Depth & Elevation

Flat. **No shadows anywhere.** Borders + whitespace do everything shadows would. The only acceptable "elevation" is z-index for fixed nav. No neumorphism, no glassmorphism, no inner glows.

## Do's and Don'ts

- ✅ Serif display, sans body, mono for metadata only.
- ✅ One decisive image per spread, captioned in mono.
- ✅ Kicker / eyebrow in mono uppercase as section label.
- ✅ Accent used at most twice per page.
- ❌ No shadows, no rounded cards.
- ❌ No gradient backgrounds.
- ❌ No emoji as iconography (text emoji in body copy is fine).
- ❌ No 3-equal-cards-horizontally layout.

## Responsive Behavior

- **Desktop ≥ 1024px:** 12-col grid, full hero with bottom-cropped image.
- **Tablet 640–1023px:** 8-col grid, hero image inline above headline.
- **Phone < 640px:** 4-col grid, hero image stacked above headline; mono kickers at 11px.

## Agent Prompt Guide

- Lead with whitespace and serif headlines. Chrome (borders) is subtractive, not additive.
- Honor the single-accent rule. Two uses max per screen. Three is a regression.
- If the brief calls for "modern" or "techy", this direction is the wrong choice — pick `modern-minimal` or `tech-utility`.
- Use real or specific copy. Never write "Trusted by 40k engineers" — use neutral "trusted by teams" or leave a stub.
- Mono is for metadata only (kickers, captions, timestamps, IDs) — never body copy.
- This direction's posture: **borders + whitespace do the work, not shadows or radii.**
