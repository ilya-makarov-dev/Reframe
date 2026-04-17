# reframe MCP tool schemas

These are the shapes of the reframe MCP tools you call most often. Full schemas are auto-loaded by Claude Code from the MCP server's `listTools` output — this file is for quick human reference and selection hints.

## `reframe_compile`

Take HTML → produce scene + audit.

```ts
reframe_compile({
  // Two input modes — always prefer `file` over `html`:
  file?: string          // e.g. ".reframe/src/home.html" — source survives
  html?: string          // inline — only for throwaway compiles
  name?: string          // slug for the scene (default: filename)
  brand?: string         // optional brand slug to validate against
})
// → { sceneId, audit: [{ ruleId, severity, ... }], warnings }
```

**Always use `file:`** unless the HTML is truly throwaway — the source file is the commitable / diffable artifact.

## `reframe_inspect`

Read the scene's structure + quality signals.

```ts
reframe_inspect({
  sceneId: string
  includeSemantic?: boolean  // returns semantic skeleton (hero / nav / footer / …)
  includeAesthetic?: boolean // default true — returns 8 scores + overall
  diff?: string              // compare against another sceneId or brand slug
})
// → {
//     tree: { ... },
//     audit: [ { ruleId, severity: 'fail'|'warn'|'ok', nodeId, message } ],
//     aesthetic: { alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion, overall },
//     brandFidelity: 0..1,
//     semantic?: [ { role, nodeId, ... } ],
//     diff?: { added, removed, modified },
//   }
```

Without `sceneId` → returns the design-language reference doc (INode types, spacing guide) for bootstrapping.

## `reframe_edit`

All mutations go through here. One tool, many ops:

```ts
reframe_edit({
  sceneId: string,
  op: "update" | "add" | "delete" | "clone" | "resize" | "move"
     | "defineTokens" | "setMode"
     | "scaleSpacing" | "scaleRadius" | "scaleShadows" | "rotateColors" | "typographyPreset"
     | "iterate" | "adapt" | "vary",
  ...op-specific args
})
```

### Structural ops

- `update` — patch node properties: `{ nodeId, changes: { fontSize: 48, background: {...} } }`
- `add` — create child: `{ parentId, type: 'FRAME' | 'TEXT' | ..., name?, props? }`
- `delete` — remove node: `{ nodeId }`
- `clone` — duplicate: `{ nodeId, intoParentId? }`
- `move` — reparent: `{ nodeId, intoParentId, index? }`
- `resize` — set dims: `{ nodeId, width, height }`

### Theming ops

- `defineTokens` — replace design tokens: `{ tokens: { colors, type, spacing, radius, shadows } }`
- `setMode` — switch light/dark: `{ mode: 'light' | 'dark' }`

### Variation ops (scale across scene)

- `scaleSpacing` — density: `{ factor: 0.9..1.3 }`
- `scaleRadius` — corner strategy: `{ value: 'sharp' | 'editorial' | 'soft' | 'pill' }`
- `scaleShadows` — elevation: `{ value: 'flat' | 'subtle' | 'normal' | 'dramatic' }`
- `rotateColors` — hue shift: `{ degrees: 0..360 }`
- `typographyPreset` — swap type system: `{ preset: 'dramatic' | 'flat' | 'editorial' | 'technical' | 'friendly' }`

### Flow ops

- `iterate` — audit + fix loop (agent-driven, don't use inside agent chats)
- `adapt` — responsive variants: `{ sizes: ['1440', '768', '390'] }` → emits new sceneIds
- `vary` — Cartesian grid: `{ axes: { density: [0.9, 1.0, 1.1], radius: ['sharp', 'pill'] }, limit? }` → emits N new sceneIds

## `reframe_export`

Deliver a scene as a file.

```ts
reframe_export({
  sceneId: string,
  format: 'html' | 'react' | 'svg' | 'png' | 'pdf' | 'lottie' | 'animated_html' | 'site',
  path?: string  // defaults to .reframe/exports/
})
// → { path, bytes, preview? }
```

Format notes:
- `html` — standalone, inline styles, portable
- `react` — raw dump (one file). For production-ready tree use [reframe-to-react](../../reframe-to-react/SKILL.md).
- `svg` — for static icons / hero illustrations
- `png` / `pdf` — via CanvasKit rasterizer
- `lottie` — for animated scenes with a timeline
- `animated_html` — CSS/WAAPI animation
- `site` — multi-page bundle (for [reframe-site-loop](../../reframe-site-loop/SKILL.md) output)

## `reframe_design`

Brand catalog + extract. See [reframe-brand](../../reframe-brand/SKILL.md) for full flow.

```ts
reframe_design({
  action: "list" | "extract" | "apply",
  brand?: string  // required for extract / apply
})
// list   → returns brand slugs already in .reframe/brands/
// extract → pulls DESIGN.md from getdesign npm catalog (60+ brands)
// apply  → applies brand tokens to current scene (no regeneration)
```

## `reframe_project`

Project-level persistence. Rare in agent flows — mostly for saving / loading / history:

```ts
reframe_project({
  action: "save" | "load" | "history" | "content" | "macros" | "brands" | "components",
  ...
})
```
