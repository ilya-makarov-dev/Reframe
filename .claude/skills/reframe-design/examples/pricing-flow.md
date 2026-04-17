# Worked example — pricing page from prompt to inspect-clean

A trace of the full `reframe-design` pipeline on a realistic request. Use this as a mental template when you face similar prompts.

## Input

User types in the bottom chat:

> Make a Stripe pricing page, 3 tiers, monthly only.

## Turn 1 — skill routing

The message names a brand ("Stripe") and asks for a new scene. Two skills involved:

1. `reframe-brand` — Stripe mentioned. Brand gate first.
2. `reframe-design` → workflow `text-to-design`.

Context preamble has already loaded the project's scene list, active brand (if set), and selected node (none).

## Turn 2 — brand gate

```ts
reframe_design({ action: "list" })
// → { brands: ["stripe", "linear", "airbnb", ...] }
```

Stripe is cached. Skip extract.

```ts
Read(".reframe/brands/stripe/DESIGN.md")
```

Notes from DESIGN.md to internalize:
- Base: `#0A2540` / text `#F6F9FC`
- Accent: `#635BFF` (one-and-only high-sat color)
- Surface elevation: `#13294B`
- Muted text: `#425466` / `#ADBDCC`
- Font: Stripe Sans (fallback Inter)
- **OpenType `ss01`, `tnum` — apply to every text node**
- Buttons: 48px height for primary, 24px border-radius (pill-ish), letter-spacing −0.01em
- Spacing grid: 8px base (48 / 64 / 96 / 120 / 160)

Hand to `text-to-design`.

## Turn 3 — write source

The agent writes the pricing HTML to `.reframe/src/pricing.html`. Key design choices:

- **Not three equal horizontal cards** — asymmetric split: recommended tier in the center, wider (58% of the tier area), with a subtle `#13294B` surface elevation and accent border. Surrounding tiers 21% each.
- **Headline size** — 72/76 with `-0.03em` tracking. Subtext 20/1.5.
- **OpenType features** applied on every element with text — price numbers, tier names, body.
- **No fake metrics** — no "Trusted by 40,000" or fake testimonials.

```ts
Write(".reframe/src/pricing.html", html)  // ~8KB
```

## Turn 4 — compile

```ts
reframe_compile({
  file: ".reframe/src/pricing.html",
  name: "pricing",
  brand: "stripe"
})
// → {
//     sceneId: "s12",
//     audit: [
//       { ruleId: "brand-fidelity", severity: "warn",
//         message: "font-feature-settings present on 18/19 text nodes" },
//     ],
//     warnings: []
//   }
```

One warning — missed the `font-feature-settings` on one text node (a small legal footnote).

## Turn 5 — inspect

```ts
reframe_inspect({ sceneId: "s12", includeSemantic: true })
// → {
//     audit: [ /* same + 1 fail on min-touch-target */ ],
//     aesthetic: {
//       alignment: 0.88, whitespace: 0.82, balance: 0.79, harmony: 0.91,
//       hierarchy: 0.84, rhythm: 0.86, readability: 0.90, proportion: 0.77,
//       overall: 0.85
//     },
//     brandFidelity: 0.92,
//     semantic: [
//       { role: "nav", nodeId: "n1" },
//       { role: "hero", nodeId: "n2" },
//       { role: "pricing-grid", nodeId: "n3" },
//       { role: "pricing-tier", nodeId: "n3a" }, /* 3 */
//       { role: "footer", nodeId: "n7" },
//     ]
//   }
```

Audit caught two things I didn't fix before:
1. `brand-fidelity warn` — 1 node missing OpenType (as above)
2. `min-touch-target fail` — the "See all plans" text link in the footer is only 32px tall

## Turn 6 — fix loop

Two fixes, both property-level, both cheap:

```ts
reframe_edit({
  sceneId: "s12",
  op: "update",
  nodeId: "<footnote-text-id>",
  changes: { fontFeatureSettings: "'ss01', 'tnum'" }
})

reframe_edit({
  sceneId: "s12",
  op: "update",
  nodeId: "<see-all-plans-link-id>",
  changes: { height: 44, paddingTop: 12, paddingBottom: 12 }
})
```

## Turn 7 — re-inspect

```ts
reframe_inspect({ sceneId: "s12" })
// → audit: all "ok", brandFidelity: 0.97, overall aesthetic: 0.87
```

Clean.

## Turn 8 — offer critic

The agent now has a clean scene and hands off to `reframe-critic` for taste review. The critic reads the same `reframe_inspect` output and finds:

> Two things worth fixing:
>
> **1. Hierarchy 0.58 on the tiers — the three plans feel equal.** Push the "Scale" tier as recommended: +8px padding, accent border, "Recommended" pill. Middle-wins draws the eye.
>
> **2. The nav is pure `#0A2540` with no contrast vs the hero** — they blend into one block. Add a subtle border-bottom `rgba(246,249,252,0.08)` on the nav or raise hero brightness 2-3%.
>
> Harmony 0.91, brand-fidelity 0.97, rhythm 0.86 — rest holds. Want me to apply these?

User says "yes, both".

```ts
// fix 1 — add recommended flag to tier 2
reframe_edit({ sceneId: "s12", op: "update", nodeId: "<tier-2-id>",
  changes: { padding: 56, borderWidth: 2, borderColor: "#635BFF" } })

reframe_edit({ sceneId: "s12", op: "add", parentId: "<tier-2-id>",
  type: "FRAME", name: "recommended-badge",
  props: { background: "#635BFF", padding: "4px 12px", borderRadius: 999, ... } })

// fix 2 — nav border
reframe_edit({ sceneId: "s12", op: "update", nodeId: "<nav-id>",
  changes: { borderBottomWidth: 1, borderBottomColor: "rgba(246,249,252,0.08)" } })
```

## Result

Scene ready. User exports:

```ts
reframe_export({ sceneId: "s12", format: "html" })
// → .reframe/exports/pricing.html
```

Or for production React:

```ts
// hand to reframe-to-react
```

## Pipeline at a glance

```
user prompt
  → brand gate (extract or Read)
  → write .reframe/src/pricing.html
  → reframe_compile
  → reframe_inspect
  → fix-loop (reframe_edit for props / source rewrite for structure)
  → reframe-critic (taste review)
  → apply critic suggestions (if user says yes)
  → done (or export)
```

Total: 8 turns, ~3 minutes wall-clock, 10 tool calls, scene audit-clean and taste-reviewed.
