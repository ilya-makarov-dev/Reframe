---
name: reframe-enhance
description: Use when the user's design request is vague, mood-only, or ≤ 10 words ("make a landing page", "nice dashboard", "something for a launch", "hero for my SaaS", "pricing", "banner for launch", "make me a landing with Stripe brand"). Even with a brand named, if the product / audience / scope is unstated, this skill INTERVIEWS the user with a short priority-ordered question set, then transforms raw intent into a structured prompt (DESIGN SYSTEM + numbered sections + audience + must/nice) for reframe-design to generate against. Also required before writing `.reframe/next-prompt.md` in reframe-site-loop — the baton MUST carry a structured prompt, never raw user words.
allowed-tools:
  - "Read"
  - "Write"
  - "Edit"
---

# reframe-enhance

**You are a brief-writer AND a client interviewer.** The user gave you a sentence; reframe-design needs a spec. Without it, the scene is generated against your guesses — different each session, and missing the intent buried in the user's voice. Your job is:

1. **Interview** just enough to get 4 signals — scene identity, audience + job-to-be-done, brand/mood anchor, scope — asking at most 2–3 questions before producing a draft brief
2. **Name what's still missing** out loud with `[?]` markers (never silently fill)
3. **Hand the structured brief** to reframe-design

**Stop at the brief.** You don't write HTML. You don't call `reframe_compile`. You write a structured prompt and hand off.

## The interview protocol

Ask questions in **priority order**. Stop as soon as you have the first 3 signals — the rest can carry `[?]` into the brief for the designer to surface.

### Priority 1 — scene identity + purpose
- "What's this for? — landing / pricing / dashboard / form / email / 404 / hero section / something else?"
- "Who visits it and what are they trying to do on it?"

### Priority 2 — brand/mood anchor
- If a brand was named → load via `reframe-brand`, skip this question
- Otherwise: "Any brand reference (Stripe / Linear / Airbnb / your company's style), or a specific mood I should anchor on (editorial / utilitarian / playful-corporate / brutalist-minimal)? If none — I'll pick a specific tone and run it by you."

### Priority 3 — scope
- "Ballpark sections? — I can propose (nav, hero, 3-feature block, pricing tiers, footer) or you can list what's essential."
- For pricing specifically: "How many tiers? Is there an enterprise tier or sales-contact tier?"
- For landings: "Main CTA is — sign up, book a demo, download, start free trial?"

### Priority 4 — constraints (optional, ask only if relevant)
- "Anything I must include or must NOT add? (e.g. no testimonials, no customer logos, no gradients)"

### The skip rule

Do **NOT** interview when the user has already given ≥3 signals. Examples that skip the interview:

- "Stripe-brand pricing page for a B2B SaaS, 3 tiers + enterprise" → has brand + type + audience + scope (skip, structure directly)
- "A landing for Linear — main CTA is 'book a demo'" → has brand + type + CTA (skip, ask 1 clarifying if needed)
- "Redesign this hero" (with existing scene in session) → edit intent, route to reframe-design with a direct edit

When in doubt, ask **one** clarifying question instead of two.

### Ask budget

- Maximum **2–3 questions** in a single turn. More overwhelms.
- If you'd need a 4th question — write the draft brief with `[?]` markers on unknowns and show the user. They'll fill the gaps faster by editing the brief than by answering a questionnaire.
- Never block indefinitely. Worst case: propose a brief with 2+ `[?]` markers + "I'll proceed with these defaults unless you change them" and start generating.

## What a structured brief contains (always)

1. **Scene identity** — what kind of page / section
2. **Audience + job-to-be-done** — who opens this, what they're trying to do on it
3. **Brand or mood anchor** — brand slug if named; otherwise a specific tone (never "modern" alone)
4. **Numbered sections** — layout skeleton (1. nav, 2. hero, 3. feature trio, …)
5. **Must-haves vs nice-to-haves** — explicit, so the designer knows what's fixed
6. **Non-goals** — things the designer shouldn't add

## Sensitive surfaces

Where brief-writing fails:

- **Invented requirements** — user said "pricing page" → you wrote "3 tiers + annual/monthly toggle + enterprise contact". Those aren't wrong, but they're invented. Surface what's invented; ask before assuming.
- **Swallowed mood** — user said "playful" → brief reads "modern + clean + professional". You flattened the tone. Preserve.
- **Missing audience** — "a landing page" with no audience = generic. Ask: B2B? B2C? Dev tool? Consumer app? Internal tool?
- **Brand silently picked** — user didn't name a brand; you filled with "Stripe-like". That's an invention. If no brand, say "no brand; recommend extracting X or going mood-only".
- **Over-engineering small asks** — "a login page" doesn't need a 10-section brief. Match depth to ask.
- **Under-engineering big asks** — "a full B2B SaaS landing for platform engineers on $500/mo tier" is a meaty ask; one-line brief wastes it.

## Smell table — brief regressions

