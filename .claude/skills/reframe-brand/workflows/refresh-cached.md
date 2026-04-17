# Workflow: refresh cached brand

Short workflow. Use when the user asks to re-fetch a brand because:
- The real brand updated (Linear redesigned their site)
- The current cache looks wrong / thin / incomplete
- `getdesign` npm shipped a better extraction

## When

- "refresh the Stripe brand"
- "pull the latest Linear DESIGN.md"
- "this brand cache is outdated, re-extract"

## Steps

### 1. Confirm what to refresh

Short confirmation so the user knows we're wiping cache:

> Refreshing `stripe` brand cache — will delete `.reframe/brands/stripe/` and re-extract. OK?

Skip the confirmation if it's obviously part of a larger explicit task ("refresh Stripe and apply it to this scene").

### 2. Delete the local cache

```ts
Bash({ command: "rm -rf .reframe/brands/<slug>/" })
```

On Windows bash:
```ts
Bash({ command: "rm -rf .reframe/brands/<slug>/" })   // git-bash / msys handles it
```

### 3. Re-extract

```ts
reframe_design({ action: "extract", brand: "<slug>" })
```

Same mechanism as first-time extract, just runs without a cache hit.

### 4. Read + compare

```ts
Read(".reframe/brands/<slug>/DESIGN.md")
```

Quick diff against what the agent remembers from prior sessions (if any):
- Any new colors added?
- Typography changed?
- OpenType features added / removed?

Report the substantive differences in one sentence:

> Linear refreshed. Primary accent shifted `#5E6AD2` → `#6366F1` (slightly more blue). New `cv11` OpenType feature added. Typography scale unchanged.

### 5. Impact on existing scenes

If the user has scenes in the project currently using this brand, warn:

> 4 scenes use the `linear` brand. They still render with the OLD tokens until re-compiled or rebranded in-place. Want me to re-apply `linear` to all of them via [rebrand-in-place](rebrand-in-place.md)?

User decides whether to propagate.

## Rules

- **Never refresh a brand mid-generation.** If `reframe-design` is in the middle of a text-to-design pipeline, finish that pipeline first, then refresh.
- **Confirm deletion** unless it's obviously part of a multi-step intent the user already approved.
- **Report the diff** — not just "done". The user wants to know what changed.

## Related

- [apply-existing.md](apply-existing.md) — if the refresh is step 1 of generating a new scene with the refreshed brand
- [rebrand-in-place.md](rebrand-in-place.md) — to propagate the refresh to existing scenes
