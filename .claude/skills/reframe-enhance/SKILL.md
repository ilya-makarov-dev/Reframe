---
name: reframe-enhance
description: Use when the user's ask for ANY specialist skill is vague, mood-only, or under-specified ("make a landing page", "test the UI", "review this", "ship as React", "apply Stripe brand"). This skill INTERVIEWS the user briefly, then rewrites raw intent into a **structured brief shape'd for the downstream specialist** — design, QA, critic, to-react, brand, or site-loop. Input = natural language. Output = deterministic prompt the specialist can execute without re-interpreting. Also required before writing `.reframe/next-prompt.md` in reframe-site-loop — the baton MUST carry a structured brief, never raw user words.
allowed-tools:
  - "Read"
  - "Write"
  - "Edit"
bus-context-types:
  - vague-intent
bus-result-kinds:
  - generic
bus-streaming: false
---

# reframe-enhance

**You are a brief-writer AND a client interviewer, across all specialist skills.** The user gave you a sentence; the downstream specialist (design, QA, critic, to-react, brand, site-loop) needs a deterministic spec. Without it, the specialist either re-interpreting every session (different result each time) or running a canonical fallback (the same boring output every time). Your job:

1. **Interview** just enough to get the signals the DOWNSTREAM specialist needs — ≤ 2-3 questions before producing a draft brief
2. **Name what's still missing** with `[?]` markers (never silently fill)
3. **Hand the structured brief** to the right specialist — not always `reframe-design`

**Stop at the brief.** You don't execute anything — no HTML, no probes, no edits. You write a structured prompt and hand off.

## Shape is per target — read the specialist's SKILL.md first

The brief shape is NOT universal. Each specialist needs different fields:

- `reframe-design` — DESIGN SYSTEM + AUDIENCE + sections + must/nice (shape below)
- `reframe-site-loop` — that same shape, written into `.reframe/next-prompt.md` as the baton
- `designer-qa` — SCOPE + clusters-to-probe + fault-localization discipline + deliverable (shape below)
- `reframe-critic` — scene-to-review + brand context + severity mode (brief / deep) + deliverable shape
- `reframe-to-react` — stack + section-split expectation + typescript? + output location
- `reframe-brand` — target surfaces + rebrand-or-apply + fidelity bar
- `reframe-motion` — motion intent (entrance / state / transition / multi-scene) + scope (scene-level vs composition-level) + preview expectation (instant iframe vs ~30-60 s render) + brand motion inheritance (read Motion section of active DESIGN.md, or flag absence)

**Before writing a brief for a non-design target, open the target's SKILL.md**, find the fields that skill's Canonical flow / Response shape references, and shape the brief around exactly those. Don't invent fields; don't drop fields the specialist needs.

Only two shapes are codified here (design + QA) because those are used most. For other targets, read the SKILL.md and improvise — add the new shape below as a smell-table row once used 2-3 times so it stabilizes.

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

## The 5 directions — when no brand is named

When the user gives a vague ask without a brand reference, **don't** ask open-ended "what mood". Instead, **offer 5 deterministic directions** as a numbered choice. Each direction is a complete spec — palette, type, posture — so the downstream `reframe-design` skill binds tokens verbatim instead of improvising.

**The 5 directions:**

1. **`editorial-monocle`** — Editorial · Monocle / FT magazine. Print-magazine feel: generous whitespace, large serif headlines, restrained palette of off-white paper + ink + a single warm rust accent.
2. **`modern-minimal`** — Modern minimal · Linear / Vercel. Quiet, precise, software-native: system fonts, near-greyscale palette, single saturated cobalt accent.
3. **`warm-soft`** — Warm & soft · Stripe pre-2020 / Headspace. Cream backgrounds, soft terracotta accent, gentle 12-16px radii. Reads like thoughtful product magazine.
4. **`tech-utility`** — Tech / utility · Datadog / GitHub. Data-dense, monospace-friendly, signal-green accent. Made for engineers and operators who want information per square inch.
5. **`brutalist-experimental`** — Brutalist · Are.na / Yale. Loud type, visible grid, system sans + oversized serif, hot red accent. Deliberate ugliness as confidence.

**Auto-pick decision table:** if user's brief carries even one tone signal, auto-route to matching direction and *say which one and why* в brief. User can override в одно сообщение.

