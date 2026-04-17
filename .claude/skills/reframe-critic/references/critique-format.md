# Critique format — exact output shape

The critic output has two modes: "holds up" (1-line) and "three issues" (≤3 structured items). No deviations.

## Mode 1 — "Holds up"

Use when:
- Audit clean (no fails)
- `brandFidelity ≥ 0.85`
- All aesthetic scores ≥ 0.75
- No slop signature matched

### Shape

```
Holds up. [one-line summary of what passed]. [optional taste watch]. Ship.
```

### Required elements

1. **"Holds up."** — leads the response
2. **What passed** — 2-3 key metrics cited with numbers ("Hierarchy 0.84, brandFidelity 0.94, rhythm 0.86")
3. **Taste watch (optional)** — if a single soft concern exists (low-priority slop signature, a score at 0.75 exactly), call it out in ≤10 words
4. **"Ship."** — terminator; closes the response

### Example

```
Holds up. Alignment 0.91, rhythm 0.88, brandFidelity 0.94. Taste watch: footer links slightly hard to scan — minor. Ship.
```

Or:

```
Holds up. All aesthetic scores above 0.80, brandFidelity 0.97, audit clean. Ship.
```

### Anti-patterns

❌ Don't: "Seems fine."
✅ Do: "Holds up. <specific numbers>."

❌ Don't: invent an issue to seem useful
✅ Do: if nothing is wrong, say so explicitly

## Mode 2 — "Three issues"

Use when pool from [critique.md](../workflows/critique.md) step 4 has ≥ 1 candidate.

### Shape

```
[N] issue[s] worth fixing:

**1. [specific problem]** — [specific fix] — [engine citation]
**2. [specific problem]** — [specific fix] — [engine citation]
**3. [specific problem]** — [specific fix] — [engine citation]

Rest holds: [one-line summary of what passed]. Want me to apply these?
```

### Required elements

1. **Count header** — "Three issues" / "Two issues" / "One issue"
2. **Numbered list** of 1-3 items (never more)
3. **Each item** has three parts:
   - **Specific problem** in bold
   - **Specific fix** (actionable parameters)
   - **Engine citation** (italic OR inline with metric name + value)
4. **"Rest holds"** summary — cite 2-3 metrics that passed so user sees what's okay
5. **"Want me to apply these?"** — callable next step

### Item anatomy

Each item is ONE paragraph, readable in 10 seconds:

```
**[Problem — the observed issue, 8-12 words]** [Extended context, 1 sentence]. [Specific fix with concrete parameters]. [Citation at the end].
```

Example:

```
**1. Hierarchy 0.58 — the three tiers look equally important.** Push the recommended tier: +8px padding, primary accent border, "Recommended" pill above it. The middle-tier-wins pattern pulls eye. *(hierarchy score)*
```

### The three parts broken down

#### Problem statement
Specific observation. Not "hierarchy could be better". Instead: "the three tiers look equally important".

Bad:
```
❌ The hierarchy needs work.
❌ Some elements could be more prominent.
❌ The design feels flat.
```

Good:
```
✅ Primary and secondary CTAs look equally important.
✅ Hero carries too much for a centered layout (headline + 3 stats + CTA + image).
✅ Stat block renders default digits — Stripe's DESIGN.md specifies 'tnum'.
```

#### Fix
Concrete parameters the user (or reframe_edit) can execute. Include:
- Specific values (px, hex codes, font-feature-settings strings)
- Specific node references (IDs if known, semantic role otherwise)
- Specific ops ("reframe_edit update" / "source rewrite")

Bad:
```
❌ Make it more prominent.
❌ Use better hierarchy.
❌ Fix the brand.
```

Good:
```
✅ +8px padding, accent border (#635BFF, 2px), "Recommended" pill above it.
✅ Apply font-feature-settings: 'ss01', 'tnum' to nodes n7, n12, n15.
✅ Move to split 7/5: text content left 58%, visual right 42%.
```

#### Citation
The engine metric or pattern that supports the critique. Options:

- **Aesthetic score**: "hierarchy 0.58"
- **brandFidelity**: "brandFidelity 0.74"
- **Audit rule**: "audit fail: min-touch-target on nodeId n42"
- **Slop signature**: "genericness: three-equal-cards pattern" (no number, but named pattern)

Format: italic at end of paragraph, OR inline with metric call-out.

Examples:

```
**1. Hierarchy 0.58 — ...** [fix]. *(hierarchy score)*
**2. Fake metric: 'Trusted by 40,000 teams' ...** [fix]. *(slop signature: fabricated content)*
**3. Audit fail on min-touch-target...** [fix]. *(audit rule)*
```

### "Rest holds" summary

After the 3 items, **one line** summarizing what passed. Cite 2-3 metrics:

```
Rhythm 0.82, alignment 0.91, harmony 0.88 — rest holds.
```

This tells user "the ones I listed are the main issues; the rest of the scene is fine".

### "Want me to apply?"

Always the closing line. Makes the critique callable. Never leave critique as a list of observations without offering action.

User responses map to action:
- "yes" / "apply all" → execute every fix via reframe_edit
- "apply 1 and 3, skip 2" → execute those two
- "let me do it myself" → acknowledge, stop
- "redesign it instead" → hand to [reframe-design](../../reframe-design/SKILL.md) for full rewrite

## Examples across all modes

See:
- [../examples/holds-up.md](../examples/holds-up.md) — Mode 1 with 1-line
- [../examples/three-issues.md](../examples/three-issues.md) — Mode 2 typical
- [../examples/brand-drift.md](../examples/brand-drift.md) — Mode 2 brand-focused

## Anti-patterns

### Mixing modes

Don't write "Holds up but here are 3 issues". Either holds up or doesn't.

### More than 3 issues

If the pool has 5 candidates, pick 3 and drop 2. Don't pad. Don't over-critique.

```
❌ 5 issues worth fixing...
✅ Three issues worth fixing. (Pool had 5; prioritized by severity.)
```

### Missing fix

Every item MUST have a concrete fix. Critique without fix = noise.

### Missing citation

Every item MUST have a citation (metric, rule, or pattern name). Uncited = "trust me bro" critique.

### No callable close

Every "3 issues" response MUST end with "Want me to apply?". Otherwise user has to ask "so... should I fix these?".
