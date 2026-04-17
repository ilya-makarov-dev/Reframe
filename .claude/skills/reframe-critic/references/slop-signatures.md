# Slop signatures — LLM-only checks

These are patterns the engine's audit + aesthetic scores **cannot measure**. They require an LLM reading the semantic tree and recognizing "oh that's the AI-generated feature-grid-with-icons pattern".

The critic's value-add over the engine = catching these. Without this layer, a clean-audit scene still feels generic.

## Three classes

### Class 1 — Genericness (layout patterns)

AI-slop signature shapes. When you see them, flag.

#### Three equal horizontal cards

**The most-recognizable AI template.** 3 cells in a row, equal width, each with: title + body + (optional icon on top). Seen in 90% of AI-generated landings.

Flag: "The 3-card row is the AI-slop signature. Try an asymmetric 7/5 split: lead card 58% width with mixed media, two smaller cards 42% stacked."

Alternatives: asymmetric grid / bento / zig-zag / single-lead with inline secondary.

#### Centered hero with full spread

Hero with: big headline (centered) + subhead (centered) + 3 stats below (centered) + large image below + 2 CTAs centered. Too much variance for a centered layout.

Flag: "Hero is centered but carries too much (headline + 3 stats + CTA + image). Move to split 7/5: text content left 58%, visual right 42%. Center only works for low-variance content."

#### Feature grid with icon-on-top-of-text

3-col or 2-col grid, each cell: small icon at top + bold label + body text below. Stock AI output for "features" sections.

Flag: "The feature grid follows the icon-top-of-text template. Replace with one highlighted feature (narrative copy + inline mockup) + two secondary features as denser rows below."

#### "Why choose us" section

Literal section titled "Why choose us" with 3-4 checkmark bullets. Or "Our benefits" / "What makes us different" with similar structure. If the section name is on this list, it's slop.

Flag: "'Why choose us' is a generic-section name. If the content matters, restructure as a single strong narrative — 'Here's what we do different:' + 1-2 specific paragraphs, not a bulleted comparison."

#### Featureless wall of cards

5+ cards in a grid with no hierarchy — all same size, same color, same weight. Reads as a Bootstrap demo.

Flag: "The cards all look equal. Pick one as the hero card (larger, different surface color, or with a mixed-media inclusion); let the others be lighter in weight."

### Class 2 — Fake content

Any content the user didn't provide but the generator invented to fill space.

#### Fabricated metrics

- "Trusted by 40,000 engineers"
- "99.9% uptime"
- "Save 10 hours per week"
- "Used by 2,500+ companies"

Flag: "'Trusted by 40,000 teams' was invented — user didn't provide this number. Replace with neutral 'Trusted by engineering teams' or remove the anchor section."

#### Invented testimonials

Quote from "Sarah Chen, Product Lead at Acme" with generic praise, when the user never specified a testimonial. Highly unprofessional if shipped.

Flag: "The testimonial from 'Jordan Kim at Acme Corp' is fabricated. Either (a) remove the testimonial section entirely, (b) replace with a neutral "Loved by product teams" anchor, or (c) ask user for real quotes."

#### Made-up logos / company names

Social proof row with fake company logos or wordmarks of invented companies.

Flag: "The 'trusted by' row shows fake logos for made-up companies. Either remove the section or replace with anonymous placeholder dots (●●●) the user can swap for real assets."

#### Generic marketing filler

Copy that reads like template content:
- "Transform your business with our innovative platform"
- "Unleash the power of [anything]"
- "Revolutionize the way you [do thing]"

Flag: "Body copy 'Transform your business with our innovative platform' reads as template filler. This section needs real copy from the user or a specific, concrete sentence about what the product actually does."

### Class 3 — Tonal mismatch

Visual tone wrong for the domain. Requires reading both the content and the palette/type/density.

Examples (serious → wrong):
- Funeral home in vibrant orange palette
- Children's game in brutalist grayscale
- Financial services in Comic Sans energy

Examples (specific mismatches):

#### Dev tool with consumer-playful energy
Tool for backend engineers with bubbly rounded buttons, bright gradients, emoji iconography. Engineers will not take it seriously.

Flag: "The playful color block + emoji-as-icons reads as consumer. For a backend devtool, shift to denser spacing, monospace accents, one accent color, no emoji."

#### Luxury goods in discount-store aesthetic
Watch brand with Comic Sans / bright yellow sale banners / crowded layout. Destroys perceived value.

Flag: "The aesthetic reads as discount / casual. Luxury calls for: serif display (Playfair or Didot), near-black + gold accent, 120-160px vertical padding, zero exclamation marks."

#### B2B enterprise with playful microcopy
"Let's rock!" CTA and "Awesome!" confirmations on a payroll software page. Buyer is an HR VP.

Flag: "Microcopy is too casual for the buyer (HR decision-makers). Replace 'Let's rock!' → 'Begin setup', 'Awesome!' → 'Confirmed'."

## How to check

Walk the semantic tree:

```
for each section in inspect.semantic:
  check layout pattern → match against Class 1 signatures
  check content → match against Class 2 fabrications
check whole scene → match against Class 3 tonal mismatch
```

If something matches → candidate for critique pool.

## Guardrails

1. **Don't flag layout patterns that are brand-specified.** If Stripe's DESIGN.md uses a feature grid, that's intentional; don't flag as slop.
2. **Don't flag user-provided content.** If user said "we are trusted by 40,000 teams", take their word for it. Only flag invented content.
3. **One flag per category max.** Don't pile 3 genericness complaints — pick the most prominent, flag once.
4. **Always include specific fix.** "Replace with asymmetric grid" — not "make it less generic".

## Related

- [score-translation.md](score-translation.md) — metric-based issues (the OTHER half of critique)
- [critique-format.md](critique-format.md) — exact output shape
- [../../reframe-design/references/taste-anti-patterns.md](../../reframe-design/references/taste-anti-patterns.md) — the same rules applied **during generation** so critic has less to flag
