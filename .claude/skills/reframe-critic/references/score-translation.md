# Score translation — engine metric → human critique + fix

The engine's aesthetic module (see [../../reframe-design/references/tool-schemas.md](../../reframe-design/references/tool-schemas.md)) emits 8 scores 0..1 per scene, plus `brandFidelity`. This reference maps each low score to:
- What it **means** in design terms
- The **first-ask fix** (specific, concrete)
- Whether it's typically a `reframe_edit` (property fix) or a source rewrite

## Aesthetic scores

### `alignment` (weight 0.15)

**What it measures.** Edges / centers / midpoints across sections lining up on a consistent grid. Penalizes mixed left-margins, center-aligned blocks inside left-aligned sections, visual "wobble".

**Low (< 0.7) means.** Sections don't share a grid. Content looks pasted together.

**First-ask fix.** Pick one grid (usually 12-col at 1440px with 24-32px gutters) and snap all section content to the same `paddingLeft` / `paddingRight`. `reframe_edit` on each section's left padding.

### `whitespace` (weight 0.15)

**What it measures.** Padding/margin consistency + breathing room. Penalizes dense-then-sparse alternation without rhythm, sections with zero vertical padding, content butting up against edges.

**Low (< 0.6) means.** Padding feels random — dense here, empty there.

**First-ask fix.** Pick one vertical rhythm (usually 64 / 96 / 128) based on section importance and apply consistently. `reframe_edit` on section `paddingTop` / `paddingBottom`.

### `balance` (weight 0.10)

**What it measures.** Visual weight distribution. Penalizes scenes where one side is heavy (large images / dark blocks) with nothing counterweighting.

**Low (< 0.6) means.** Layout skews to one side without a reason.

**First-ask fix.** Either (a) commit to asymmetric and add a counterweight element (small text block, data mockup, secondary CTA), OR (b) re-center the mass by redistributing content. Usually a source rewrite, not a single edit.

### `harmony` (weight 0.15)

**What it measures.** Color palette coherence. Penalizes clashing hues (opposite on the wheel), saturation all over the place, too many accent colors.

**Low (< 0.7) means.** Palette fights itself — hues clash or saturation is uneven.

**First-ask fix.** Drop to **one** accent color; desaturate or de-emphasize all others. `reframe_edit` on offending nodes' `background` / `color`. If multiple high-sat colors are needed by brand, they should be in the DESIGN.md — check for palette drift.

### `hierarchy` (weight 0.15)

**What it measures.** Visual weight distinction between primary / secondary / tertiary elements. Penalizes equal-sized everything, same-weight CTAs, flat type scale.

**Low (< 0.7) means.** Primary and secondary elements look equally important.

**First-ask fix.** Push contrast. Specifically:
- Size ratio ≥ 1.5× between primary and secondary headlines
- Weight jump (400 → 700, not 500 → 600)
- Color: primary on accent / text-primary, secondary on muted
- Whitespace: more breathing room around primary

`reframe_edit` on the specific nodes.

### `rhythm` (weight 0.10)

**What it measures.** Vertical spacing consistency. Specifically: padding / margin / gap hitting a regular grid (4 or 8 px).

**Low (< 0.6) means.** Gaps don't snap to a base grid (you'll see 24 / 28 / 32 mixed with 24 / 23 / 25).

**First-ask fix.** Snap all vertical spacing to 8px grid. `reframe_edit update` on each node's spacing props. Usually a batch of 10-30 small edits — consider source rewrite if > 30.

### `readability` (weight 0.10)

**What it measures.** Typography fitness for reading — line length, line-height, contrast, font-size at body role.

**Low (< 0.7) means.** Reading is friction-heavy (line too wide, leading too tight, contrast too low).

**First-ask fix.** Body: max-width ≤ 70ch, line-height 1.5-1.7, contrast ≥ 4.5:1, size ≥ 16px. `reframe_edit` on body / paragraph nodes.

### `proportion` (weight 0.10)

**What it measures.** Element size ratios feel intentional (hero ~50vh, body blocks on consistent ratios like 3:2 or 4:3).

**Low (< 0.6) means.** Element sizes feel arbitrary — mid-page image too small, buttons too big, sections randomly sized.

**First-ask fix.** Relative-to-root rules:
- Hero: 40-60vh (not 200px fixed)
- Cards: consistent aspect (1:1 square or 3:2)
- Buttons: 44-48px height, padding proportional

Usually needs multiple edits OR a source rewrite with intentional sizing.

## `brandFidelity`

Not part of aesthetic scores — separate metric. Scale 0..1; target ≥ 0.85 for a well-branded scene.

### What makes it drop

- **Missing OpenType features** (`font-feature-settings` not applied to text nodes when brand DESIGN.md specifies them) — **most common cause**, usually 0.15-0.25 drop
- **Off-palette colors** (any hex in the scene not derivable from DESIGN.md palette)
- **Wrong type family** (scene uses fallback instead of brand's specified font)
- **Non-token radii** (scene uses 8px when brand says 24px for buttons)
- **Non-token spacing** (scene uses 23px when brand's grid is 4/8/16/24/32)

### First-ask fix by cause

| Drop | Cause signature | Fix |
|---|---|---|
| −0.15 to −0.25 | One or more text nodes without `font-feature-settings` | `reframe_edit update` on those nodes with the brand's features |
| −0.08 to −0.15 | Off-palette color on surface / accent | `reframe_edit update` on the node's `background` / `color` to brand's exact hex |
| −0.20+ | Wrong font family loaded | Source rewrite — Compile was missing font, need to fix at source and recompile |
| −0.05 to −0.10 | Non-token radius | `reframe_edit update` on node's `cornerRadius` to brand's token value |

**Always state the specific fix with the specific hex / token value.** Don't say "fix the brand issues" — say "apply `font-feature-settings: 'ss01', 'tnum'` to the 3 numeric text nodes (IDs n7, n12, n15)".

## Priority order when multiple scores are low

If you have 5 candidates and can pick only 3 (per the rules):

1. **Audit fails** are automatic — they're blocking.
2. **brandFidelity < 0.8** — single most-visible design regression.
3. **Lowest single aesthetic score** — user's eye lands there first.
4. **Slop signature** from [slop-signatures.md](slop-signatures.md) — LLM-only value-add.
5. **Second-lowest aesthetic score** — if room remains.

Ignore:
- Aesthetic scores already above 0.8 (they're fine)
- brandFidelity 0.8-0.85 (acceptable; flag only if > 0.2 drop from an expected baseline)
- Multiple low scores from the same underlying cause (e.g. hierarchy + rhythm both low because of missing grid) — flag once with the root cause

## How to cite in the critique

Every critic item must cite the metric. Format:

> **1. [problem]** — [fix] — *[metric name] [value]*

Example:

> **2. brandFidelity 0.74 — the stat block renders default digits.** Stripe's DESIGN.md calls for `font-feature-settings: 'ss01', 'tnum'`. Apply to every numeric text node (IDs n7, n12, n15); single biggest visible brand miss.

Citation includes: metric (brandFidelity), value (0.74), specific nodes (n7, n12, n15), specific fix (feature string).

## Related

- [slop-signatures.md](slop-signatures.md) — LLM-only patterns (NOT metric-based)
- [critique-format.md](critique-format.md) — exact output shape
- [../../reframe-design/references/tool-schemas.md](../../reframe-design/references/tool-schemas.md) — reframe_inspect return shape
