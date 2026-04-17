# Workflow: rebrand in place

**This is reframe's distinctive flow.** Unlike prompt-to-UI tools that regenerate when the brand changes, reframe can swap design tokens on an existing scene **without touching structure**. The INode graph stays put; colors, fonts, radii, shadows swap across the whole tree deterministically.

Use when the user wants a brand change on something that already exists and they're happy with the layout.

## When

- "rebrand this to Stripe"
- "try it in the Linear style"
- "apply the Airbnb brand to this scene"
- "what does this look like with a dark theme?" (mode swap is a mini-rebrand)

Not this workflow:
- New scene from scratch → [apply-existing.md](apply-existing.md) + [reframe-design](../../reframe-design/SKILL.md) text-to-design
- User wants BOTH a brand swap AND a layout change → first rebrand in place, then they can ask for layout edits separately ([reframe-design](../../reframe-design/SKILL.md) edit-design)

## Why in-place beats regeneration

| Property | Regenerate | In-place swap |
|---|---|---|
| Wall-clock time | 60-120s | 2-5s |
| Cost (tokens + compute) | full scene | one tool call |
| User's edits preserved | ❌ lost | ✅ kept |
| Layout churn risk | high (new hero, new sections) | zero |
| Reproducible | no (AI variance) | yes (deterministic) |

Users often iterate: pick a layout they like, then audition different brands on it. In-place swap makes this fast and lossless.

## Steps

### 1. Identify the scene

- Active scene from preamble → use its `sessionId`
- User pointed at a specific scene ("rebrand the pricing page") → resolve by slug via the project scenes list in preamble

### 2. Load the target brand

If the target brand isn't yet in local cache:

```ts
reframe_design({ action: "extract", brand: "<new-slug>" })
```

Then:

```ts
Read(".reframe/brands/<new-slug>/DESIGN.md")
```

You need the new brand's full spec, especially the color palette and OpenType features, because the swap respects what's in the DESIGN.md.

### 3. Apply the brand

Two patterns depending on scope:

**Full rebrand** — swap everything (colors, type, radii, shadows):

```ts
reframe_edit({
  sceneId: "<scene>",
  op: "defineTokens",
  tokens: {
    // Pull from the new brand's DESIGN.md
    colors: { /* role-based */ },
    type: { family, weights, features },
    spacing: { /* scale */ },
    radius: { /* strategy */ },
    shadows: { /* system */ }
  }
})
```

**Mode swap only** — light ↔ dark:

```ts
reframe_edit({
  sceneId: "<scene>",
  op: "setMode",
  mode: "dark" // or "light"
})
```

**Partial swap** — only accent / typography / radius:

```ts
reframe_edit({ sceneId, op: "rotateColors", degrees: N })       // hue shift only
reframe_edit({ sceneId, op: "typographyPreset", preset: "editorial" })
reframe_edit({ sceneId, op: "scaleRadius", value: "pill" })
```

Pick the minimum scope that matches the user's ask. "Rebrand to Linear" = full `defineTokens`. "Dark mode" = `setMode`. "Make it pill-shaped" = `scaleRadius` only.

### 4. Verify brand fidelity

```ts
reframe_inspect({ sceneId: "<scene>" })
```

Check:
- **`brandFidelity` score** — should be ≥ 0.85 after a clean swap. If lower, something didn't transfer (usually OpenType features didn't get applied to text nodes).
- **Audit fails** — a rebrand shouldn't introduce rule failures. If it did, likely contrast or palette mismatch; triage via [../../reframe-design/workflows/fix-audit.md](../../reframe-design/workflows/fix-audit.md).

### 5. Report with delta

One-sentence report format:

> Rebranded from Stripe → Linear. brandFidelity 0.91 → 0.88 (small drop — Linear's DESIGN.md doesn't specify shadows, kept Stripe's subtle shadow tokens). Audit clean.

That sentence tells the user what changed, what risk remains, and whether to expect further fixes.

## Edge cases

### The scene has no brand set yet

A scene compiled without a declared brand won't have token metadata to swap from. Two options:

- **Run once as "paint"** — `defineTokens` simply sets the scene's tokens to the new brand's values. No "from" state to worry about. Safe.
- **Warn the user** that the scene's current visual style may map unpredictably to the new brand (hue rotation on untokenized colors has surprises).

### The user wants a partial rebrand ("just the colors")

Fine — use `rotateColors` or apply a subset of tokens via `defineTokens` with only the `colors` key. But: typography / radius inconsistencies after a color-only swap can feel like the scene is "half Linear, half Stripe." Recommend full swap unless user is explicit.

### OpenType features don't transfer

If the original brand didn't specify `font-feature-settings` but the new brand does (e.g. Stripe → Helvetica-default), the swap's `defineTokens` call writes the new `font-feature-settings` but the text nodes in the INode graph already have those features baked as inline styles from the original compile. They stay.

**Fix**: after the swap, iterate text nodes via `reframe_edit update` to apply the new font-feature-settings. Or (cleaner): re-compile from source if `.reframe/src/<name>.html` exists, which re-reads tokens from the new brand.

```ts
// Cleaner — re-compile instead of patching every text node:
reframe_compile({ file: ".reframe/src/<name>.html", name: "<name>", brand: "<new-slug>" })
```

This preserves source, applies new brand deterministically.

## Non-negotiable

- **Do NOT regenerate HTML during a rebrand** unless the user explicitly says "and change the layout too". Rebrand = tokens swap, structure preserved.
- **Do NOT chain multiple `reframe_edit` ops** when `defineTokens` covers it. One atomic swap > five partial edits.

## Related

- [apply-existing.md](apply-existing.md) — for new scenes (the more common flow)
- [refresh-cached.md](refresh-cached.md) — when the brand cache itself is stale
- [../../reframe-design/workflows/fix-audit.md](../../reframe-design/workflows/fix-audit.md) — if swap introduces rule fails
- [../../reframe-critic/SKILL.md](../../reframe-critic/SKILL.md) — review taste after rebrand (catch tone mismatches)
