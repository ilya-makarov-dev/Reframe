# Output format — the structured prompt contract

Every enhanced prompt follows this exact shape. No deviations. Downstream consumers ([reframe-design](../../reframe-design/SKILL.md), [reframe-site-loop baton](../../reframe-site-loop/references/baton-format.md)) depend on this structure.

## The shape

```markdown
<One-line purpose + tone — 10-15 words>

**DESIGN SYSTEM (REQUIRED):**
- Platform: <Web/Mobile>, <Desktop/Mobile>-first (1440px OR 390px root)
- Theme: <brand name OR mood descriptors>
- Background: <Name> (#hex)
- Surface: <Name> (#hex) — <where used>
- Primary Accent: <Name> (#hex) — <role: CTA, link, active state>
- Text Primary: <Name> (#hex)
- Text Secondary: <Name> (#hex)
- Text Muted: <Name> (#hex)
- Typography: <Font>, weights <list>, font-feature-settings '<feat1>', '<feat2>' on every text node
- Buttons: <radius>px radius, 44-48px height, <primary spec>, <secondary spec>
- Cards: <radius>px radius, <shadow spec>, <surface color>
- Spacing grid: 8px base (48/64/96/120/160 scale)

**Page Structure:**
1. **<Section name>:** <description with component, layout direction, copy, dimensions>
2. **<Section name>:** <description>
3. ...
N. **<Section name>:** <description>

**Constraints:**
- Inline styles only (no classes, no <style> blocks)
- Every container has explicit background + color
- Full-width sections use width: 100%, not fixed px
- OpenType features '<feat1>', '<feat2>' on every text node
- No fake metrics / testimonials / logos / social-proof numbers
- No 3-equal-horizontal cards — use asymmetric / bento / zigzag
- <Any page-specific constraint, e.g. "Hero must be split not centered">
```

## Why this shape (not a different one)

**DESIGN SYSTEM block first**: `reframe_compile`'s audit validates against these tokens. If the writer (whoever generates HTML from this prompt) has the tokens upfront, audit passes on first compile.

**Numbered sections**: tells the writer exactly what to build. No inference. No "I think they want pricing" — if pricing's listed, build it; if not, skip.

**Constraints at the end**: these are reframe's non-negotiables (inline-only, OpenType, no fake content). Listed explicitly so they're not optional.

## Required elements per section

### One-line purpose

10-15 words. Example:
> A clean, trustworthy login page with a centered form and minimal branding.

Too short ("A login page.") → no tone signal. Too long (paragraph) → noise. 10-15 words forces precision.

### DESIGN SYSTEM block

**Mandatory rows:**
- Platform
- Theme
- Background
- Primary Accent
- Text Primary
- Text Secondary
- Typography (family + weights + OpenType)
- Buttons (radius + height)

**Recommended rows** (when brand specifies):
- Surface
- Text Muted / Tertiary
- Cards
- Shadows
- Spacing grid

**Skip** rows that don't apply (e.g. Cards row on a 1-section page).

### Page Structure

Each section:
- **Numbered** (1., 2., 3.)
- **Bold section name** (`**Hero:**`, `**Footer:**`)
- **Concrete description** — what component, layout direction, copy (if user provided), rough dimensions if meaningful

Example:
```
1. **Hero:** Asymmetric split — text left 58% (headline "Build products at speed" + subhead + primary CTA "Start free trial"), product mockup right 42% at 560px wide
```

Bad:
```
1. Nice hero  <-- not concrete
```

### Constraints

Always include reframe's invariants:
- `Inline styles only`
- `OpenType features on every text node` (when brand specifies)
- `No fake metrics / testimonials / logos`
- `Full-width sections use width: 100%`

Add page-specific constraints as needed:
- Hero must be split (not centered) for high-variance content
- Form must be centered with max-width 400px
- Pricing tiers must use asymmetric layout (center tier emphasized)

## Full example

```markdown
A premium SaaS pricing page with Stripe-brand visual language — 3 tiers, middle-tier-emphasized, FAQ below.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first (1440px root)
- Theme: Stripe (see .reframe/brands/stripe/DESIGN.md)
- Background: Deep Ink (#0A2540) — page
- Surface: Raised (#13294B) — tier cards
- Primary Accent: Signal (#635BFF) — recommended-tier border, primary CTA
- Text Primary: Ivory (#F6F9FC)
- Text Secondary: Smoke (#ADBDCC)
- Text Muted: Fade (#425466)
- Typography: "Stripe Sans", Inter, system-ui; weights 400/500/600; font-feature-settings: 'ss01', 'tnum' on every text node
- Buttons: 24px radius (pill-ish), 48px height, accent fill primary / transparent+border secondary
- Cards: 12px radius, subtle 0-4px shadow
- Spacing grid: 8px base

**Page Structure:**
1. **Nav:** Sticky at top, Stripe wordmark left + 5 menu items + "Sign in" secondary + "Contact sales" primary right
2. **Hero:** Centered — headline "Pricing that scales" 56/60 weight 600, subhead 18/28 max-width 560, no CTA
3. **Plan toggle:** Monthly / Annual segmented control centered below hero
4. **Tier grid:** 3 asymmetric tiers — "Start" 28% left, "Scale" 44% center elevated with accent border and "Recommended" pill above, "Enterprise" 28% right. Each: name 20/600, price 56/600 with 'tnum', 5 feature bullets, primary CTA full-width
5. **Feature comparison:** Expandable table, 5 rows visible + "See all features" expander
6. **FAQ:** Accordion with 6 real questions (user provided — insert here), answers 14/1.5
7. **Final CTA:** Dark-surface block — "Still have questions?" + "Contact sales" CTA
8. **Footer:** 4-col (Products / Resources / Company / Legal), wordmark + copyright bottom

**Constraints:**
- Inline styles only
- font-feature-settings: 'ss01', 'tnum' on every text node (especially prices)
- No fake metrics / testimonials / logos
- No 3-equal-horizontal pricing cards — middle tier MUST be visually elevated
- Full-width sections use width: 100%
- All CTAs use primary button spec (48px height, 24px radius, accent fill)
```

## Anti-patterns in output

### Vague section descriptions

```
❌  3. **Features:** Show the features.
✅  3. **Features:** Asymmetric 7/5 split — first feature as lead card with full-width image, two smaller feature cards stacked right
```

### Placeholder tokens

```
❌  - Background: [your color]
✅  - Background: Clean White (#FFFFFF)
```

If brand unavailable → either ask the user for a color OR use an explicit neutral default AND tell them in a footer tip.

### Missing OpenType in constraints (when brand requires)

Stripe without `ss01` + `tnum` = immediate brandFidelity failure. Always carry through.

### Over-specifying when user was vague

If user said "a login page" — DON'T write 300-line prompt with obsessive detail. Match depth to ask. Structured but proportional.

## Footer tip (when brand unknown)

When no brand is in context, end the output with:

```
---
💡 **Tip:** For consistent designs across multiple pages, pick a brand via
`reframe_design action=list` or `reframe-brand apply-existing`. Ensures
the 37-rule audit's brandFidelity check can pass.
```

The tip goes **after** the Constraints block, separated by `---`.

## Related

- [../workflows/enhance-prompt.md](../workflows/enhance-prompt.md) — the pipeline that emits this format
- [keyword-map.md](keyword-map.md) — for section-level rewrites
- [mood-map.md](mood-map.md) — for theme / tone tokens
- [structure-templates.md](structure-templates.md) — for default section lists
