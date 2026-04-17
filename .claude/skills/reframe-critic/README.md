# reframe-critic skill

Post-generation taste review. Reads reframe's engine metrics (37-rule audit, 8 aesthetic scores, brandFidelity) and translates them into designer-language critique with ≤3 concrete fixes. Adds only what metrics can't see: genericness, fake content, tone mismatch.

## What it does

- **Reads the numbers** — `reframe_inspect` returns audit + aesthetic scores + brandFidelity
- **Translates** low scores into human language ("hierarchy 0.58 → primary and secondary CTAs look equally important → push contrast: size ratio, weight jump, accent color on primary")
- **Adds LLM-only checks** — genericness pattern matching, fake content detection, tonal mismatch with domain
- **Ranks and picks ≤3** — not a checklist of 20 nits
- **Delivers callable fixes** — every item ends with a specific change + "want me to apply?"

## Why a separate skill

The value of reframe is not "generate HTML" (Claude does that). It's the **engine layer** — measured quality. But raw scores ("alignment: 0.67") are useless to a user. Critic is the **translation layer** that turns numbers into product decisions.

Without critic, two things happen:
1. User ships generic-looking scenes even when audit is clean (no LLM-only taste layer)
2. User doesn't know WHY aesthetic scores are what they are

Critic fixes both.

## Example

**User:**
```
review the pricing page
```

**Critic output:**
```
Three issues worth fixing:

**1. Hierarchy 0.58 — the three tiers look equally important.** Push the
   recommended tier: +8px padding, primary accent border, "Recommended"
   pill. The middle-tier-wins pattern pulls eye.

**2. brandFidelity 0.74 — the stat block renders default digits.** Stripe's
   DESIGN.md calls for font-feature-settings: 'ss01', 'tnum'. Apply to
   every numeric text; single biggest visible brand miss.

**3. "Trusted by 40,000 teams" — fake metric, you didn't ask for this.**
   Replace with "Trusted by engineering teams" (neutral) or remove.

Rhythm 0.82, alignment 0.91, harmony 0.88 — rest holds. Want me to apply?
```

Full trace at [examples/three-issues.md](examples/three-issues.md).

## Skill structure

```
reframe-critic/
├── SKILL.md                       — agent entry (contract + rules)
├── README.md                      — this file
├── workflows/
│   └── critique.md                — the single linear pipeline
├── references/
│   ├── score-translation.md       — each aesthetic score → human meaning + fix direction
│   ├── slop-signatures.md         — LLM-only patterns (genericness, fake content, tone)
│   └── critique-format.md         — EXACT output shape + anti-patterns
└── examples/
    ├── holds-up.md                — clean scene, 1-line response
    ├── three-issues.md            — typical critique
    └── brand-drift.md             — critique focused on brand
```

## Works with

- [`reframe-design`](../reframe-design/) — run critic at end of design pipeline; user applies critic fixes via reframe_edit
- [`reframe-brand`](../reframe-brand/) — critic's brandFidelity flags often point back to brand issues (refresh cache, re-apply tokens)
- [`reframe-site-loop`](../reframe-site-loop/) — critic per-page before advancing baton catches cross-page drift
- Engine rules (37-rule audit + 8 aesthetic scores + brandFidelity) — critic is a thin UX layer on top, NOT a re-implementation

## Not this skill

- Machine-verifiable issues (overflow, contrast, font size) — already caught by audit, don't re-flag
- User-provided copy — critic judges structure/layout/type, not words
- Major layout rethinks — critic suggests fixes; "redesign this page" is a reframe-design call
