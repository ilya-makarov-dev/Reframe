# reframe-enhance skill

Transforms vague design requests into structured prompts that produce scenes passing reframe's 37-rule audit on first compile.

## What it does

- **Reads** the user's raw intent
- **Detects gaps** (no platform, no brand, no sections, no colors, no component specs)
- **Injects DESIGN.md** if a brand is in context, pulling exact tokens (colors, typography, OpenType, component specs)
- **Rewrites** via a keyword → component mapping, mood → token mapping, and page-type → structure mapping
- **Emits** a structured prompt in the exact format [reframe-design](../reframe-design/) expects

## Why this matters

A raw user prompt like "make a landing page" → AI fills gaps with guessed defaults (generic hero, 3 equal cards, fake stats). An enhanced prompt with DESIGN SYSTEM block + 6 named sections + explicit constraints → reframe generates something that passes audit and reads on-brand.

This skill is **the cheapest quality uplift in the whole pipeline.** Without it, everything downstream compensates for ambiguity.

## Example

**User:**
```
make me a login page
```

**Enhanced output** (what reframe-design receives):
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
1. **Header:** Minimal centered wordmark, 48px top padding
2. **Card:** Centered 400×auto, "Sign in" heading, email + password inputs, "Forgot password?" inline link, primary submit
3. **Footer:** "Don't have an account? Sign up" centered link

**Constraints:**
- Inline styles only
- No fake company logos, no placeholder social proof
```

Full trace at [examples/login-page.md](examples/login-page.md).

## Skill structure

```
reframe-enhance/
├── SKILL.md                    — agent entry (trigger + hard rules)
├── README.md                   — this file
├── workflows/
│   └── enhance-prompt.md       — the single linear pipeline
├── references/
│   ├── keyword-map.md          — vague term → concrete component
│   ├── mood-map.md             — adjective → concrete token
│   ├── structure-templates.md  — page type → default skeleton
│   └── output-format.md        — EXACT prompt output shape
└── examples/
    ├── login-page.md           — "make me a login page" → structured
    ├── saas-landing.md         — "a landing for my SaaS" → structured
    └── dashboard.md            — "a dashboard" → structured
```

## Works with

- [`reframe-design`](../reframe-design/) — consumes the structured prompt, generates
- [`reframe-brand`](../reframe-brand/) — if brand is in the user's ask, brand loads first, then enhance uses DESIGN.md
- [`reframe-site-loop`](../reframe-site-loop/) — enhance runs before every `next-prompt.md` write

## Not this skill

- Single-word property tweaks ("make it pink") — go direct to `reframe_edit`
- Fully structured user spec already — skip enhance, go to reframe-design
- Multi-page — site-loop handles iteration, but STILL calls enhance for each page
