# Engine options — `reframe_export` React tree parameters

Every parameter supported by the engine-side tree exporter, with examples. The engine's TypeScript source is at `packages/core/src/exporters/react.ts` (search for `exportToReactTree`).

## Core flags

### `format: "react"`

Required. Selects the React exporter.

### `reactTree: true`

Opt-in for multi-file tree output. Without this flag (or its implicit siblings below), `format: "react"` returns the single-file dump — useful for throwaway exports, not production.

**Implicit enablement:** any of the `react*` options below being set also triggers tree mode (treat them as "if you set this, you want a tree").

## Tree options

### `reactTarget: "inline" | "css-modules" | "tailwind" | "styled-components"`

Styling strategy. Default: `"inline"`.

| Value | Status | What you get |
|---|---|---|
| `"inline"` | ✅ Phase 1 | Inline style objects on each element, same as single-file export but split across files |
| `"css-modules"` | ✅ Phase 1 | Each section component has a sibling `.module.css` — classname imports at top |
| `"tailwind"` | ⚠️ Scaffolded | Falls back to inline; emits `tailwind.config.ts` sketch for Phase 2 |
| `"styled-components"` | ⚠️ Scaffolded | Falls back to inline |

The engine returns a `notes` array in its response flagging any fallback.

### `reactExtractSections: boolean` (default `true`)

Split top-level children of the root with `semanticRole` into their own files under `src/components/sections/<Name>.tsx`.

**Behavior:**
- If any child has semanticRole → those children are extracted (trust the classifier)
- If no children have semanticRole → fallback: children with ≥ 3 descendants are treated as sections
- If still nothing → single-file fallback: entry page contains full scene inline

### `reactExtractPrimitives: boolean` (Phase 2 — scaffolded)

Accepts the option; currently no-op. Intended behavior when implemented: shape-hash repeating subtrees (Button, Card, Badge) and extract to `src/components/ui/`.

### `reactExtractHooks: boolean` (Phase 3 — scaffolded)

Accepts the option; currently no-op. Intended behavior: detect state-bearing nodes and scaffold `src/hooks/useX.ts` files.

### `reactOutputBase: string` (default `"src"`)

Root of emitted paths. Change if your project uses `app/` (Next.js) or `lib/` (Remix) convention:

```ts
reactOutputBase: "app"
// → app/components/sections/Hero.tsx, app/pages/pricing.tsx, ...
```

### `reactPageSlug: string`

Entry page filename stem. Default: scene slug (kebab-case of scene name).

```ts
reactPageSlug: "pricing"
// → src/pages/pricing.tsx (the entry)
```

### `typescript: boolean` (default `true`)

Emit `.tsx` with type annotations. Set `false` for plain `.jsx`.

### `componentName: string`

Override the section component name derivation. Rare — use only when you want a specific name on the single-file fallback path.

## Input structure (full example)

```ts
reframe_export({
  sceneId: "s12",
  format: "react",
  reactTree: true,
  reactTarget: "css-modules",
  reactExtractSections: true,
  reactOutputBase: "src",
  reactPageSlug: "pricing",
  typescript: true,
})
```

## Output shape (from the tool's text response)

```
React tree exported → .reframe/exports/pricing-react/ (7 files, target=css-modules)

Entry: src/pages/pricing.tsx
Sections:
  · Nav (nav) → src/components/sections/Nav.tsx
  · Hero (hero) → src/components/sections/Hero.tsx
  · PricingGrid (pricing-grid) → src/components/sections/PricingGrid.tsx
  · Footer (footer) → src/components/sections/Footer.tsx
Tokens: src/styles/tokens.css
```

If the user passed unsupported options (tailwind target, extractPrimitives, extractHooks), the output includes a `Notes:` block:

```
Notes:
  · target=tailwind: NOT YET IMPLEMENTED — falling back to inline styles...
  · extractPrimitives: NOT YET IMPLEMENTED — shape-hash subtree deduplication is planned...
```

**Always relay the Notes block to the user verbatim.** Don't hide unimplemented-feature notices.

## Engine guarantees

- **Deterministic:** same scene + same options → byte-equal file tree. Re-running adds nothing (except updating mtime).
- **Fidelity:** the rendered pages match the original scene's visual output (same style objects / CSS Modules produce same final CSS as single-file export).
- **No LLM:** no transformation calls an LLM. This skill is orchestration only.

## Related

- [output-tree.md](output-tree.md) — what the file tree looks like per target
- [roadmap.md](roadmap.md) — what's Phase 1 vs Phase 2/3
- Engine source: `packages/core/src/exporters/react.ts` (`exportToReactTree`)
