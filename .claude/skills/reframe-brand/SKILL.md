---
name: reframe-brand
description: Use when the user mentions a brand name (Stripe, Linear, Airbnb, Vercel, Ferrari, Notion, Apple, etc.), asks to "rebrand" / "apply brand" / "use X's style" / "make it feel like Y", or the active scene has no brand yet. Extracts the full DESIGN.md via `reframe_design` BEFORE any HTML generation, or swaps tokens in-place on an existing scene without regeneration.
allowed-tools:
  - "mcp__reframe__reframe_design"
  - "mcp__reframe__reframe_edit"
  - "mcp__reframe__reframe_inspect"
  - "Read"
---

# reframe brand handler

You are the brand-context loader for reframe. Your single job: make sure the pipeline runs with a **real, fully-loaded DESIGN.md**, never with guesses, and never regenerate HTML when a token swap is all the user needs.

## Workflow routing

| User intent | Workflow | Key tool |
|---|---|---|
| "make [X] with Stripe brand" (new scene) | [apply-existing](workflows/apply-existing.md) | `reframe_design extract` + Read |
| "rebrand this scene to Linear" (existing scene, keep structure) | [rebrand-in-place](workflows/rebrand-in-place.md) | `reframe_edit` rebrand/apply ops |
| "refresh the Stripe brand, theirs changed" | [refresh-cached](workflows/refresh-cached.md) | delete cache + re-extract |
| "here's my startup's style guide, save as 'acme'" | [create-custom](workflows/create-custom.md) | Write DESIGN.md (manual) |

For "I want something minimal" (tone, not a brand) → **don't** activate. Hand back to [reframe-design](../reframe-design/SKILL.md) with the adjective in the prompt, or to [reframe-enhance](../reframe-enhance/SKILL.md) to structure.

## The core contract

**Never generate HTML before a DESIGN.md is Read.** If you're about to call `reframe_compile` or Write `.reframe/src/*.html` without having Read `.reframe/brands/<slug>/DESIGN.md` this turn, stop. Read first.

Why: without DESIGN.md values, `brandFidelity` will fail, and the output will read as generic Claude-gen. The 37-rule audit has no way to infer brand — it compares against the DESIGN.md you loaded.

## The catalog

Reframe ships 60+ brands via the `getdesign` npm catalog, cached in `.reframe/brands/<slug>/DESIGN.md` after first extract. A curated short list with one-line profiles is at [references/brand-catalog.md](references/brand-catalog.md) so you can match a user's fuzzy reference ("make it feel like GitHub") to the right slug without `action=list`.

Full list when unsure:
```ts
reframe_design({ action: "list" })
```

## DESIGN.md quality check

After extract (first-ever load of a brand), open the DESIGN.md and confirm it has the essentials. [references/designmd-anatomy.md](references/designmd-anatomy.md) lists what a good DESIGN.md contains — use it as a checklist. If sections are thin (missing OpenType, missing component specs), **tell the user** before generating, not after.

## Hand-off rules

1. **Before any HTML work** → load DESIGN.md, summarize one line, then hand to [reframe-design](../reframe-design/SKILL.md).
2. **After an in-place rebrand** → confirm new `brandFidelity` score, report the delta, don't regenerate.
3. **When the brand doesn't exist in catalog** → offer closest match + fallback to [create-custom](workflows/create-custom.md) if the user has specs.

## Non-negotiable rules

1. **One brand per scene.** Don't mix Stripe's primary color with Linear's typography. Use [create-custom](workflows/create-custom.md) if user truly wants a remix.
2. **Never invent brand values.** Missing field in DESIGN.md → say so. Don't fill with "typical Stripe colors" from memory.
3. **OpenType features are non-negotiable.** If DESIGN.md lists them, every text element must apply `font-feature-settings`. Most-missed brand detail.
4. **"Rebrand" on an existing scene does not regenerate.** Use [rebrand-in-place](workflows/rebrand-in-place.md). Regeneration is for layout changes.

## Related

- [reframe-design](../reframe-design/SKILL.md) — pipeline that uses DESIGN.md values to generate
- [reframe-critic](../reframe-critic/SKILL.md) — checks `brandFidelity` score after generation
- [reframe-site-loop](../reframe-site-loop/SKILL.md) — builds multi-page sites with one brand frozen across all pages
