# Example: "a landing for my SaaS, Stripe brand"

Medium input, brand named, SaaS category. Enhance loads Stripe DESIGN.md and injects tokens.

## Input

```
a landing for my SaaS, Stripe brand
```

## Step 1 — Assess gaps

- Platform: not specified → default Web 1440
- Page type: `landing` — clear
- Brand: `stripe` — specified, excellent
- Structure: not specified → pull Landing skeleton
- Visual style: covered by Stripe DESIGN.md
- Colors: will come from DESIGN.md
- Components: skeleton + brand

## Step 2 — Load DESIGN.md

```
Read(".reframe/brands/stripe/DESIGN.md")
```

Pull key tokens:
- Deep Ink `#0A2540`, Accent Purple `#635BFF` (one-and-only), Ivory `#F6F9FC`
- Stripe Sans, weights 400/500/600, `font-feature-settings: 'ss01', 'tnum'`
- Buttons: 48px height, 24px radius
- Subtle 0-4px shadows
- Atmosphere: quiet, premium, technical, dense, trustworthy

## Step 3 — Apply rewrites

- **Keywords**: "landing" skeleton from structure-templates
- **Mood**: inherited from Stripe's atmosphere (quiet + dense)
- **Structure**: Landing with trust anchor, two asymmetric value blocks, social proof skip (no real logos from user), pricing teaser

## Step 4 — Output

```markdown
A premium SaaS landing with Stripe-brand visual language — dense, trustworthy, technical tone.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first (1440px root)
- Theme: Stripe (see .reframe/brands/stripe/DESIGN.md)
- Background: Deep Ink (#0A2540) — page base
- Surface: Raised (#13294B) — cards, elevated containers
- Primary Accent: Signal (#635BFF) — CTAs, links, active states
- Text Primary: Ivory (#F6F9FC)
- Text Secondary: Smoke (#ADBDCC)
- Text Muted: Fade (#425466)
- Typography: "Stripe Sans", Inter, system-ui; weights 400/500/600; font-feature-settings: 'ss01', 'tnum' on every text node
- Buttons: 24px radius (pill-ish), 48px height; primary = accent fill + white text; secondary = transparent + 1px border rgba(246,249,252,0.18)
- Cards: 12-16px radius, subtle 0-4px shadow
- Spacing grid: 8px base (scale: 48/64/96/120/160)

**Page Structure:**
1. **Nav:** Sticky, 64px height. Stripe wordmark left, 5 menu items center ("Products", "Solutions", "Developers", "Resources", "Pricing"), "Sign in" text link + "Contact sales" primary CTA right
2. **Hero:** Asymmetric split 58/42. Left — eyebrow "Financial infrastructure" (uppercase 14/600 accent), headline "Payments built for scale" 72/76 weight 600 -0.03em, subhead 20/28 muted max-width 520, primary CTA "Start now" + secondary "Contact sales". Right — elevated surface card ($13294B bg) with live-data mockup: "This month" label + "$2,847,392.18" display number with 'tnum' + "Processed across 12 currencies" accent line + 4-tab row
3. **Trust anchor:** Neutral row on light surface (#F6F9FC base, dark text). Label "Trusted by engineering teams shipping at scale" + 4 anonymous logo placeholders as "●●●" dots (replace when user provides real logos)
4. **Value block #1:** Full-width dark section. Headline left ~50%, product mockup right ~50%. Narrative copy, specific technical benefits (NOT generic "fast" / "reliable")
5. **Value block #2:** Reverse layout. Mockup left, text right. Different product angle
6. **Pricing teaser:** Anchor block "Simple, scalable pricing" + one-line description + "View plans" text link to /pricing (not inline pricing — that's a separate page)
7. **Final CTA:** Full-width accent-color band (#635BFF). "Build what comes next" headline, supporting line, "Get started" primary CTA (white on accent). Dense vertical padding 96-120px
8. **Footer:** 4-col (Products / Solutions / Resources / Company), wordmark + copyright line bottom, dark surface

**Constraints:**
- Inline styles only
- font-feature-settings: 'ss01', 'tnum' on EVERY text node (this is Stripe's signature — missing = brandFidelity fail)
- Every container has explicit background + color
- Full-width sections use width: 100%, not fixed px
- Buttons ≥ 44px height, 24px radius per Stripe DESIGN.md
- NO fake metrics, NO made-up company logos in trust row, NO fabricated testimonials
- NO 3-equal-horizontal value cards — use asymmetric splits per sections 4-5
- Hero must be split, not centered (high-variance content disallows centered)
```

## Step 5 — Hand off

Return inline to [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md). The caller will Write this as HTML following the spec, then compile.

## Why this shape

- **Brand known** → DESIGN.md tokens baked directly in, no placeholder values
- **OpenType loudly emphasized** — Stripe's most missed signature detail
- **Trust anchor neutralized** — user didn't provide logos, so we don't fake them
- **Pricing teaser, not pricing inline** — landing is a separate scene from /pricing; don't blend
- **Dense vertical padding** — matches Stripe atmosphere (quiet, premium)
- **Explicit taste constraint "no 3-equal-cards"** — prevents AI-slop on generation
