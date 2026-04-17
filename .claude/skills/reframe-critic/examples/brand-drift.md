# Example: critique after brand drift

Scene was compiled with Stripe brand but the generated HTML drifted — wrong accent saturation, missing OpenType, one off-palette color snuck in. Critic catches it as brand-focused issue.

## Trigger

User typed (as last message of a design session):
```
how does this feel like Stripe?
```

## Step 1 — inspect + read DESIGN.md

```ts
reframe_inspect({ sceneId: "s21", includeSemantic: true })
Read(".reframe/brands/stripe/DESIGN.md")
```

Result:

```
audit: clean
aesthetic: all above 0.80 (hierarchy 0.87, rhythm 0.85, alignment 0.89...)
brandFidelity: 0.68   ← SIGNIFICANT DROP
```

DESIGN.md specifies:
- Accent: `#635BFF` (the ONLY high-saturation color)
- `font-feature-settings: 'ss01', 'tnum'` on every text node
- Subtle shadows only (0-4px range)

Scan the scene:
- One surface uses `#6366F1` (close to accent but not exact — 20° hue drift, different saturation)
- Text nodes missing `tnum` on numeric display (price, stat row)
- One card uses 12px shadow instead of 4px (too dramatic)
- Headline color uses `#F6F9FC` correctly ✅
- Radii correct ✅

## Step 2 — rank pool

Aesthetics all above 0.80 — nothing to flag there. Audit clean. The **only** issue class is brand drift. Pool:

1. brandFidelity 0.68 — decompose into sub-issues:
   - 1a. Off-palette accent `#6366F1` on cards (wrong hex)
   - 1b. Missing OpenType on 4 text nodes
   - 1c. Shadow too dramatic (12px vs brand's 0-4px range)

Since all three map to "brand drift", rank as the top-3 items under that umbrella. This is the unusual case where all 3 items are in one class.

## Step 3 — output

```
Three issues, all brand drift. brandFidelity 0.68 — this reads almost-Stripe but off:

**1. Off-palette accent on cards — `#6366F1`, not brand's `#635BFF`.** Small hex drift but visually obvious to anyone who knows Stripe. Two card backgrounds on surface n3b, n3c use #6366F1; replace with exact brand accent `#635BFF`. *(brandFidelity: palette mismatch)*

**2. Four numeric text nodes missing `tnum` OpenType — price rows look like default figures.** Stripe's DESIGN.md calls for `font-feature-settings: 'ss01', 'tnum'` on every text node, especially numeric. Apply to nodeIds n7-price, n8-price, n9-stat-value, n10-stat-value. Missing `tnum` = numbers don't align vertically = instant "not Stripe" tell. *(brandFidelity: feature coverage)*

**3. Card shadows too dramatic — 12px, brand specifies 0-4px subtle range.** Stripe's visual signature includes "quiet" shadows. Cards at `box-shadow: 0 12px 24px rgba(0,0,0,0.18)` feel like a different brand. Reduce to `0 2px 8px rgba(0,0,0,0.06)`. *(brandFidelity: shadow drift)*

Aesthetic scores all ≥ 0.85, audit clean — structure and layout are fine. This is purely a brand-adherence issue. Want me to apply these three, then re-check brandFidelity?
```

## Step 4 — user responds

```
yes
```

## Step 5 — execute

```ts
// Fix 1 — accent drift
reframe_edit({ sceneId: "s21", op: "update", nodeId: "n3b",
  changes: { background: "#635BFF" } })
reframe_edit({ sceneId: "s21", op: "update", nodeId: "n3c",
  changes: { background: "#635BFF" } })

// Fix 2 — OpenType
for (const id of ["n7-price", "n8-price", "n9-stat-value", "n10-stat-value"]) {
  reframe_edit({ sceneId: "s21", op: "update", nodeId: id,
    changes: { fontFeatureSettings: "'ss01', 'tnum'" } })
}

// Fix 3 — shadow dampening
reframe_edit({ sceneId: "s21", op: "update", nodeId: "n3b",
  changes: { shadowBlur: 8, shadowY: 2, shadowColor: "rgba(0,0,0,0.06)" } })
reframe_edit({ sceneId: "s21", op: "update", nodeId: "n3c",
  changes: { shadowBlur: 8, shadowY: 2, shadowColor: "rgba(0,0,0,0.06)" } })
```

## Step 6 — verify

```ts
reframe_inspect({ sceneId: "s21" })
```

Result:
```
brandFidelity: 0.68 → 0.94
aesthetic: (unchanged — still all ≥ 0.85)
audit: still clean
```

## Step 7 — report

```
Applied 3 brand fixes:
  · accent normalized on 2 cards (#6366F1 → #635BFF)
  · OpenType features added on 4 numeric nodes
  · card shadows dampened (12px → 2px)

brandFidelity 0.68 → 0.94. Now reads authentically Stripe. Audit still clean,
aesthetics unchanged. Done.
```

## Commentary

This example shows:

- **All 3 items in one class** (brand drift) — unusual but happens when aesthetics are fine and the scene just misses brand signals
- **Sub-issue decomposition of a single metric** — brandFidelity 0.68 breaks into palette / OpenType / shadow causes
- **Explicit "structure and layout are fine"** — reassures user that nothing big is wrong
- **Exact hex comparisons** — `#6366F1` vs `#635BFF` (20° hue shift) shows the critic actually compared values
- **End-state delta** — brandFidelity 0.68 → 0.94 is the single most important number to report

## When this pattern happens in the wild

- Long design session where the AI generator drifted token values across many edits
- Scene re-compiled after a brand was refreshed — new tokens didn't propagate everywhere
- Hybrid brand scenarios where two brands' values got mixed accidentally
- User's HTML had handcoded hexes instead of reading from DESIGN.md

Brand drift is the highest-value critic signal for users iterating on "does this look like X?" requests.
