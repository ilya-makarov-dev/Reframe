# Example: Tailwind target (Phase-2 scaffold behavior)

User asks for Tailwind. Phase 2 full implementation isn't ready; the engine emits inline-style components PLUS a `tailwind.config.ts` sketch. Your job as the skill: be transparent about the scaffold.

## Input

User:

```
Give me the React code with Tailwind for my Next.js app.
```

Active scene: `s15` (landing), Linear brand.

## Step 1 — Ask? No, user specified Tailwind

Go to engine.

## Step 2 — Call engine

```ts
reframe_export({
  sceneId: "s15",
  format: "react",
  reactTree: true,
  reactTarget: "tailwind",
  typescript: true,
  reactOutputBase: "app",   // Next.js 13+ App Router convention
  reactPageSlug: "page",
})
```

## Step 3 — Engine output

```
React tree exported → .reframe/exports/page-react/ (6 files, target=tailwind)

Entry: app/pages/page.tsx
Sections:
  · Nav (nav) → app/components/sections/Nav.tsx
  · Hero (hero) → app/components/sections/Hero.tsx
  · Features (features) → app/components/sections/Features.tsx
  · Footer (footer) → app/components/sections/Footer.tsx
Tokens: app/styles/tokens.css

Notes:
  · target=tailwind: NOT YET IMPLEMENTED — falling back to inline styles.
    A tailwind.config.ts sketch is emitted with brand tokens if
    designSystem is provided.
```

## Step 4 — Relay to user HONESTLY

**Don't hide the scaffold.** User asked for Tailwind, got inline. Be upfront:

```
Tree written to `.reframe/exports/page-react/` with 6 files, but with a
caveat — full Tailwind class emission is Phase 2, not yet shipped. What
you got:

  · 4 section files (Nav, Hero, Features, Footer) with **inline style
    objects** — visually identical to Tailwind output, but not using
    utility classes yet.
  · `app/styles/tokens.css` — Linear brand as CSS custom properties.
  · `tailwind.config.ts` — a sketch extending theme.extend with Linear's
    colors + fontFamily. Merge into your project's real config.
  · `app/pages/page.tsx` — entry page.

Two options for you:
  1. Ship inline styles now — works, just not Tailwind-idiomatic. Fine
     for a first draft.
  2. Wait for Phase 2, which emits proper className="bg-primary text-ivory"
     patterns. Roadmap at .claude/skills/reframe-to-react/references/roadmap.md.

Or switch target:
  · `reactTarget: "css-modules"` — fully implemented, works today, no
     Tailwind but clean separation.

Which would you prefer? I can re-run with css-modules in one call.
```

## Step 5 — User responds

### Case A: "just use inline then, I'll port to Tailwind later"

No re-export needed. They already have the files. Offer:

```
Keep the tree as is. The tailwind.config.ts sketch in the root has
your Linear tokens already mapped to Tailwind theme extension, so
porting class-by-class you'll reference the right values. If you hit
friction porting specific sections, send me the section name and I
can suggest which classes match the inline styles.
```

### Case B: "switch to css-modules"

Re-call with new target:

```ts
reframe_export({
  sceneId: "s15",
  format: "react",
  reactTree: true,
  reactTarget: "css-modules",
  reactOutputBase: "app",
  reactPageSlug: "page",
})
```

### Case C: "how close is Phase 2?"

Point to roadmap; don't invent a date:

```
Phase 2 is planned but unscheduled. Signals for prioritization are in
references/roadmap.md. If you need it sooner, filing a clear ask in
issues helps. For now css-modules is the best production target.
```

## Commentary

### The transparency rule

Never present scaffold-mode output as complete. Users will deploy it and be surprised. Phase 2 semantics are:
- Option accepted (so call sites don't break when feature lands)
- Fallback behavior is documented
- Notes in the engine output flag the scaffold
- Skill RELAYS the notes — doesn't hide them

### Why emit the tailwind.config.ts sketch anyway?

Even though components aren't class-rendered yet, the theme extension IS deterministic and useful:
- User gets the Linear tokens in Tailwind format
- They can start porting sections one at a time
- When Phase 2 lands, the config is already in place, components just need re-export

It's a partial delivery that doesn't pretend to be full.

### The anti-pattern

```
❌ "Here's your Tailwind React code! Drop it in and ship."
```

The components are inline-styled, not Tailwind. User discovers this later, bad experience.

```
✅ "Here's a tree with inline styles + a tailwind.config.ts sketch.
Full class emission is Phase 2. Options for you: ..."
```

Honest, useful, offers the alternative (`css-modules`) that IS fully done.
