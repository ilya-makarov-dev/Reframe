# Workflow: text → design (new scene)

Use when the user asks to create a new scene from a textual description. This is the **canonical pipeline** — everything else is a variation of it.

## When

- "make / build / design …" a page, landing, section, screen
- "generate a [page type]"
- "I need a [component] for [context]"

Not this workflow:
- Vague one-liner with no brand or structure → first hand to [reframe-enhance](../../reframe-enhance/SKILL.md)
- Brand mentioned but not yet extracted → first hand to [reframe-brand](../../reframe-brand/SKILL.md)
- Multiple pages at once → [reframe-site-loop](../../reframe-site-loop/SKILL.md)

## Steps

### 1. Brand context (gate)

Before anything else, confirm a brand is loaded:

- If user named a brand → ensure `.reframe/brands/<slug>/DESIGN.md` exists; if not, `reframe_design action=extract brand=<slug>` via [reframe-brand](../../reframe-brand/SKILL.md)
- If active scene already has `brand=…` → Read `.reframe/brands/<slug>/DESIGN.md` now to surface colors, type, OpenType features
- If neither → **ask once**: "what brand voice — pick from 60 cataloged brands, neutral defaults, or describe the aesthetic?"

**Never generate HTML without a brand in scope.** The audit's `brandFidelity` rule will fail and the output will look generic.

### 2. Write the source HTML

Generate the full markup yourself, **inline styles only**, respecting [../references/html-rules.md](../references/html-rules.md):

```bash
Write(".reframe/src/<name>.html", html)
```

Always write to `.reframe/src/` before compiling. This preserves the source for later edits and git diffs. Never inline `html:` into `reframe_compile` for anything beyond throwaway tests.

Name convention: `<slug>.html` where slug is kebab-case (`pricing`, `home`, `about`, `hero-with-video`).

### 3. Compile

```ts
reframe_compile({ file: ".reframe/src/<name>.html", name: "<name>" })
```

Return is the `sceneId`. The engine runs the 37-rule audit on compile and returns warnings inline. Fix warnings before proceeding to inspect.

### 4. Inspect

```ts
reframe_inspect({ sceneId, includeSemantic: true })
```

Reads: the scene tree, full audit (`fail | warn | ok` per rule), 8 aesthetic scores (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion, overall), `brandFidelity` score, semantic skeleton.

### 5. Fix loop

Triage by rule severity and cost:

- **Property-level fixes** (color, radius, size, text) → `reframe_edit` with `op: "update"` and the target `nodeId`. Fast, no recompile.
- **Structural changes** (wrong layout, missing section, bad hierarchy) → edit `.reframe/src/<name>.html` in place and **recompile** from the file. Don't chain 5 `reframe_edit` calls for what is really a source-level rewrite.
- **Brand drift** (`brandFidelity < 0.8`) → re-Read DESIGN.md, apply missing tokens (often OpenType features like `ss01`/`tnum`). See [fix-audit.md](fix-audit.md) for rule-by-rule triage.

After each fix → re-run `reframe_inspect` → confirm the targeted rule(s) moved to `ok`.

### 6. Hand to critic (optional but recommended)

When audit is clean (`fail: 0`), offer [reframe-critic](../../reframe-critic/SKILL.md) to review taste. The machine audit catches measurable issues; critic catches genericness, fake content, tone mismatch.

### 7. Export only if asked

```ts
reframe_export({ sceneId, format })
```

Formats: `html / react / svg / png / pdf / lottie / animated_html / site`. Don't export speculatively.

## Failure modes

- **Forgot step 1 (brand)** → scene looks generic, `brandFidelity` fails.
- **Skipped step 2 (Write to disk)** → later iterations regenerate from scratch instead of editing source. Lose git history.
- **Chained 5+ `reframe_edit` calls** for what is really a recompile → edit `.reframe/src/<name>.html` and recompile.
- **Audit still fails after 3 fix iterations** → stop, tell the user which rules and why they're hard. Some audit fails are decisions (e.g. decorative overflow with explicit `clipsContent`), not bugs.

## Worked example

See [../examples/pricing-flow.md](../examples/pricing-flow.md) for a complete trace from prompt to inspect-clean.
