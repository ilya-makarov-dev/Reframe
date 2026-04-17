# Example: three-issue critique

Typical case. Scene compiles clean but has real issues. Critic surfaces ≤3.

## Trigger

User types:
```
review this pricing page
```

Scene has 3 equal tiers, Stripe brand loaded, fabricated "40,000 teams" metric, etc.

## Step 1 — inspect

```ts
reframe_inspect({ sceneId: "s13", includeSemantic: true })
```

Result:

```
audit: all ok (clean)
aesthetic: {
  alignment: 0.91, whitespace: 0.84, balance: 0.79,
  harmony: 0.88, hierarchy: 0.58,   ← LOW
  rhythm: 0.82, readability: 0.89, proportion: 0.81,
  overall: 0.81
}
brandFidelity: 0.74   ← LOW (−0.21 from expected)
semantic: [
  { role: 'nav', nodeId: 'n1' },
  { role: 'hero', nodeId: 'n2' },
  { role: 'pricing-grid', nodeId: 'n3' },  ← 3 equal tiers as children
  { role: 'pricing-tier', nodeId: 'n3a' },
  { role: 'pricing-tier', nodeId: 'n3b' },
  { role: 'pricing-tier', nodeId: 'n3c' },
  { role: 'trust-anchor', nodeId: 'n4' },  ← contains fabricated metric
  { role: 'footer', nodeId: 'n5' }
]
```

Read Stripe DESIGN.md and confirm:
- Requires `font-feature-settings: 'ss01', 'tnum'` on every text node
- One accent color `#635BFF` only

## Step 2 — rank pool

Candidates:
1. **hierarchy 0.58** (lowest aesthetic score) — 3 equal tiers explain this
2. **brandFidelity 0.74** — investigation shows 5 numeric text nodes missing `tnum` feature
3. **slop: fake metric** — "Trusted by 40,000 teams" in trust anchor, not user-provided
4. **whitespace 0.84** — fine, above threshold
5. **balance 0.79** — borderline; could mention but lower priority

Picking top 3: hierarchy + brandFidelity + slop-signature. Whitespace + balance drop off.

## Step 3 — output

```
Three issues worth fixing:

**1. Hierarchy 0.58 — the three tiers look equally important.** The pricing grid doesn't tell the eye which plan wins. Push the "Scale" tier as recommended: +8px padding, 2px accent border (#635BFF), "Recommended" pill above it (13/600 uppercase, accent fill on white text). The middle-tier-wins pattern pulls eye and converts. *(hierarchy score)*

**2. brandFidelity 0.74 — five numeric text nodes miss Stripe's `tnum` feature.** Stripe's DESIGN.md calls for `font-feature-settings: 'ss01', 'tnum'` on every text node — especially numeric displays like prices and stat rows. Apply to nodeIds n3a-price, n3b-price, n3c-price, n4-stat1, n4-stat2. This is the single biggest visible brand miss. *(brandFidelity − 0.21 from expected)*

**3. "Trusted by 40,000 teams" — fabricated metric, user didn't provide this.** The trust anchor has an invented number that reads as fake-social-proof. Either (a) replace with neutral "Trusted by engineering teams" (no number), or (b) remove the section entirely if you don't have real proof. *(slop signature: fabricated content)*

Rhythm 0.82, alignment 0.91, harmony 0.88 — rest holds. Want me to apply these?
```

## Step 4 — user responds

```
yes apply
```

## Step 5 — execute

```ts
// Fix 1 — emphasize middle tier
reframe_edit({ sceneId: "s13", op: "update", nodeId: "n3b",
  changes: {
    paddingTop: 56, paddingBottom: 56,
    borderWidth: 2, borderColor: "#635BFF"
  }
})
reframe_edit({ sceneId: "s13", op: "add", parentId: "n3b", type: "FRAME",
  props: {
    name: "recommended-pill",
    background: "#635BFF", color: "#FFFFFF",
    paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4,
    borderRadius: 999,
    fontSize: 13, fontWeight: 600, letterSpacing: 0.04,
    textTransform: "uppercase",
    characters: "Recommended"
  }
})

// Fix 2 — apply OpenType to numeric nodes
for (const id of ["n3a-price", "n3b-price", "n3c-price", "n4-stat1", "n4-stat2"]) {
  reframe_edit({ sceneId: "s13", op: "update", nodeId: id,
    changes: { fontFeatureSettings: "'ss01', 'tnum'" }
  })
}

// Fix 3 — replace fake metric
reframe_edit({ sceneId: "s13", op: "update", nodeId: "n4-headline",
  changes: { characters: "Trusted by engineering teams" }
})
```

## Step 6 — verify

```ts
reframe_inspect({ sceneId: "s13" })
```

New scores:
```
hierarchy: 0.58 → 0.84
brandFidelity: 0.74 → 0.95
```

## Step 7 — report delta

```
Applied 3 fixes:
  · hierarchy 0.58 → 0.84 (middle-tier emphasis worked)
  · brandFidelity 0.74 → 0.95 (OpenType applied to all 5 numeric nodes)
  · trust anchor now neutral
Audit still clean. Done.
```

## Commentary

- **Exactly 3 items, ranked by severity** — hierarchy first (lowest aesthetic score), brandFidelity second (biggest visible brand regression), slop-signature third (LLM-only value-add)
- **Each item cites its metric** — hierarchy 0.58, brandFidelity 0.74, slop signature
- **Each fix has concrete parameters** — nodeIds, exact hex, exact feature string
- **Rest-holds line** tells user rhythm / alignment / harmony are fine
- **Ends with "Want me to apply?"** — callable
- **Post-execution delta** — shows the fixes actually moved the scores
