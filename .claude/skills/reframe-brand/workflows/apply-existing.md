# Workflow: apply existing brand

Use when the user mentions a brand name and wants a **new** scene (or modification) generated using that brand. The brand is assumed to be in reframe's catalog; if not, fallback is noted.

## When

- "make a landing with Stripe brand"
- "use Linear's style"
- "generate a dashboard, Notion vibe"
- Active scene has no brand set and user asks for a generation

Not this workflow:
- Brand already loaded + user wants to swap it on existing scene → [rebrand-in-place.md](rebrand-in-place.md)
- Brand cache stale → [refresh-cached.md](refresh-cached.md)
- User gives a custom style brief with no named brand → [create-custom.md](create-custom.md)

## Steps

### 1. Resolve the brand slug

Brand names in English, short, lowercase, hyphenated:
- `stripe`, `linear`, `airbnb`, `notion`, `apple`, `vercel`, `github`, `openai`, `anthropic`, `tesla`, `ferrari`

See [../references/brand-catalog.md](../references/brand-catalog.md) for the top-30 with profiles. If the user's reference is fuzzy ("GitHub-ish", "Notion-like"), use the catalog to pick the closest slug.

If you're unsure whether a brand is in the catalog:

```ts
reframe_design({ action: "list" })
// → { brands: ["stripe", "linear", ...60+ entries] }
```

### 2. Check local cache first

If `.reframe/brands/<slug>/DESIGN.md` already exists, **skip extract**. Jump to step 4 (Read).

You can check via:

```ts
Bash({ command: "ls .reframe/brands/<slug>/DESIGN.md 2>/dev/null" })
```

Or infer from a prior `reframe_design action=list` call.

### 3. Extract (first-time load)

```ts
reframe_design({ action: "extract", brand: "<slug>" })
```

What happens:
- Fetches from `getdesign` npm catalog
- Writes `.reframe/brands/<slug>/DESIGN.md` (300+ lines typical)
- May also cache supporting assets (logo SVGs, sample palettes)

**Failure modes:**
- Brand not in catalog → tool returns error. Options:
  - Offer closest matches from [../references/brand-catalog.md](../references/brand-catalog.md)
  - Fallback to [create-custom.md](create-custom.md) if user can describe the aesthetic
  - Ask user to pick a neutral brand (e.g. `vercel` is a safe "modern minimal" default)
- Network error → retry once. If still fails, tell the user "catalog unreachable — want to proceed with a neutral brand or describe this one yourself?"

### 4. Read the DESIGN.md

This is **mandatory**, not optional:

```ts
Read(".reframe/brands/<slug>/DESIGN.md")
```

Walk through it mentally against [../references/designmd-anatomy.md](../references/designmd-anatomy.md) — a good DESIGN.md has:
- Color palette (bg, surface, accent, text-primary/secondary, muted)
- Typography (family, weight scale, size scale, letter-spacing)
- **OpenType features** (ss01, tnum, cv11, etc.) — **the #1 missed detail**
- Component specs (buttons, cards, badges, inputs, nav)
- Spacing scale (specific pixel values)
- Shadows (or "no shadows" — also a decision)
- Atmospheric tone ("minimal", "editorial", "brutalist")

If a section is **thin or missing**, flag it in your handoff summary so `reframe-design` knows to fill gaps with sensible defaults (and the user knows why the output may deviate).

### 5. Hand off

Return control to [reframe-design](../../reframe-design/SKILL.md) with a **one-line summary** of what you loaded:

> Loaded Stripe brand: `#0A2540` base / `#635BFF` accent (one-and-only), Stripe Sans with `font-feature-settings: 'ss01', 'tnum'` on every text node, 24px radius on primary CTAs, subtle shadow system. Full specs in `.reframe/brands/stripe/DESIGN.md`.

This sentence is the bridge — `reframe-design` picks it up and starts generation with the key tokens in mind.

## Rules

1. **Don't regenerate after loading brand.** If the active scene already exists and matches the brand, reload isn't needed — just reference the DESIGN.md.
2. **Don't mix brands.** One brand per scene. Hybrid needs [create-custom.md](create-custom.md) to write a remix DESIGN.md first.
3. **Don't fake OpenType.** If DESIGN.md specifies features, they MUST land in the HTML. If it doesn't specify, don't invent them.
4. **Never fabricate DESIGN.md content.** If extract fails, that's a user-facing message, not a silent fallback to guessed values.

## Examples

**"make a SaaS landing with Stripe brand"**
1. Slug: `stripe`
2. Check cache → exists
3. Skip extract
4. Read `.reframe/brands/stripe/DESIGN.md`
5. Summarize → hand to `reframe-design` workflow `text-to-design`

**"something like Airbnb but for B2B"**
1. Slug: `airbnb`
2. Check cache → missing
3. `reframe_design action=extract brand=airbnb`
4. Read, note the warmth / rounded components
5. Summarize to `reframe-design`; the "B2B" twist is a reframe-design concern, not reframe-brand's

**"use whatever brand is already on this scene"**
- Check `state.selection` preamble for brand metadata, OR
- `reframe_inspect sceneId` and look for `brand` field
- If set → Read DESIGN.md, no extract
- If not set → ask user to pick
