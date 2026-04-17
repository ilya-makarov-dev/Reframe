# Workflow: fix-audit

Use when the user says "fix the audit", "clean up warnings", "make it pass" — or when a previous step left fails/warns that need triage.

## When

- "fix all the audit errors"
- "why is it warning / failing?"
- As a sub-step in [text-to-design](text-to-design.md) after a compile that returned warnings
- Before any `reframe_export` if the scene still has fails (don't ship broken)

## Steps

### 1. Read the audit

```ts
reframe_inspect({ sceneId })
```

Returns an audit array: `[{ ruleId, severity, nodeId, message, ... }]`. Severity is `fail` (must fix), `warn` (should fix), `ok` (clean).

### 2. Bucket by rule class

Audit rules fall into classes. Pick the strategy per class:

| Rule class | Examples | Strategy |
|---|---|---|
| **Overflow** | `text-overflow`, `node-overflow`, `content-overflow`, `container-underflow` | Increase container size OR set `clipsContent` if decorative |
| **Contrast / WCAG** | `contrast-minimum`, `min-font-size`, `min-touch-target` | Change color or size to meet the numeric threshold the rule cites |
| **Layout consistency** | `sibling-overlap`, `alignment-consistency`, `grid-track` | Reflow via `reframe_edit` layoutMode / gap / padding |
| **Brand fidelity** | `font-in-palette`, `color-in-palette`, `brandFidelity` score | Pull the right token from DESIGN.md — usually an OpenType feature or exact hex |
| **Content** | `no-empty-text`, `no-zero-size`, `no-hidden-nodes` | Either add content / dimensions, or delete the empty node |
| **Aesthetic** (scores 0-1) | `alignment`, `whitespace`, `hierarchy` … | Higher-level — likely a source rewrite, not a prop tweak |

### 3. Fix per-rule

For each `fail`, decide:

- **Single-prop fix?** → `reframe_edit` op=`update` with the minimal `changes`. Cheapest.
- **Multi-prop fix?** → still `reframe_edit`, but combine. Engine applies atomically.
- **Structural?** → source edit, recompile. Usually aesthetic-score fails.
- **Known decision (decorative overflow, intentional low contrast on dim text)?** → set `clipsContent: true` or add `auditSuppress: [ruleId]` to the node. Document the decision in one sentence to the user.

### 4. Re-inspect

```ts
reframe_inspect({ sceneId })
```

Count down the fails. If a fail turned into `ok`, good. If a new `fail` appeared that wasn't there before, you broke something — revert, try a different fix.

### 5. Loop until

- All `fail` → `ok`, OR
- Remaining fails are intentional (user accepted), OR
- 3 iterations without progress — then stop and explain.

## Rule-to-fix cheat sheet

The most common fails and their usual fix:

- `text-overflow` on heading → reduce `fontSize` OR widen container OR set `clipsContent: true`
- `min-touch-target` on button → `height: 44` (or more)
- `contrast-minimum` on text → darken text color OR lighten background; cite the hex pair
- `font-size-role-match` → heading used at body size (or vice versa) — match `fontSize` to the `semanticRole`
- `border-radius-compliance` → radius doesn't match brand's token — pull from `DESIGN.md`
- `visual-hierarchy` (aesthetic) → primary and secondary CTAs same weight — push contrast
- `spacing-grid-compliance` → padding isn't on the 4/8px grid — snap values
- `alignment-consistency` (aesthetic) → edges don't line up across sections — agree one grid and apply

## Non-negotiable rule

**Never mass-suppress rules to ship a scene.** `auditSuppress` is for specific, explained decisions, not silencing noise. If you're tempted to suppress a whole class of rules, the source is wrong — rewrite it.

## Related

- [text-to-design.md](text-to-design.md) — full pipeline that ends with a fix-audit loop.
- [edit-design.md](edit-design.md) — use its tool-selection heuristic; same cost tiers apply.
- [../references/taste-anti-patterns.md](../references/taste-anti-patterns.md) — after the machine audit is clean, check these taste rules too.
