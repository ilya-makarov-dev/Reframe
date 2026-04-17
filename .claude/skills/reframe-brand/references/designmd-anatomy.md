# DESIGN.md anatomy

A good DESIGN.md is the **contract** between the brand and the scene generator. This reference defines what a DESIGN.md must contain for the scene to render with high `brandFidelity`.

Use as:
- A **checklist** after `reframe_design action=extract` to spot a thin DESIGN.md before generation
- A **template** when authoring custom brands in [../workflows/create-custom.md](../workflows/create-custom.md)

## Mandatory sections (the scene can't generate without these)

### 1. Visual atmosphere

2–3 sentences or a compact bullet list describing the mood, density, and philosophy.

**Why:** gives the agent a north-star quality check ("is this dense enough? too playful?"). Without it, the agent defaults to "modern SaaS default" regardless of brand.

**Example:**

> Premium financial infrastructure. Quiet. High density — information-first, minimal ornamentation. Subtle shadows, generous type hierarchy, one accent.

### 2. Color palette

Role-based entries with exact hex values. Not just "primary / secondary" — **functional roles**:

| Role | Example name + hex | What it's used for |
|---|---|---|
| `background` | Deep Ink `#0A2540` | Root page background |
| `surface` | Raised `#13294B` | Cards, elevated containers |
| `accent` | Signal `#635BFF` | Primary CTAs, active states, links |
| `text-primary` | Ivory `#F6F9FC` | Headlines, body on dark bg |
| `text-secondary` | Smoke `#ADBDCC` | Sub-headings, captions |
| `text-muted` | Fade `#425466` | Disabled state, fine print |
| `border` | Hairline `rgba(246,249,252,0.08)` | Subtle separators |

**Banned list is part of the palette.** Specify colors NOT to use: "no pure `#000`", "no high-sat green (reserved for financial system UI)".

**Why:** the audit's `color-in-palette` rule checks every color used against this list. Audit's `brandFidelity` score factors in coverage.

### 3. Typography

- **Font family** (primary + fallback stack)
- **Weights in use** (400, 500, 600, 700 — not every weight)
- **Scale** — explicit size/line-height pairs per role:
  - Display (hero): size / line-height / letter-spacing / weight
  - H1 / H2 / H3: same
  - Body: same
  - Small / caption: same
- **OpenType features** — **the single most-missed brand detail**. `font-feature-settings: 'ss01', 'tnum', 'cv11'` (whatever the brand specifies). Apply to **every** text node.

**Example:**

```
Family: "Stripe Sans", Inter, -apple-system, sans-serif
Weights: 400, 500, 600
Display: 72 / 76, letter-spacing -0.03em, weight 600
H1:      48 / 54, letter-spacing -0.025em, weight 600
H2:      32 / 38, letter-spacing -0.02em, weight 500
Body:    16 / 24, letter-spacing 0, weight 400
Small:   13 / 18, letter-spacing 0.01em, weight 500
OpenType features: font-feature-settings: 'ss01', 'tnum'
```

**Why:** without weights, the agent will guess. Without OpenType, brandFidelity drops immediately — Stripe's numbers without `tnum` are obviously wrong.

### 4. Component specs

Per component (buttons, cards, inputs, badges, nav):
- Shape: border-radius value
- Size: width/height or padding
- Colors (from the palette, by role)
- Typography (which type role)
- States if relevant (default / hover / active / disabled)

**Example — buttons:**

```
Primary:
  - Background: accent (#635BFF)
  - Text: text-primary (#FFFFFF)
  - Height: 48px
  - Padding: 0 24px
  - Border-radius: 24px (pill-ish)
  - Font: 15 / 500, letter-spacing -0.01em
  - OpenType: 'ss01', 'tnum'

Secondary:
  - Background: transparent
  - Text: text-primary
  - Border: 1px rgba(246,249,252,0.18)
  - Height: 48px
  - Padding: 0 24px
  - Border-radius: 24px
```

**Why:** every CTA in every scene should match these specs. Without them the agent renders buttons at random sizes / radii.

### 5. Spacing scale

Grid base + key step values:

```
Base: 8px
Scale: 8, 16, 24, 32, 48, 64, 96, 120, 160
```

**Why:** the audit's `spacing-grid-compliance` rule snaps against this. Scenes using `47px` / `63px` padding fail.

### 6. Shadows

Either a shadow system with explicit tokens, **or** an explicit "no shadows" decision:

```
Subtle: 0 1px 2px rgba(0,0,0,0.08)
Normal: 0 4px 12px rgba(0,0,0,0.12)
Lift:   0 12px 32px rgba(0,0,0,0.18)
```

or

```
Shadows: none — flat elevation, rely on surface color contrast for depth
```

**Why:** shadow choices are brand-defining. Stripe's subtle shadows vs Figma's friendly shadows vs Tesla's zero shadows — very different visual signatures.

## Recommended sections (scene generates without, but brandFidelity suffers)

### 7. Motion philosophy

- Physics: spring (stiffness/damping) or bezier (cubic-bezier values)
- Duration range (150ms fast / 300ms default / 600ms slow)
- What to animate (transform + opacity only)
- Stagger values for lists

### 8. Voice / tone

The words in the scene matter too:
- "Direct, confident, declarative" vs "Warm, conversational, playful"
- Sentence length guidance
- Bannings ("no marketing filler", "no exclamation points")

### 9. Atmospheric adjectives

3–5 single words that capture the brand's feel. Agent uses these as the north star:

```
Stripe: quiet, premium, technical, dense, trustworthy
Airbnb: warm, human, generous, hospitable, honest
Linear: minimal, lean, serious, opinionated, fast
```

## Optional sections

### 10. Anti-patterns

What NEVER appears in this brand:
- "No gradients"
- "No centered heroes with more than headline + CTA"
- "No stock-photo humans"
- "No fake metrics / testimonials"

### 11. Reference screens

Links or file-paths to 2–3 gold-standard scenes that embody the brand at its best. The agent can Read them as templates.

### 12. Logo / wordmark specs

SVG paths, preferred sizes, safe area. Less critical since reframe typically doesn't generate full logos — but useful for nav bars.

## Checklist for after-extract validation

After `reframe_design action=extract`, Read the DESIGN.md and confirm:

- [ ] Visual atmosphere (2-3 sentences) — mandatory
- [ ] Color palette with roles, hex values, banned list — mandatory
- [ ] Typography: family, weights, scale, **OpenType features** — mandatory
- [ ] Component specs (buttons at minimum) — mandatory
- [ ] Spacing scale — mandatory
- [ ] Shadow system or "no shadows" decision — mandatory
- [ ] Motion (if brand has motion identity) — recommended
- [ ] Voice (if brand is copy-forward) — recommended
- [ ] Atmospheric adjectives — recommended
- [ ] Anti-patterns — optional but valuable

If any mandatory section is missing → flag to user in handoff: "Linear DESIGN.md is missing component specs; will use reframe defaults for buttons and cards."

## Thin DESIGN.md red flags

You're looking at a weak DESIGN.md when:
- Only 1-2 colors specified (real brand has 6+)
- No OpenType features listed
- No component specs
- No spacing scale
- No atmospheric description

Thin DESIGN.md → generic output → low `brandFidelity`. Either:
1. Refresh the brand ([../workflows/refresh-cached.md](../workflows/refresh-cached.md)) in case extraction improved
2. Use [../workflows/create-custom.md](../workflows/create-custom.md) to fill gaps from a user brief
