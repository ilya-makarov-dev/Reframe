# Workflow: start site (turn 1)

First turn of a multi-page build. Establishes the plan, loads the brand, generates page 1, seeds the baton for page 2.

## When

- User asks to build a site / multiple pages and no `.reframe/SITE.md` exists
- User says "restart the site build" — delete old baton first (see [refresh-cached.md](../../reframe-brand/workflows/refresh-cached.md) pattern for wipe-then-init)

## Preflight

Verify:
- No existing `.reframe/SITE.md` (or user confirmed overwrite)
- Brand identified (named in prompt, or active on session, or user asked about it)
- Mode agreed — manual, agent-chain, or CI

If brand unclear → ask once. Don't proceed without brand.

## Steps

### 1. Load the brand

Hand off to [reframe-brand apply-existing](../../reframe-brand/workflows/apply-existing.md). Come back with DESIGN.md Read + one-line summary. This brand is now **frozen for the entire site** — every page gets the same tokens.

### 2. Collaborate on the sitemap (if not explicit)

If user named pages ("home, pricing, about, 404"), skip to step 3.

Otherwise, propose a sitemap based on domain:

| Domain | Default sitemap |
|---|---|
| SaaS landing | home · pricing · features · signup · 404 |
| Devtool | home · docs · pricing · changelog · 404 |
| Portfolio | home · work · about · contact |
| E-commerce (small) | home · catalog · product · cart · checkout · 404 |
| Content / blog | home · posts · post-detail · about · 404 |

Present as a proposal, ask once: "this match? swap / add / remove any?". Don't fabricate 7 pages when the user said "a simple site".

### 3. Write SITE.md

Use [templates/SITE.md.template](../templates/SITE.md.template) as the skeleton. Fill in:
- Brand slug
- Tone (2-3 adjectives from DESIGN.md atmosphere)
- Target viewport (web 1440 / mobile 390 / both)
- The page table with statuses: all pending except turn-1 page which is `in-progress`

See [references/baton-format.md](../references/baton-format.md) for the exact schema.

```
Write(".reframe/SITE.md", templated content)
```

### 4. Write first page's next-prompt.md

The baton file. Turn-1 page is typically `home` (unless user said otherwise). Use [templates/next-prompt.md.template](../templates/next-prompt.md.template).

The baton's `prompt` field **must be a structured prompt**, not the user's raw words. Run [reframe-enhance](../../reframe-enhance/SKILL.md) on the user's intent for this page, then write the enhanced result into the baton.

```
Write(".reframe/next-prompt.md", baton content)
```

### 5. Initialize metadata.json

```
Write(".reframe/metadata.json", { "scenes": {} })
```

### 6. Generate the first page

Hand off to [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md) with:
- Page slug from baton (`home`)
- Brand slug from SITE.md
- Structured prompt from baton

When reframe-design returns with `sceneId`:

### 7. Update metadata + SITE.md

```
// metadata.json
{ "scenes": { "home": "s12" } }

// SITE.md — flip home from "in-progress" to "done"
```

### 8. Critic pass (optional but recommended)

Hand to [reframe-critic](../../reframe-critic/SKILL.md). If it flags something the user should decide on, surface in the handoff message.

### 9. Write next baton

Pick the next `pending` page from SITE.md. Run [reframe-enhance](../../reframe-enhance/SKILL.md) on it, write:

```
Write(".reframe/next-prompt.md", baton for next page)
```

### 10. Report to user + decide mode

```
Home page built (sceneId: s12, audit clean). Next: pricing.

Mode?
  · "next" — I generate pricing now
  · "review first" — you inspect /platform/project/home, then "next"
  · "run all" — I chain through all pending pages
```

User picks. Act on their answer — for "run all", invoke [advance-page](advance-page.md) in a loop until `status: complete`.

## Rules

1. **No generation before SITE.md exists on disk.** Plan first, then execute.
2. **Brand is identified before SITE.md is written.** The brand name is in SITE.md frontmatter; can't write it without knowing.
3. **Baton prompt is structured.** Always route through [reframe-enhance](../../reframe-enhance/SKILL.md).
4. **One page generated per turn.** Even if mode is "run all", each sub-step is one [advance-page](advance-page.md).

## Failure modes

- **User declines the proposed sitemap** → don't persist; iterate with them until they approve.
- **Brand unavailable / not in catalog** → [reframe-brand refresh-cached](../../reframe-brand/workflows/refresh-cached.md) or [create-custom](../../reframe-brand/workflows/create-custom.md).
- **First-page generation fails audit** → fix before advancing baton. Don't ship a broken page and call it "done" in SITE.md.

## Related

- [advance-page](advance-page.md) — every subsequent turn
- [finalize-site](finalize-site.md) — last turn, site bundle export
- [references/baton-format.md](../references/baton-format.md) — exact file schemas
- [templates/](../templates/) — copy-paste starting points
