# reframe-brand skill

Loads the right DESIGN.md before any HTML is written. Reframe's brand library ships 60+ pre-extracted brands via `getdesign` npm, and this skill is the gate that makes sure the design pipeline never runs blind.

## What it does

- **Recognizes brand mentions** in the user's prompt (Stripe, Linear, Airbnb, Notion, Apple, Ferrari, Tesla, Vercel, GitHub…).
- **Extracts** the brand's DESIGN.md via `reframe_design action=extract` and caches it in `.reframe/brands/<slug>/`.
- **Reads the full DESIGN.md** (colors, typography, OpenType features, component specs, spacing, shadows) before generation.
- **Swaps tokens in-place** on an existing scene without regeneration — reframe's distinctive feature.
- **Refuses to generate without brand context** — no guessed colors or fake Stripe blues.

## Why a separate skill

The brand gate is worth its own skill because:
- Getting it wrong is expensive (full scene regen when the brand is finally loaded)
- OpenType features are the #1 missed brand detail in AI-gen output
- `rebrand-in-place` is a distinct flow that stitch-style skills don't have (they regenerate)

## Example prompts

**Apply existing brand:**
```
Make a pricing page with Linear brand.
```
→ `reframe-brand` extracts Linear DESIGN.md → hand off to `reframe-design`

**Rebrand in place:**
```
Rebrand this scene to Stripe.
```
→ `reframe-brand` loads Stripe DESIGN.md → `reframe_edit` swaps tokens → done, no regen

**Refresh cache:**
```
Linear redesigned their site, refresh the brand.
```
→ delete `.reframe/brands/linear/` → re-extract

## Skill structure

```
reframe-brand/
├── SKILL.md                    — agent entry (triggers + routing + non-negotiables)
├── README.md                   — this file
├── workflows/
│   ├── apply-existing.md       — brand from catalog → extract + Read + handoff
│   ├── rebrand-in-place.md     — swap tokens on live scene without regen
│   ├── refresh-cached.md       — invalidate + re-extract stale brand
│   └── create-custom.md        — user brief → synthesize DESIGN.md
├── references/
│   ├── brand-catalog.md        — top-30 brands with one-line profiles
│   ├── designmd-anatomy.md     — checklist of what a DESIGN.md must contain
│   └── hybrid-rules.md         — advanced: cherry-pick tokens across brands
```

## Works with

- [`reframe-design`](../reframe-design/) — receives the loaded DESIGN.md and generates from it
- [`reframe-critic`](../reframe-critic/) — reads `brandFidelity` score after generation to verify brand adherence
- [`reframe-site-loop`](../reframe-site-loop/) — brand is frozen once here, applied to every page of the site
