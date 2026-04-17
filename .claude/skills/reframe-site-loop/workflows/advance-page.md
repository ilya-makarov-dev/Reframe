# Workflow: advance page (mid-loop turn)

Every turn after the first. Reads the current baton, generates one page, updates nav on all previously-done pages, advances the baton.

## When

- `.reframe/next-prompt.md` exists, has a `page` field, status `pending`
- User typed "next" / approved the plan from [start-site](start-site.md)
- Agent-chain mode is active and has more pages to process

Not this workflow:
- First turn of a site → [start-site](start-site.md)
- Baton shows `page: null, status: complete` → [finalize-site](finalize-site.md)

## Steps

### 1. Read baton

```ts
Read(".reframe/next-prompt.md")
Read(".reframe/SITE.md")
Read(".reframe/metadata.json")
```

Parse baton frontmatter:
- `page: <slug>` — which page to generate this turn
- `brand: <slug>` — must match SITE.md (frozen)
- prompt body — structured DESIGN SYSTEM block + page structure

If baton `page: null` → route to [finalize-site](finalize-site.md) instead.

### 2. Re-confirm brand

DESIGN.md should still be cached from turn 1. Confirm Read (cheap — already local):

```ts
Read(`.reframe/brands/${brand}/DESIGN.md`)
```

If cache was cleared → hand to [reframe-brand apply-existing](../../reframe-brand/workflows/apply-existing.md) to re-extract.

### 3. Generate the page

Hand to [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md) with the baton's structured prompt.

Key detail: pass `brand: <slug>` to `reframe_compile` so the compile-time audit validates against the right DESIGN.md.

### 4. Wire navigation

**Critical step** — this is what makes it a site, not disconnected pages.

Read `metadata.json` to get every done page's slug → sessionId:

```json
{ "scenes": { "home": "s12", "pricing": "s13" } }
```

For the **current page**, update its nav so it points to every done page's route. See [references/nav-wiring.md](../references/nav-wiring.md) for how to find and update nav elements.

Quick version:

```ts
// Find nav nodes in the current scene via semantic role
reframe_inspect({ sceneId: <current>, includeSemantic: true })
// → semantic: [{ role: "nav", nodeId: "n1" }, ...]

// For each nav link, update href to /<slug>
reframe_edit({
  sceneId: <current>,
  op: "update",
  nodeId: <nav-link-id>,
  changes: { href: "/pricing" }
})
```

**Also update previously-done pages' nav** to include a link to the new page (they didn't have it yet). Loop over done sceneIds from metadata, update each.

### 5. Update metadata + SITE.md

```ts
// Metadata
Edit(".reframe/metadata.json", "<old>", "<new>")
// → { "scenes": { "home": "s12", "pricing": "s13", "<new-slug>": "s14" } }

// SITE.md — flip current page from "in-progress" to "done"
Edit(".reframe/SITE.md", "<old status line>", "<new status line>")
```

### 6. Critic pass (optional)

Hand to [reframe-critic](../../reframe-critic/SKILL.md). Surface flags to user only if they're blocking — "brandFidelity dropped below 0.80, site will look inconsistent".

### 7. Write next baton

Pick the next `pending` page from SITE.md. If **none remain**:

```yaml
---
page: null
status: complete
---

Site is done. Run `reframe-site-loop` finalize-site for the nav pass + bundle export.
```

Otherwise run [reframe-enhance](../../reframe-enhance/SKILL.md) on the next page's raw intent from SITE.md, write to baton:

```yaml
---
page: about
brand: linear
status: pending
---

<structured prompt>
```

### 8. Report + continue decision

```
<current> page built (sceneId: s14). Nav updated on home + pricing + <current>.
Next: about.

"next" to continue, or inspect at /platform/project/<current-slug> first.
```

In agent-chain mode: auto-continue to [advance-page](advance-page.md) with no user turn. In manual mode: stop and wait.

## Rules

1. **Nav wiring is non-optional.** Site export depends on real slug links. Skipping = broken site.
2. **Update nav on ALL done pages**, not just the new one. Otherwise older pages don't know the new page exists.
3. **Don't regenerate done pages.** If nav needed an update on an older page, use `reframe_edit` — don't recompile.
4. **Baton prompt stays structured.** Always through [reframe-enhance](../../reframe-enhance/SKILL.md) before writing.

## Failure modes

- **metadata.json out of sync with SITE.md** → SITE.md wins. Rebuild metadata from session scenes:

  ```ts
  // Query current scenes, match by slug to SITE.md's done list
  ```

- **Nav wiring fails on some pages** → report specifically ("couldn't find nav element on `about`"). Don't silently skip; user should know the site nav is partial.

- **User asks an off-plan change mid-loop** ("hold on, redo the home hero") → three options:
  1. Absorb into next baton (if the change is about the NEXT page)
  2. Branch into [reframe-design edit-design](../../reframe-design/workflows/edit-design.md) on the specific scene, resume baton after
  3. Discard the interruption

  Ask user which one. Don't auto-pick.

## Related

- [start-site](start-site.md) — turn 1
- [finalize-site](finalize-site.md) — final turn (when baton is `status: complete`)
- [references/nav-wiring.md](../references/nav-wiring.md) — how to wire nav reliably
