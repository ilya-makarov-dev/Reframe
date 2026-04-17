# Workflow: create custom brand

Use when the user has a style brief / mood board / existing brand book that isn't in reframe's catalog, and wants to save it as a reusable brand for the project.

Ambitious workflow. Writes a DESIGN.md from scratch — encoding taste rules from the user's brief into reframe's brand format. This is the "taste-design" equivalent, but rooted in reframe's own token shape.

## When

- "here's my startup's style guide, save this as 'acme'"
- "I want a brand like Apple but warmer — save it"
- "create a brand named 'brutalist-bank' with heavy type and flat shadows"
- User uploads a mood board / screenshots and asks to match

Not this workflow:
- User names a known brand → [apply-existing.md](apply-existing.md)
- User just wants style guidance for ONE scene, not a reusable brand → hand to [reframe-design](../../reframe-design/SKILL.md) with the adjectives

## Steps

### 1. Collect the brief

Ask the user for the minimum set you need. Checklist (matching [../references/designmd-anatomy.md](../references/designmd-anatomy.md)):

**Mandatory:**
- Name + slug (kebab-case, e.g. `acme`)
- Atmosphere — 2-3 adjectives ("minimal, serious, dense")
- Primary color palette: background, surface, **one** accent, text-primary, text-secondary
- Typography: font family (must be available via Google Fonts or system), weights you use, base body size

**Recommended:**
- OpenType features if the font supports them
- Button shape: sharp / soft / pill + border radius value
- Shadow system: flat / subtle / normal / dramatic
- Spacing scale: 4px or 8px grid + key step values (48, 64, 96, 120)

**Optional but valuable:**
- Motion philosophy (static / subtle / playful)
- Voice / tone (technical / warm / playful / editorial)
- Anti-patterns — what should NEVER appear ("no gradients", "no serif", "no centered heroes")

If anything mandatory is missing, **ask once** — don't fabricate values.

### 2. Compose the DESIGN.md

Write to `.reframe/brands/<slug>/DESIGN.md` following the anatomy. Use [../../reframe-design/examples/stripe-hero.html](../../reframe-design/examples/stripe-hero.html) for what tokens look like in action, and [../references/designmd-anatomy.md](../references/designmd-anatomy.md) for structure.

Skeleton (adapt depth to the brief):

```markdown
# <Brand Name>

## Visual atmosphere
<2-3 sentences of mood, density, philosophy>

## Color palette

| Role | Name | Hex | Usage |
|---|---|---|---|
| background | Deep Ink | `#0A0F1E` | page bg |
| surface | Raised | `#111827` | cards, containers |
| accent | Signal | `#E94B1A` | primary CTAs, links |
| text-primary | Ivory | `#F5F3EE` | body |
| text-secondary | Smoke | `#8B93A7` | captions |
| border | Hairline | `rgba(255,255,255,0.08)` | subtle separators |

**Banned:** no pure black, no high-sat blues (reserved for system UI feel)

## Typography

- Family: `Outfit` (Google Fonts)
- Weights used: 400, 500, 700
- Scale (px/line-height):
  - Display: 72 / 76, letter-spacing -0.03em
  - H1: 48 / 54, letter-spacing -0.025em
  - H2: 32 / 38, letter-spacing -0.02em
  - Body: 16 / 24
  - Small: 13 / 18
- OpenType features: `font-feature-settings: 'ss01', 'cv11'`

## Components

### Buttons
- Primary: `#E94B1A` fill, white text, 44px height, 999px radius (pill), 0 shadow, uppercase 13/500 letter-spacing 0.04em
- Secondary: transparent, `#F5F3EE` text, 1px border `rgba(255,255,255,0.18)`, 44px height, 999px radius

### Cards
- Surface `#111827`, border `rgba(255,255,255,0.08)` 1px, 12px radius, subtle 0-2px rgba(0,0,0,0.3) shadow

### Nav
- Sticky, 64px height, surface `#0A0F1E`/0.88 backdrop-filter blur(24px)

## Spacing scale (8px grid)

8, 16, 24, 32, 48, 64, 96, 120, 160

## Shadows
- Subtle: `0 1px 2px rgba(0,0,0,0.2)` (cards)
- Lift: `0 8px 24px rgba(0,0,0,0.35)` (popovers, dropdowns)
- (No dramatic / neon shadows)

## Motion
- Spring physics (stiffness: 120, damping: 22)
- Transform + opacity only
- Stagger 60ms between siblings

## Voice
- Direct, confident, declarative
- Short sentences (≤14 words)
- Avoid marketing filler

## Anti-patterns
- No gradients as fills (flat surfaces only)
- No centered heroes with high content variance
- No fake metrics / testimonials
```

### 3. Validate completeness

Walk through [../references/designmd-anatomy.md](../references/designmd-anatomy.md) checklist. If anything is weak, mention it in handoff.

### 4. Save + register

The Write itself persists to `.reframe/brands/<slug>/DESIGN.md`. Optionally set as active brand:

```ts
// Only if user asked — don't auto-activate on a new scene they haven't designed yet
reframe_edit({ sceneId: "<current>", op: "defineTokens", tokens: { /* from designmd */ } })
```

### 5. Hand off

> Saved custom brand `acme` to `.reframe/brands/acme/DESIGN.md`. Ready to use — mention "acme brand" in prompts and [reframe-design](../../reframe-design/SKILL.md) will apply it.

## Rules

1. **Never fabricate on behalf of the user.** Missing field in the brief → ask. Don't invent "typical corporate blue".
2. **The DESIGN.md must pass the anatomy checklist.** A thin DESIGN.md produces thin scenes.
3. **Slug is permanent.** User chose `acme` — stick with it. Don't rename later without explicit ask.
4. **One accent max.** The anatomy enforces this. A brief with "purple accent AND green accent" → pick one as primary, flag the other as "secondary decorative" or refuse the remix.

## Examples

See [../../reframe-design/examples/stripe-hero.html](../../reframe-design/examples/stripe-hero.html) for tokens in action. See [../references/designmd-anatomy.md](../references/designmd-anatomy.md) for the full schema this workflow writes to.

## Related

- [apply-existing.md](apply-existing.md) — for catalog brands
- [../references/designmd-anatomy.md](../references/designmd-anatomy.md) — what sections belong in a DESIGN.md
- [../references/hybrid-rules.md](../references/hybrid-rules.md) — advanced: cherry-pick from multiple brands
