# Workflow: edit existing design

Use when the user wants to change something about a scene that already exists. Not for new scenes — that's [text-to-design.md](text-to-design.md).

## When

- "change the hero background to dark"
- "make the CTA pill-shaped"
- "add a testimonial section between the hero and features"
- "this column feels cramped — give it more room"
- "tighten the padding everywhere"

## The cost heuristic

Every edit has a cost profile. Pick the cheapest tool that does the job.

| Change | Tool | Why |
|---|---|---|
| Color / radius / size / text / single prop | `reframe_edit` op=`update` | One call, no recompile, instant in preview |
| Delete / clone / move node | `reframe_edit` op=`delete` / `clone` / `move` | Same — structural but local |
| Add a new node as child | `reframe_edit` op=`add` | Fast, but fragile for complex children |
| Swap a whole section | Edit `.reframe/src/<name>.html` + recompile | Structural — source stays as truth |
| Layout rethink (grid → stack, card → bento) | Edit source + recompile | Can't patch via edits |
| Apply brand / theme / density across scene | `reframe_edit` op=`defineTokens` / `setMode` / `scaleSpacing` / etc. | Engine handles the fanout |
| Make responsive (mobile/tablet/desktop variants) | `reframe_edit` op=`adapt` | One call, engine derives variants |

## Steps

### 1. Identify the target

Does the user reference a specific node?
- **Chip says "selected: header"** → use `state.selection.nodeId` from preamble, skip inspect.
- **User named a region** ("the hero") → semantic tree from `reframe_inspect includeSemantic=true`, find node by role.
- **Scope unclear** — ask once which node they mean. Don't guess.

### 2. Pick the cost tier

Use the table above. Favor `reframe_edit` over source rewrite when possible. **Never chain 5+ edit calls** when one source rewrite is cleaner.

### 3a. Property edit (fast path)

```ts
reframe_edit({
  sceneId,
  op: "update",
  nodeId: "<target>",
  changes: { /* the prop diff */ }
})
```

Common updates:
- `{ background: { r: ..., g: ..., b: ... } }` — SOLID fill
- `{ cornerRadius: 999 }` — pill
- `{ paddingTop: 64, paddingBottom: 64 }` — vertical space
- `{ characters: "New text" }` — text node content
- `{ fontSize: 72, fontWeight: 600, letterSpacing: -0.02 }` — type
- `{ layoutMode: "VERTICAL" }` — flex direction (will trigger relayout)

### 3b. Source rewrite (structural path)

```ts
Read(".reframe/src/<name>.html")            // read current
Edit(".reframe/src/<name>.html", old, new)  // modify in place
reframe_compile({ file, name })              // recompile
```

Rules:
- Preserve inline-styles invariant. Don't introduce classes or `<style>` tags.
- Preserve the brand's tokens (colors, fonts, OpenType features).
- If the source doesn't exist (old scene, compiled via inline `html:` before we tracked source), fall back to: regenerate source from the current scene state, then modify.

### 4. Re-inspect

```ts
reframe_inspect({ sceneId })
```

Confirm the change didn't regress the audit. If any previously-clean rule turned `fail`, that's on you — revert and try a different approach.

### 5. Report

Tell the user what changed in one sentence. Don't re-announce invariants ("ensured inline styles"). If audit stayed clean, say so ("done, audit still clean"). If a rule flipped, call it out ("`brandFidelity` dropped 0.91 → 0.82 — missing OpenType features on the new text block; want me to add them?").

## Failure modes

- **Edited source but didn't recompile** → scene and source drift. Re-compile.
- **Tried `reframe_edit` for a layout change** → engine updated the prop but next render snaps back because the HTML source is authoritative. Source-edit + recompile.
- **Modified source but broke inline-styles invariant** → compile warns, scene looks wrong. Fix the invariant, recompile.

## Related

- [text-to-design.md](text-to-design.md) — when the change is "start over" rather than "tweak".
- [fix-audit.md](fix-audit.md) — when the edit is specifically a rule fix.
