# Hybrid brand rules (advanced)

**Default: don't.** Mixing two brands' tokens produces visual dissonance unless done carefully. Reframe's defaults rail against this for a reason.

Use only when:
- The user explicitly asks for a remix ("Stripe colors but Linear typography")
- You're authoring a custom brand that legitimately draws from multiple sources
- A client project has a hybrid brand book by design

## Why hybrids usually fail

Each brand is a **coherent system** — colors, type, spacing, and shadows are designed to work together. Swapping type from one brand into another's palette breaks the coherence. The output reads as "almost right but off" — worse than either pure source.

Common failure modes:
- **Stripe colors + Inter typography** — Stripe's palette assumes Stripe Sans's geometric rhythm. Inter's humanist rhythm clashes with the dense grid Stripe expects.
- **Linear palette + Airbnb generosity** — Linear's tight density on Airbnb's rounded softness. Reads as neither lean nor warm.
- **Apple's white with Ferrari's red** — two premium systems, totally different vibes. Visual confusion.

## When it CAN work

Hybrids succeed when:
1. **One brand is the source of structure**, the other contributes a single isolated layer (e.g. only the type family, only the accent color)
2. **The brands share an atmospheric family** (Stripe + Linear — both minimal tech; combining safer than Stripe + Airbnb)
3. **The user is authoring a new brand** and using multiple references as inspiration, documented as the brand's own system

## Safe combinations

Ranked by likelihood of success:

| Base brand | Layer to add | Works because |
|---|---|---|
| `linear` | Add Stripe's OpenType features | Both minimal tech; OpenType shift is subtle |
| `vercel` | Add Apple's type scale | Both restrained premium |
| `stripe` | Add Airbnb's warmth (slightly rounded radii) | Palette harmonizes at low contrast |
| `notion` | Add Medium's serif for long-form sections | Both reading-first |

## Dangerous combinations

Avoid:
- Type from brand A + colors from brand B (almost always fails — they were designed together)
- Aggressive mixing of density (Figma's playful + Linear's minimal = empty but cluttered)
- Mixing more than two sources

## How to do a hybrid (when you must)

### Option A — cherry-pick one layer only

Pick the source brand (the one contributing the most), copy its DESIGN.md. Overwrite ONE layer (accent color, or type family, or border-radius strategy) from the other brand. Document the override explicitly.

```markdown
# Acme

*Based on Stripe, overriding: accent color from Linear (`#5E6AD2`)*

## Color palette
(Stripe's palette, but accent = Linear indigo)
...

## Typography
(Stripe Sans, full)
...
```

### Option B — author a new atomic brand

If the user wants a true fusion, this isn't a hybrid — it's a NEW brand. Route to [../workflows/create-custom.md](../workflows/create-custom.md) and author it from scratch with references as influences (not as directly-copied layers).

### Option C — per-scene brand (not recommended)

Reframe supports different scenes in the same project using different brands. One scene Stripe, another Linear. This isn't a hybrid per-scene, but across-scene. Only do this when the scenes represent genuinely separate contexts (e.g. a portfolio showcasing multiple client brands).

## Hard rules

1. **Never silently mix.** Every hybrid must be documented in the DESIGN.md so future agents know.
2. **Never mix more than 2 sources.** Three+ = use [../workflows/create-custom.md](../workflows/create-custom.md) instead.
3. **Never mix OpenType + non-OpenType type families.** If either source has features, the whole brand needs them applied. Partial is worse than none.
4. **The resulting DESIGN.md must pass [designmd-anatomy.md](designmd-anatomy.md) checklist.** A hybrid isn't an excuse for a thin DESIGN.md.

## Related

- [../workflows/apply-existing.md](../workflows/apply-existing.md) — for single catalog brand
- [../workflows/create-custom.md](../workflows/create-custom.md) — for authoring a new brand including hybrids
- [designmd-anatomy.md](designmd-anatomy.md) — the quality bar the hybrid DESIGN.md must meet