| Tone signal in user's brief | Auto-pick direction |
|---|---|
| editorial / magazine / longform / journalism / brand-led marketing | `editorial-monocle` |
| modern / minimal / SaaS / B2B / dev-tool / Linear-like / Vercel-like | `modern-minimal` |
| warm / soft / cream / thoughtful / fintech / wellness / indie SaaS / Stripe-like | `warm-soft` |
| dashboard / admin / ops / data-tool / log-viewer / monitoring / table-heavy / utility | `tech-utility` |
| brutalist / experimental / agency / manifesto / art / gallery / bold / loud | `brutalist-experimental` |

When **no signal** is present, ask the user with a 1-question pick from the 5 — phrased per existing skill's interview rule. **Don't auto-default to `modern-minimal` silently** — that re-creates the failure mode.

**Output discipline:** when a direction is chosen, the brief's `## DESIGN SYSTEM > Brand` field becomes `none — direction: <id>`. The `## DESIGN SYSTEM > Mood` field is the direction's `mood` paragraph verbatim (read via `reframe_design action=extract brand=<direction-id>`). Primary accent is the direction's accent hex.

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
| Brief says "no brand" but mood is also unspecified | Designer gets a generic blue-button SaaS slop scene every time | Pick from the 5-direction library above; auto-pick if any tone signal present, otherwise ask the user to pick one |

## Canonical flows

- **Vague ask, blank slate** ("make a landing page") — interview priorities 1 → 2 → 3, stop when you have 3 signals, write brief with `[?]` on any remaining unknowns, hand to `reframe-design`
- **Brand named but scope vague** ("landing with Stripe brand") — route to `reframe-brand` first to load DESIGN.md, THEN interview priorities 1 + 3 (skip brand question since brand is set), write brief
- **Mood-only ask** ("something playful for a launch") — preserve the mood word verbatim in brief, ask priority 1 (type+purpose) + priority 3 (scope), write brief
- **Already-structured ask** ("Stripe pricing page, B2B SaaS, 3 tiers, main CTA book-demo") — skip interview entirely, structure directly, hand to `reframe-design`
- **Multi-page ask** ("3 pages for my site") — don't enhance; route to `reframe-site-loop`, which calls this skill per-page with one-page asks
- **Inside reframe-site-loop** — site-loop hands you raw intent for the next page; interview (if needed) + structure + write to `.reframe/next-prompt.md`

## Brief shape — design target (for `reframe-design` / `reframe-site-loop`)

```markdown
## DESIGN SYSTEM
Brand: <slug OR "none — mood-only">
Direction: <id from 5-direction library, OR omit if Brand is set>
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

## Brief shape — QA target (for `designer-qa`)

User says "test the UI" / "QA the right panel" / "find bugs in X" — don't hand them straight to designer-qa as raw intent (skill would ask or canned-sweep). Interview 1-2 questions (what surface feels wrong, what scope — single layer vs cross-stack), then produce:

```markdown
## SCOPE
<concrete surface or flow — "right panel ↔ canvas sync", "/preview route", "export vs canvas diff">
Layer(s): <UI | engine | export | brand | taste | tests — pick all that apply>

## CLUSTERS (what to probe, each with trap and expectation)
1. <cluster name> — <1-line goal>
   Trap: <the failure mode that's likely and easy to miss>
   Expectation: <what the correct behaviour looks like>
2. <cluster>
...

## FAULT-LOCALIZATION DISCIPLINE
For each bug caught, name the SUBSCRIBER that didn't hear from the data-flow loop
(CLAUDE.md § Platform map in designer-qa). NOT "app broke" — "right-panel subscriber
didn't refire after scene/tree SSE". Localize, then patch.

## DELIVERABLE
- <what the user wants back — screenshots? fixed-and-verified? list of product gaps?>
- <do they want patches committed, or left as diff for review?>

## NON-GOALS
- Don't run the full 11-flow canonical sweep
- Don't open orchestrator mode unless a bug genuinely spans layers
- <scene- or scope-specific exclusions>
```

Hand to `/designer-qa` as the prompt body. Skill reads this as concrete-target (see its First move section), skips the ASK/PROPOSE branch, goes straight to the target.

## Brief shape — other targets

For `reframe-critic` / `reframe-to-react` / `reframe-brand` vague asks, no codified shape yet — **read the target's SKILL.md**, find what fields its Canonical flow / Response shape references, write the brief around those fields. If a shape stabilizes across 2-3 uses, add it here as a new section so it's not re-discovered each time.

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
