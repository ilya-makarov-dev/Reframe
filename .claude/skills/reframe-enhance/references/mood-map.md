# Mood map — adjective → concrete tokens

Dictionary of vague mood words → specific token descriptions. Use to rewrite adjectives in the user's prompt before emitting the DESIGN SYSTEM block.

## Common mood words

### "modern"

> clean, minimal, generous whitespace, 8-16px grid, sans-serif only (Inter / Geist / Outfit), sharp or soft radius (4-12px), subtle 0-2px shadows, one accent color max

### "professional"

> sophisticated, trustworthy, subtle 0-4px shadows, neutral palette (blue/gray/black spectrum), serif-free, dense information layouts, 16-18px body, 48-64px section padding

### "premium"

> restrained, high whitespace-to-content ratio, quiet palette (one accent + neutrals), font choice signals quality (Söhne, Cabinet Grotesk, Geist — NOT Inter), 24px+ radii for softness OR 0-2px for editorial precision, shadows absent or subtle-only

### "luxury"

> similar to premium but with more drama: deep blacks (#0A0A0B, not pure #000), metallic accents (gold #C9A961 / silver #E5E5E5), serif display for headings (Playfair, Didot), generous 96-160px vertical padding, no emoji, no casual copy

### "playful"

> vibrant, rounded 12-20px radii, bold accent color (saturated, 80%+), 1-2 secondary colors tastefully, playful microcopy, motion-rich (spring physics), illustrated or emoji-adjacent style

### "minimal"

> whitespace-dominant, 1 accent max, grayscale-heavy palette, 0-4px radius (sharp), zero shadows or single subtle, type does the work (weight + size for hierarchy), no illustration, generous section padding (120-160px)

### "dense"

> information-first, compact padding (16-32px), smaller type scale (14-15px body, 20-24px headings), tighter line-height (1.4-1.5), 4-8px grid, minimal decoration — everything earns its space

### "editorial"

> reading-first, serif display (Source Serif, Charter, Adobe Caslon), strong column structure, generous leading (1.6-1.7), restrained palette, large body size (18-20px), image-as-anchor per section

### "brutalist"

> maximalist structure, heavy type (display weights 700-900), near-zero radii (0-2px), high-contrast monochrome or single saturated accent, asymmetric grids, visible structure (borders, dividers), no shadows, dense

### "warm"

> cream / off-white backgrounds (#F2ECDA, #FAF6EE), orange / coral / amber accents (#E94B1A, #FF6A34), rounded (12-16px radii), friendly sans (Cereal, Outfit), human copy voice, generous padding

### "cold" / "clinical"

> cool blue / gray palette (#0E1420 bg, #3B82F6 accent), precise grid (4px), sharp radii, Inter or Helvetica, minimal shadows, data-dense layouts

### "dark mode"

> base #0E0D12 or #18171E (NEVER pure #000), text #F0EEE6 or similar warm off-white, accent punches through (brand's signature color), 1-2px dark-contrast borders using rgba(255,255,255,0.08), no heavy shadows (they disappear on dark)

### "light mode"

> base #FFFFFF or #FAF6EE (warm if brand), text #111 or brand primary, accents readable with 4.5+ contrast, shadows visible (0-8px subtle to soft-lift), more color saturation headroom

### "fun"

> similar to playful but more energetic: saturated color block sections, motion-rich (micro-interactions everywhere), emoji-in-copy acceptable, rounded 16-24px radii, asymmetric with visual surprises

### "serious"

> restrained motion (static or minimal fades), neutral palette, single small accent, dense grid, no emoji, no informal microcopy, authority-oriented type (serif or wide sans with character)

### "friendly"

> warm neutrals, rounded 12px+ radii, friendly microcopy ("Let's get started" vs "Begin"), human illustrations OR no illustration, inviting whitespace, conversational voice

### "techy"

> dark mode default, monospace accents (for code snippets, product names), sharp edges, code-syntax coloring tokens visible, terminal aesthetics allowed, JetBrains Mono / Fira Code for code, Inter for body

### "approachable"

> similar to friendly, add: 16-18px body (readable at distance), high contrast for accessibility, captions / helper text as guide rails, error states written to reassure

## Combinations

Users often stack adjectives. Apply both, resolve conflicts:

| Combo | Resolution |
|---|---|
| "modern + professional" | Modern wins on structure (minimal, 8px grid). Professional wins on palette (neutral, trustworthy). |
| "dark + playful" | Dark mode shell, playful accents within (saturated accent, rounded CTAs). |
| "minimal + warm" | Minimal structure (whitespace, no ornament). Warm palette (cream, orange accent). |
| "premium + playful" | Rare combo — resolve by asking user which dominates. Usually "premium playful" = Airbnb (rounded warmth, editorial spine). |
| "serious + friendly" | Neutral base + warm accents + conversational copy = approachable professional (Stripe-adjacent). |

## When user says something not on this list

Write your own mapping using the pattern:

```
<adjective> → <3-4 specific descriptors covering: palette, type, spacing, radii, shadows, tone>
```

Keep each descriptor concrete and actionable. Vague → "feels good" is useless. Specific → "16px base body, 8px grid, 0-2px shadows" is actionable.

## Anti-patterns to avoid when translating moods

Don't let adjectives trigger generic AI-gen signatures:
- "modern" ≠ gradients and glassmorphism by default (those are 2020 AI templates)
- "professional" ≠ generic stock-photo businesspeople
- "trustworthy" ≠ always blue (unless brand says so)
- "playful" ≠ rainbow gradients with emoji-as-UI

Lean on brand DESIGN.md first. Mood map is for when DESIGN.md doesn't specify and you need to fill a gap.

## Related

- [keyword-map.md](keyword-map.md) — for component term rewrites
- [structure-templates.md](structure-templates.md) — for page skeletons
- [../../reframe-design/references/taste-anti-patterns.md](../../reframe-design/references/taste-anti-patterns.md) — what NOT to generate regardless of mood
