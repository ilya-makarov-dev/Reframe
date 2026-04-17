# Workflow: critique

One linear pipeline. Read engine metrics → rank → combine with LLM-only checks → emit output in the required format.

## Steps

### Step 1 — Read the numbers

```ts
reframe_inspect({ sceneId, includeSemantic: true })
```

Capture:
- `audit: []` — per-rule fail/warn/ok
- `aesthetic: { alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion, overall }` — 0..1 scores
- `brandFidelity: 0..1`
- `semantic: []` — tree with semantic roles

Also Read the active brand's DESIGN.md if set:

```ts
Read(".reframe/brands/<slug>/DESIGN.md")
```

Without both inputs → say "nothing to critique without inspect data" and stop.

### Step 2 — Rank the measurable issues

**Machine issues first** (cited with a number the user can believe):

1. **Audit fails** — any rule with `severity: 'fail'` is a blocker. If present, at least one of your 3 items must address these. Don't hide fails.
2. **`brandFidelity < 0.8`** — specific fix direction is in [score-translation.md](../references/score-translation.md); usually missing OpenType or off-palette colors.
3. **Low aesthetic scores** — rank from lowest to highest. Your pool of candidates = the 2-3 lowest. Use [score-translation.md](../references/score-translation.md) to turn the score into a concrete issue.

Calculate the "critique pool":

```
pool = [
  ...auditFails.map(toIssue),
  ...(brandFidelity < 0.8 ? [brandFidelityIssue] : []),
  ...aestheticScoresBelow(0.7).slice(0, 2).map(toIssue),
]
// pool size = 0..5+
```

### Step 3 — Add LLM-only checks

Against the semantic tree and HTML, check for slop-signatures from [slop-signatures.md](../references/slop-signatures.md):

- **Genericness** — layout matches a known AI-template pattern (3-equal-cards / centered-hero-with-stats / feature-grid-with-icon-top / "Why choose us")
- **Fake content** — generated testimonials with invented names, fabricated metrics the user didn't specify, made-up logos in social proof
- **Tone mismatch** — visual tone wrong for domain (funeral home in orange, bank in Comic Sans energy, children's game in brutalist grayscale)

These are **not measurable**. They require reading the content and layout with design judgment. If any match → add to the pool.

### Step 4 — Rank + pick ≤3

Priority order for picking the final 3:

1. **Any audit fail must be in the output.** Blocking issues first.
2. **brandFidelity < 0.8** if present — brand drift is the user's most visible regression.
3. **Worst aesthetic score** (lowest single metric) — the user's eye will land here first.
4. **Slop signature** (genericness / fake content / tone mismatch) — these are the LLM-only value-add.
5. **Second-worst aesthetic score** — if there's room.

Drop anything beyond 3. If pool has > 3 candidates, note in your handoff that there's more and user can ask for a deeper pass.

If pool is **empty** → output "holds up" shape (see [critique-format.md](../references/critique-format.md)).

### Step 5 — Write each item

Format per [critique-format.md](../references/critique-format.md). Each item:

1. **Specific problem** — not "hierarchy could be better"; write "the three tiers look equally important"
2. **Specific fix** — actionable parameters; "Push recommended tier: +8px padding, accent border, 'Recommended' pill"
3. **Engine citation** — score + number, OR rule id + nodeId, OR brandFidelity delta

### Step 6 — Emit output

Always ends with **"Want me to apply?"** when there are issues. This makes the critique callable — user says yes → hand back to [reframe-design](../../reframe-design/SKILL.md) to execute the specific edits.

If "holds up" → 1-line summary, no call-to-apply, done.

### Step 7 — If user says "apply"

Parse their answer:
- **"yes"** / "apply all" → execute every fix via `reframe_edit`, then re-run `reframe_inspect` to confirm the scores moved up
- **"apply 1 and 3, skip 2"** → execute those two
- **"no, leave it"** → acknowledge, stop

After execution, report the delta:

```
Applied 2 fixes. Hierarchy 0.58 → 0.81. brandFidelity 0.74 → 0.93.
Audit still clean. Done.
```

Do NOT re-critique automatically on the next turn. User has to ask.

## Anti-patterns

### Restating the audit

```
❌  The audit shows one failed rule.
✅  Audit fail on `min-touch-target`: the "See all plans" link is 32px tall. Set height: 44 and padding: 12.
```

Always translate + fix. Don't just read the audit back to user.

### Vague recommendations

```
❌  The hero could be more impactful.
✅  The hero is centered but carries too much — move to split 7/5: image right 50%, text left 50%.
```

### Over-numerous criticism

```
❌  Here are 9 things I noticed...
✅  Three issues worth fixing...
```

3 is the cap. If you have more, rank and drop.

### Blaming user's copy

```
❌  The headline "Build products at speed" feels generic.
✅  (don't critique it — they wrote it. Critique type/layout/structure only.)
```

### Silent on brand drift

If brandFidelity < 0.8 and you don't mention it → the critique misses the biggest lever. Always flag brand drift above 0.2 delta.

## Examples

See [../examples/](../examples/) for before/after traces:

- [holds-up.md](../examples/holds-up.md) — clean scene
- [three-issues.md](../examples/three-issues.md) — typical critique
- [brand-drift.md](../examples/brand-drift.md) — brand-focused

## Related

- [../references/score-translation.md](../references/score-translation.md) — score → issue mapping
- [../references/slop-signatures.md](../references/slop-signatures.md) — LLM-only checks
- [../references/critique-format.md](../references/critique-format.md) — exact output shape
