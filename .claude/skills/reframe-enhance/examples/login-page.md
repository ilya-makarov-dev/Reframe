# Example: "make me a login page"

Minimal input, no brand, no structure mentioned. Produces a safe default structured prompt.

## Input

```
make me a login page
```

## Step 1 — Assess gaps

- Platform: not specified → default Web 1440
- Page type: `login` — clear
- Brand: not specified → add footer tip
- Structure: not specified → pull from [structure-templates.md → Login](../references/structure-templates.md)
- Visual style: not specified → default "clean, professional"
- Colors: not specified → neutral default (white + blue accent)
- Components: inferred from login template

## Step 2 — Load DESIGN.md

No brand → skip this step. Flag in output footer.

## Step 3 — Apply rewrites

- **Mood**: "professional" → clean, minimal, neutral palette, subtle shadows
- **Keyword**: "login page" → centered form pattern from keyword-map
- **Structure**: Login skeleton from structure-templates

## Step 4 — Output

```markdown
A clean, trustworthy login page with a centered form and minimal branding.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first (1440px root)
- Theme: Light, professional
- Background: Clean White (#FFFFFF)
- Surface: Soft Gray (#F9FAFB) — form card
- Primary Accent: Deep Blue (#2563EB) — submit button, links
- Text Primary: Near Black (#111827)
- Text Secondary: Medium Gray (#6B7280)
- Typography: Inter, weights 400/500/600
- Buttons: 8px radius, 44px height, full-width on card
- Cards: 12px radius, soft 0-4px shadow

**Page Structure:**
1. **Header:** Minimal centered wordmark at 48px from top of viewport
2. **Card:** Centered 400×auto, 12px radius, soft shadow. Content:
   - Heading "Sign in" 24/600
   - Email input (label above, 14/500) + 40px input height
   - Password input (label above) + "Forgot password?" inline helper right-aligned
   - Primary submit button, full-width, "Sign in" label
3. **Footer:** Single line below card: "Don't have an account? Sign up" with "Sign up" as accent-blue link

**Constraints:**
- Inline styles only
- Every container has explicit background + color
- Button height ≥ 44px (WCAG touch target)
- No fake company logos, no placeholder social proof, no fake testimonials

---
💡 **Tip:** For consistent designs across multiple pages, pick a brand via
`reframe_design action=list` or the `reframe-brand` skill. Ensures the
37-rule audit's brandFidelity check can pass.
```

## Step 5 — Hand off

Return inline to [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md) step 2.

## Why this shape

- **Single-purpose prompt** — just a login page, no site build
- **Safe neutral brand** — user didn't specify, so we don't pretend they did. Footer tip educates
- **Structured but proportional** — login has a fixed pattern (card + inputs + CTA); no over-specification
- **All reframe invariants carried** — inline styles, 44px button, explicit colors