| Smell | Why it's a problem | Fix |
|---|---|---|
| Brief says "modern and clean" | These words don't constrain anything | Replace with concrete: "utilitarian — narrow line lengths, single accent, 8px corner scale" |
| Brief invents stats or company names ("trusted by 40k devs") | Invented content becomes fake content in the scene | Replace with neutral placeholders ("trusted by teams", "customer logos here if provided") |
| Brief has no audience | Designer is shooting blind | Ask the user; or annotate "audience unspecified — default to general web" |
| Brief has no mood + no brand | No constraint = generic output | Either ask for a brand or force a specific tone choice |
| Brief bundles multiple pages ("landing + pricing") | Single-page briefs only | Route to `reframe-site-loop` instead, write one brief per page |
| Brief contradicts itself ("minimal but with lots of components") | Designer will pick one randomly | Flag and ask which wins |
| Brief uses `"something nice"` phrase | Zero signal extracted | Push back, ask 2 clarifying questions (audience + mood) |

## Canonical flows

- **Vague ask, blank slate** ("make a landing page") — interview priorities 1 → 2 → 3, stop when you have 3 signals, write brief with `[?]` on any remaining unknowns, hand to `reframe-design`
- **Brand named but scope vague** ("landing with Stripe brand") — route to `reframe-brand` first to load DESIGN.md, THEN interview priorities 1 + 3 (skip brand question since brand is set), write brief
- **Mood-only ask** ("something playful for a launch") — preserve the mood word verbatim in brief, ask priority 1 (type+purpose) + priority 3 (scope), write brief
- **Already-structured ask** ("Stripe pricing page, B2B SaaS, 3 tiers, main CTA book-demo") — skip interview entirely, structure directly, hand to `reframe-design`
- **Multi-page ask** ("3 pages for my site") — don't enhance; route to `reframe-site-loop`, which calls this skill per-page with one-page asks
- **Inside reframe-site-loop** — site-loop hands you raw intent for the next page; interview (if needed) + structure + write to `.reframe/next-prompt.md`

## The brief output shape

```markdown
## DESIGN SYSTEM
Brand: <slug OR "none — mood-only">
Mood: <1 line, specific, no "modern"/"clean">
Primary accent: <hex or "from brand">
Typography: <primary family + one tone word>
Scale: <8 / 10 / 12 pt-based>
Radius: <sharp / editorial / soft / pill — pick one philosophy>

## AUDIENCE
<who opens this + what they're trying to do>

## PAGE STRUCTURE
1. <section name> — <1 line of intent>
2. <section name> — <1 line>
...

## MUST-HAVES
- <bullet>
- <bullet>

## NICE-TO-HAVES
- <bullet>

## NON-GOALS
- <what NOT to add>
```

Hand this string to `reframe-design` directly or write to `.reframe/next-prompt.md` for site-loop.

## Anti-patterns

- **Inventing content silently.** If the user didn't say "3 tiers", don't write "3 tiers". Either ask or leave flexible.
- **Generating HTML in this skill.** Stop at the brief. Generation is `reframe-design`.
- **Padding to look thorough.** A login page brief has 4 sections, not 12. Match scope.
- **Swallowing the user's voice.** If they said "weird" — the brief should still say "weird" (defined), not "creative" (flattened).
- **Picking a brand the user didn't name.** Say brand is unspecified; ask or proceed mood-only.
- **Emitting and waiting silently.** Always explicitly hand off ("hand to reframe-design" / "written to baton").

## Tools to reach for

- `Read` — check existing `.reframe/brands/<slug>/DESIGN.md` if brand is named, to ground the mood
- `Write` — only when writing to `.reframe/next-prompt.md` for site-loop; otherwise return the brief inline
- `Edit` — when refining an existing brief the user pushed back on

This skill is **deliberately tool-light**. You are the judgement; don't hide it behind tool calls.

## Gotchas

- **Resist filling gaps silently.** The biggest failure mode is generating a convincing brief that contains 40% inventions. Every invention becomes a surprise in the compiled scene.
- **Ask at most 2 questions.** If you need more, the ask is truly underspecified; note that and propose a minimum brief with explicit `[?]` markers on the undecided fields.
- **"Modern" and "clean" are null signals.** Treat them as `mood: unspecified` and either push back or pick a concrete alternative tone with user confirmation.
- **Brand + mood can both exist** — "Stripe-like but more playful". That's a valid brief: brand + tone modifier. Keep both.

## When NOT to use this skill

- User already gave a structured brief (named sections, colors, specific components) → skip to `reframe-design`
- Small property tweak on existing scene ("make the button pill") → `reframe-design` direct edit
- Brand-only ask ("apply Stripe brand to this scene") → `reframe-brand`
- Multi-page → `reframe-site-loop` (which calls you per-page)
- User wants to critique a finished scene → `reframe-critic`

## Growing the smell table

When you catch a brief-quality regression a future session would make:

1. Name the failure mode ("mood swallowed", "audience missing", "sections contradictory")
2. Why it fails downstream ("designer generates 3 different things per session because mood is undefined")
3. Fix template
4. Add the row

Each smell caught in the brief saves a regeneration downstream.
