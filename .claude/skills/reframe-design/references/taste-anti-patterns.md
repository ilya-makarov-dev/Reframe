# Taste anti-patterns

The 37-rule audit catches measurable violations (overflow, contrast, font size, touch target). These rules catch the **"AI-slop signature"** — things the machine can't see but a designer would flag immediately.

The `reframe-critic` skill uses this list as its taste check. `reframe-design` should **avoid producing these in the first place**, not fix them after.

## Color

### ❌ Max one accent above 80% saturation
Two high-sat colors fight for attention. Pick one accent, desaturate everything else (< 30% sat) or use achromatic (black/white/gray).

```
✅  accent #635BFF (75% sat), all else #F5F3EE / #6B7280 / #111
❌  accent #635BFF AND banner #FF6A34 AND highlight #10B981
```

### ❌ Pure black `#000`
Burns visual holes in dark layouts. Real-world premium products use `#0A0A0B`, `#111111`, `#16161A` for "black". Dark mode bases typically `#0E0D12` or `#18171E`.

```
✅  background #0E0D12, text #F0EEE6
❌  background #000000, text #FFFFFF
```

### ❌ "Brand" purple / neon
Unless the brand DESIGN.md explicitly calls for it. Default purple / cyan / magenta combinations read as generic AI-gen.

## Typography

### ❌ Inter for premium / editorial / creative
Inter is fine for neutral SaaS and dashboards. For premium, editorial, creative, use:
- **Geist** — modern neutral with character
- **Outfit** — geometric warm
- **Cabinet Grotesk** — editorial display
- **Söhne** — premium neutral (paid, but the rendering is unmistakable)

```
✅  premium landing: Cabinet Grotesk 72/76 headings + Söhne body
❌  premium landing: Inter 72 headings
```

### ❌ Serif in dashboards
Serif = editorial / content / long-form reading. Dashboard = dense, utilitarian, sans. Don't mix the vibes.

### ❌ Condensed display face at body sizes
Tight display fonts (Anton, Oswald) compress poorly at 14–16px. Keep them for 48px+ headings.

## Layout

### ❌ Three equal horizontal cards
The single most-recognizable AI-slop signature. Looks like a Bootstrap demo from 2016.

Replace with:
- **Asymmetric 7/5 split** — lead card 58% width, two stacked 42%
- **Bento grid** — different sizes tiling a rectangle
- **Zig-zag** — left text + right image, then right text + left image
- **Editorial column** — one feature primary, others as inline text with dense prev

### ❌ Centered hero with full spread (headline + subhead + 3 stats + image + 2 CTAs)
Centered layouts have low variance tolerance. If the hero carries headline + anything else substantial, it needs to be **split** (content one side, visual other side) or **stacked with visible hierarchy** (headline big, everything else clearly secondary).

Rule of thumb: only center a hero when its content is "headline + single CTA" (maybe with a minimal eyebrow label).

### ❌ Feature grid with icon-on-top-of-text
3×N or 2×N grid where each cell is: small icon at top + bold label + body text below. Another AI-template signature.

Better: alternating layouts per feature, OR one "hero feature" with three secondary features as denser rows, OR no feature grid at all — integrate features into the narrative.

### ❌ "Why choose us" section with checkmark bullets
This section by name is a tell. If you have content that would go here, structure it as a single strong statement + an image that *shows* the benefit, not a list.

## Content

### ❌ Fake metrics
Never write numbers the user didn't provide:
- "Trusted by 40,000 engineers"
- "99.9% uptime"
- "Used by teams at Acme, Initech, and Dunder Mifflin"
- "Save 10 hours per week"

Use neutral substitutes:
- "Built for engineering teams"
- "Reliable by design"
- "Used by product teams"
- "Save hours each week"

Or leave the section out entirely.

### ❌ Fabricated testimonials
"Sarah Chen, Product Lead at Acme: 'This changed everything'". The user will notice; it's embarrassing. Leave the testimonial block off unless the user provided real quotes.

### ❌ Generic marketing clichés
"Transform your business with our innovative platform", "Unleash the power of", "Revolutionize the way you…" — these read as template filler, because they are.

## Motion

### ❌ Animating `top` / `left` / `width` / `height`
These trigger browser reflow. Modern motion uses `transform` and `opacity` only (composited on GPU, 60fps).

### ❌ Linear easing for UI motion
`linear` looks robotic. Use spring physics (roughly stiffness: 100, damping: 20) or a good cubic-bezier (`cubic-bezier(0.22, 1, 0.36, 1)` is a solid default).

### ❌ Simultaneous reveals
Everything animating in at once = nothing animating. Stagger: 40-80ms between siblings.

## Iconography

### ❌ Emoji as UI icons
"🚀 Fast" / "🎨 Beautiful" / "⚡ Powerful" — emoji as iconography is a 2019-era AI template giveaway. Use real SVG icons (Lucide, Heroicons, Phosphor) or glyph characters if you must.

Emoji in body copy (as punctuation, in user-provided content) is fine. Emoji replacing an icon is not.

### ❌ Mixed icon sets
Don't mix Feather + Material + FontAwesome. Pick one family and stick with it. Visual consistency > finding the "perfect" icon.

## Density

### ❌ Uniform padding across very different sections
Hero with 96px vertical padding, footer with 96px vertical padding, fine-print legal with 96px vertical padding — flattens hierarchy.

Match vertical rhythm to content importance:
- Hero: 120–160px
- Primary content: 80–96px
- Secondary content: 48–64px
- Footer / legal: 32–48px

## Contextual tone

### ❌ Tonal mismatch with domain
- Funeral home in vibrant orange
- Bank in Comic Sans spirit (rounded playful + confetti)
- Children's game in brutalist grayscale
- B2B devtool in handwritten serifs

Check the domain → palette / type / density should match. If the user picked a brand, this is automatic. If they didn't, think about the domain before reaching for your default palette.

## How the critic uses this list

The `reframe-critic` skill ranks these against the scene's aesthetic scores and brand DESIGN.md. It returns ≤3 specific issues (not a checklist of 20). The idea: catch the most visible anti-pattern, give the user a specific fix, then stop.

If `reframe-design` follows these rules in the **generation** step, `reframe-critic` has less to flag.
