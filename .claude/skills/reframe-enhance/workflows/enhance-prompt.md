# Workflow: enhance prompt

One linear pipeline from raw user intent → structured prompt ready for [reframe-design](../../reframe-design/SKILL.md) or for writing into a site-loop baton.

## Pipeline

### Step 1 — Assess what's missing

Walk the user's message against this checklist. Note each gap for later filling.

| Element | What to look for | If missing |
|---|---|---|
| **Platform** | "web", "mobile", "desktop", "tablet" | Default to web 1440 unless context (e.g. chat scope has mobile viewport) says otherwise |
| **Page type** | "landing", "dashboard", "pricing", "form", "404", "about", "product" | Infer from verbs/nouns; if ambiguous, **ask once** |
| **Brand** | Brand name, "like X's style" | If absent and no active brand → **ask once**; don't invent |
| **Structure** | Numbered sections, OR nouns naming blocks ("hero, pricing, footer") | Fall back to [structure-templates](../references/structure-templates.md) for the page type |
| **Visual style** | Adjectives ("minimal", "editorial", "playful", "professional") | Pull tone from brand DESIGN.md; if no brand, ask or default to "professional / clean" |
| **Colors** | Specific hexes, role names | Pull from brand DESIGN.md; if no brand, use neutrals from default fallback |
| **Components** | UI-specific terms ("nav bar", "cards", "primary CTA") | Default skeleton from [structure-templates](../references/structure-templates.md) |

### Step 2 — Load DESIGN.md (when brand is known)

If a brand is in scope (from user's message, chip context, or active scene):

```ts
Read(".reframe/brands/<slug>/DESIGN.md")
```

Extract for inclusion in output:
- Color palette (role-based, with hexes)
- Typography (family, weights, sizes, **OpenType features**)
- Component specs (buttons, cards, etc.)
- Atmospheric adjectives (for the one-line tone summary)

If brand is named but DESIGN.md isn't cached → hand to [reframe-brand apply-existing](../../reframe-brand/workflows/apply-existing.md) first, then come back.

If no brand → include a 💡 Tip in the output footer telling the user they should pick one (see Step 4).

### Step 3 — Apply enhancement rewrites

Three rewrite layers, applied in order:

#### A. Keyword rewrites (vague → concrete)

Use [keyword-map.md](../references/keyword-map.md). Examples:

| Vague | Concrete |
|---|---|
| "menu at the top" | "sticky navigation bar with wordmark left, 4-5 links center, primary CTA right" |
| "button" | "primary CTA button, 44px height, brand accent fill" |
| "list of things" | (depends on structure — "3-column asymmetric card grid" OR "vertical list with leading icon + title + description") |
| "picture area" | "hero section with full-bleed background image and dark overlay" |
| "form" | "form with labeled inputs, helper text, primary submit button" |

Be specific about position, layout, and hierarchy — not just the component name.

#### B. Mood rewrites (adjective → token)

Use [mood-map.md](../references/mood-map.md). Examples:

| Basic | Concrete |
|---|---|
| "modern" | "clean, minimal, generous whitespace, 8px baseline grid" |
| "professional" | "sophisticated, trustworthy, subtle 0-4px shadows, neutral palette, serif-free" |
| "playful" | "vibrant, 12-16px radii, bold accent color, playful microcopy" |
| "dark mode" | "dark theme, high-contrast text on deep surface (#0E0D12 or #18171E, not pure black), accent punches through" |

#### C. Structure injection (if page type known but sections weren't named)

Pull the skeleton from [structure-templates.md](../references/structure-templates.md) for the inferred page type. Example for "landing":

```
1. Nav — sticky, wordmark + links + primary CTA
2. Hero — headline, subhead, primary CTA, visual anchor
3. Value props — NOT 3-equal-cards; use asymmetric / bento / zigzag
4. Social proof — if brand has it; otherwise skip or neutral label
5. Feature deep-dive — one highlighted feature, narrative style
6. CTA block — final push
7. Footer — nav + legal + social
```

Customize per the brand's tone (Stripe's landing ≠ Airbnb's landing).

### Step 4 — Emit in the required format

Use [output-format.md](../references/output-format.md) as the shape contract. Structure, always in this order:

```markdown
<One-line purpose + tone — 10-15 words>

**DESIGN SYSTEM (REQUIRED):**
- Platform: ...
- Theme: ...
- Background: Name (#hex)
- Primary Accent: Name (#hex) — role
- Text Primary: ...
- Text Secondary: ...
- Typography: font, weights, font-feature-settings
- Buttons: radius, height, variants
- Cards: radius, shadow, padding

**Page Structure:**
1. **Name:** specifics (layout, copy direction, components, sizes)
2. **Name:** specifics
...

**Constraints:**
- Inline styles only
- OpenType features on every text node (if brand specifies)
- No fake metrics / testimonials / logos
- Full-width sections use width: 100%, not fixed px
- [any page-specific constraint]
```

**Rules of thumb for the output:**
- DESIGN SYSTEM pulls verbatim from DESIGN.md when available
- Each section description is **concrete** — headline text if user provided, CTA label, component count, layout direction
- Constraints always include reframe's non-negotiables (inline-only, OpenType, no fake content)

### Step 5 — Hand off

Specify who picks up next:

- Called by [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md) → return inline, caller picks up at step 2 (Write source HTML)
- Called by [reframe-site-loop start-site](../../reframe-site-loop/workflows/start-site.md) or [advance-page](../../reframe-site-loop/workflows/advance-page.md) → the caller writes your output to `.reframe/next-prompt.md` per [baton-format](../../reframe-site-loop/references/baton-format.md)

Never end with the prompt floating — always close with "ready for reframe-design" or "written to baton".

## Rules

1. **No HTML in this skill.** You rewrite text, nothing more.
2. **Preserve intent.** User said "playful" → output still feels playful, just specific.
3. **Don't invent brand values.** Missing brand → footer tip, not silent fill.
4. **Match depth to request.** Short ask → short prompt. Don't over-engineer.
5. **Single purpose.** One page per enhance call. Multi-page → caller handles iteration.

## See also

- [../references/output-format.md](../references/output-format.md) — exact output shape
- [../references/keyword-map.md](../references/keyword-map.md) — vague-to-concrete dictionary
- [../references/mood-map.md](../references/mood-map.md) — adjective-to-token dictionary
- [../references/structure-templates.md](../references/structure-templates.md) — default page skeletons
- [../examples/](../examples/) — before/after traces
