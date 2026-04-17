# Example: CSS-modules export, full trace

Typical happy path. User wants production React, asks for CSS modules, scene has good semantic roles.

## Input

User, in reframe chat:

```
I want to export this pricing page as React with CSS modules so I can drop it into my Vite project.
```

Active scene: `s12` (pricing), compiled with Stripe brand, 6 top-level sections with semanticRoles (nav, hero, plan-toggle, pricing-grid, faq, footer).

## Step 1 — Ask stack (since user already hinted)

User said "CSS modules" — no ambiguity. Skip the question, go to engine call.

## Step 2 — Call engine

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

## Step 3 — Engine output

```
React tree exported → .reframe/exports/pricing-react/ (8 files, target=css-modules)

Entry: src/pages/pricing.tsx
Sections:
  · Nav (nav) → src/components/sections/Nav.tsx
  · Hero (hero) → src/components/sections/Hero.tsx
  · PlanToggle (plan-toggle) → src/components/sections/PlanToggle.tsx
  · PricingGrid (pricing-grid) → src/components/sections/PricingGrid.tsx
  · FAQ (faq) → src/components/sections/FAQ.tsx
  · Footer (footer) → src/components/sections/Footer.tsx
Tokens: src/styles/tokens.css

Notes:
  · css-modules: CSS content currently emitted in comment block within
    component files (Phase 1.1 will split into sibling .module.css). See
    .claude/skills/reframe-to-react/references/roadmap.md.
```

## Step 4 — Relay verbatim to user + help next step

```
Done. Tree written to `.reframe/exports/pricing-react/` with 8 files:

  · src/pages/pricing.tsx (entry — imports + composes 6 sections)
  · src/components/sections/Nav.tsx
  · src/components/sections/Hero.tsx
  · src/components/sections/PlanToggle.tsx
  · src/components/sections/PricingGrid.tsx
  · src/components/sections/FAQ.tsx
  · src/components/sections/Footer.tsx
  · src/styles/tokens.css (Stripe brand as CSS custom properties)

Drop `src/` into your Vite project's `src/`, import pricing.tsx on a
route, and it renders. TypeScript enabled so your tsconfig should
accept it as-is.

One note from the engine: CSS modules target currently puts the CSS
in a comment block within each .tsx file. Phase 1.1 will split into
sibling .module.css files. For now either move the CSS blocks by hand,
or switch target to inline if you prefer single-file styles.
```

## Step 5 — User follow-up

```
Why are the sections equal? Can you make one bigger?
```

That's NOT a reframe-to-react task. Route to reframe-design:

```
That's a layout change to the source scene, not an export concern.
Let me hand to reframe-design edit-design to adjust the tier weights
on the pricing grid, then re-export.
```

## Commentary

### What this skill did

- Asked zero redundant questions (user already specified CSS modules)
- Mapped user preference to `reactTarget: "css-modules"`
- Called `reframe_export` with the right flags
- Relayed engine output verbatim (including the honest Phase 1.1 note)
- Pushed back on follow-up asking for layout changes — routed back to reframe-design

### What this skill did NOT do

- Touch a single line of JSX
- Run `tsc --noEmit`
- Promise Phase 2 features as working
- Paraphrase the engine's path list

### Determinism check

If the user runs the same export again with the same scene state:

```
React tree exported → .reframe/exports/pricing-react/ (8 files, target=css-modules)
Entry: src/pages/pricing.tsx
Sections: [same 6 with same names + paths]
Tokens: src/styles/tokens.css
```

Byte-identical. This is the moat. LLM-rewriting would break it.
