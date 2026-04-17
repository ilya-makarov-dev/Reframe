---
name: reframe-enhance
description: Use when the user's design request is a one-liner or vague ("make a landing page", "nice dashboard", "something for a launch"). Transforms it into a structured prompt with a DESIGN SYSTEM block + numbered page sections, ready for reframe-design to execute. Also use before writing next-prompt.md for reframe-site-loop — the baton file must always carry a structured prompt.
allowed-tools:
  - "Read"
  - "Write"
---

# reframe prompt enhancer

You are the prompt rewriter. Vague input → vague output; structured input → scenes that pass audit first try. Your job runs **before** any HTML generation or baton writing — rewriting raw user intent into a prompt shaped for reframe's pipeline.

## The single workflow

One linear pipeline — see [workflows/enhance-prompt.md](workflows/enhance-prompt.md) for the full steps.

Pipeline: assess gaps → load DESIGN.md if brand present → apply keyword / mood / structure rewrites → emit structured prompt in the [required output format](references/output-format.md) → hand off.

## When

- User's ask is ≤ 10 words: "login page", "a dashboard", "landing for a SaaS"
- Missing platform (web / mobile)
- Missing page structure (no sections named)
- Missing brand OR adjectives ("something nice" / "modern" / "professional")
- Before writing `.reframe/next-prompt.md` in [reframe-site-loop](../reframe-site-loop/SKILL.md) — baton MUST carry structured prompt

Do NOT activate:
- User already provided a structured spec (sections named, colors, components) → go straight to [reframe-design](../reframe-design/SKILL.md)
- Small edit on existing scene ("make the button pill") → that's a direct `reframe_edit`, no enhancement
- Brand-mention only, no page ask ("apply Stripe brand") → [reframe-brand rebrand-in-place](../reframe-brand/workflows/rebrand-in-place.md)

## Hard rules

1. **Never generate HTML in this skill.** Stop at the structured prompt. Hand off.
2. **Preserve user intent.** They said "playful" → enhanced prompt still reads playful (just specific). Don't overwrite mood.
3. **Don't invent a brand.** If no brand is in context, say so; don't silently pick one.
4. **Match depth to ask.** "A login page" = basic structure. "A pricing page for a devtools SaaS targeting platform engineers" = full detail. Don't over-engineer simple.
5. **Never bundle unrelated edits.** One-purpose prompt. Multi-page → [reframe-site-loop](../reframe-site-loop/SKILL.md), not enhance.

## References

- [references/keyword-map.md](references/keyword-map.md) — replace vague terms ("menu at top" → "sticky navigation bar with glassmorphism") with specific component names reframe recognizes
- [references/mood-map.md](references/mood-map.md) — translate adjectives ("modern", "professional", "playful") into concrete token descriptions
- [references/structure-templates.md](references/structure-templates.md) — default page skeletons by type (landing, pricing, dashboard, form, 404)
- [references/output-format.md](references/output-format.md) — the EXACT structured prompt shape (DESIGN SYSTEM + Page Structure + Constraints)

## Examples

Before/after traces for the most common asks:

- [examples/login-page.md](examples/login-page.md) — "make me a login page"
- [examples/saas-landing.md](examples/saas-landing.md) — "a landing for my SaaS"
- [examples/dashboard.md](examples/dashboard.md) — "a dashboard"

## Handoff

Return the enhanced prompt to whichever skill called you:
- Called by [reframe-design text-to-design](../reframe-design/workflows/text-to-design.md) → return inline, reframe-design picks up with step 2 (write source HTML)
- Called by [reframe-site-loop](../reframe-site-loop/SKILL.md) → write the structured prompt directly into `.reframe/next-prompt.md` per [reframe-site-loop baton-format](../reframe-site-loop/references/baton-format.md)

Never just emit the prompt and wait — always specify "hand to reframe-design" or "written to baton" so the caller knows state.

## Related

- [reframe-design](../reframe-design/SKILL.md) — consumes the enhanced prompt to generate
- [reframe-brand](../reframe-brand/SKILL.md) — if brand is named in user's ask, hand to brand FIRST, then come back to enhance with DESIGN.md loaded
- [reframe-site-loop](../reframe-site-loop/SKILL.md) — always run enhance before writing to baton
