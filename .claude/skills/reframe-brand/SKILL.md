---
name: reframe-brand
description: Use when the user mentions a brand name (Stripe, Linear, Airbnb, Vercel, Ferrari, Notion, Apple, GitHub, etc.), says "apply brand" / "rebrand" / "use X's style" / "make it feel like Y", OR the active scene has no DESIGN.md yet and you're about to write HTML. This skill carries brand-translation knowledge — how brand intent (vibe, not palette) becomes scene tokens, where brand fidelity usually drops, and the smells that mean "swapped colors, forgot everything else".
allowed-tools:
  - "mcp__reframe__reframe_design"
  - "mcp__reframe__reframe_edit"
  - "mcp__reframe__reframe_inspect"
  - "Read"
---

# reframe-brand

**You are a brand engineer translating identity into tokens.** A brand is not a hex palette — it's weight, corners, motion, type voice, whitespace discipline, the whole pattern. The engine tokenizes whatever you hand it; your job is to make sure what you hand it is the full brand, not its color chip.

The `reframe_design` tool (action=`extract`) pulls 300+ line DESIGN.md files from the getdesign npm catalog (60+ brands cached in `.reframe/brands/<slug>/`). The scene's `brandFidelity` score measures how well its fills, typography, and component specs match those values. Your job is to **carry the brand fully** so that score stays high, not to guess colors from memory.

## Sensitive surfaces

Where brand work tears:

- **OpenType features** — Stripe's `tnum`, Linear's `ss01`, Airbnb Cereal's `cv11`. Missing `font-feature-settings` on every text element drops brand fidelity immediately. Most-forgotten brand detail.
- **Type weight ladder** — brands specify a ladder (400 / 510 / 590 / 700). Scene uses 400/700 only and misses the 510/590 that make the brand feel calibrated.
- **Corner philosophy** — Stripe 8–10px, Linear 6–8px, Airbnb 12–16px. One corner value on every card is corner inflation. Brand says use different radii for cards vs buttons vs pills.
- **Single-accent discipline** — most brands have 1 primary + 1 secondary. Scenes drift to 3 accents because the code eats colors freely.
- **Button height / paddingX** — brands spec 44 or 48 min-height + 16/20 paddingX. Scene uses 36px height and breaks touch target + brand feel.
- **Motion language** — Linear: spring 100/20; Stripe: 250ms ease-out; Airbnb: longer easing. Scenes often default to 200ms ease; brand-specific motion is silent drift.

## Smell table — brand fidelity regressions

| Smell | Means | Probe | Fix |
|---|---|---|---|
| `#635bff` hardcoded, no token | Stripe color used as literal, not via `color.primary` | Grep compiled HTML for exact brand hex; check if `meta.tokenBindings.fill` is set | `reframe_edit` autoBindTokens or re-tokenize via `defineTokens` |
| No `font-feature-settings` in any text node | OpenType features dropped | `probe selector: '*'` all=true, check any computedStyle has non-`normal` font-feature | Re-read DESIGN.md OpenType section, re-compile with features on each text element |
| Scene uses `Inter` but brand is Söhne/Geist/Cabinet | Wrong type family for brand | First text node's `fontFamily` vs DESIGN.md Typography.primary | Swap fontFamily, load Google Font via link or note self-host requirement |
| 3+ high-saturation accents in one scene | Brand drift — single-accent rule broken | Count SOLID fills with saturation > 0.65; group by hue bucket | Demote extras to muted variants or token them as `color.muted-*` |
| All buttons `height: 36px` but brand spec says 48 | Minimum height regression | Walk button/CTA nodes, compare height to DESIGN.md `components.button.minHeight` | `reframe_edit update height: 48` on affected nodes |
| `brandFidelity` dropped below 0.80 after edit | Edit undid tokenization | Run `reframe_inspect` → compare `brandFidelity` before vs after | `autoBindTokens` pass then re-check |
| All corner radii identical | Corner inflation, brand has scale | `cornerRadius` stdev across frames == 0 | Apply per-semantic: cards from `radius.md`, buttons from `button.radius`, pills 9999 |
| Brand dark but scene has `#000` backgrounds | Wrong black — brand specifies `#0a0a0f` etc. | Grep `#000000` in fills | Replace with brand-specific dark (check DESIGN.md Colors.background) |
| Extract returns "Could not load" / timeouts | npm registry unreachable OR slug misspelled | Check `.reframe/brands/<slug>/` exists; try `action: "list"` | If offline: use cached brands only; if slug wrong: fuzzy-match from catalog |

## Canonical flows

- **Apply brand to a new scene** — `reframe_design action=extract brand=<slug>` → Read `.reframe/brands/<slug>/DESIGN.md` → write HTML with the loaded values → `reframe_compile` → check `brandFidelity`
- **Rebrand in place (keep structure, swap tokens)** — `reframe_design action=extract brand=<new-slug>` → `reframe_edit defineTokens` with new brand tokens + `rebrand: true` flag → re-inspect `brandFidelity`
- **Theme mode toggle (light↔dark within same brand)** — `reframe_edit setMode` — no re-extract needed if tokens already defined
- **Custom brand (user has spec)** — Write DESIGN.md manually to `.reframe/brands/<slug>/DESIGN.md`, then apply via tokenize + autoBind
- **Fuzzy reference** — user says "make it feel like GitHub" → `reframe_design action=list search=github` → pick slug → extract

## Anti-patterns

- **Swapping just the background color and calling it "rebranded"** — brand = palette + typography + corners + shadows + motion. If only bg changed, you did color work, not brand work.
- **Generating HTML before loading DESIGN.md** — the engine can't infer brand from a slug. Read first or decline brand-fidelity critique.
- **Mixing brands in one scene** — Stripe's type with Linear's colors = a slop chimera. One brand per scene (or use `reframe_edit rotateColors` for variation, not cross-brand mixing).
- **Filling missing DESIGN.md fields from memory** — DESIGN.md doesn't mention Stripe's exact letter-spacing? Don't guess from recall. Say the field is missing.
- **Regenerating HTML for a rebrand** — rebrand is a token swap (setMode/defineTokens). Regeneration destroys the user's layout for no gain.

## Tools to reach for

- `reframe_design action=extract brand=<slug>` — pull DESIGN.md + cache it in `.reframe/brands/<slug>/`
- `reframe_design action=list [search=X]` — browse 60+ brands, filter by keyword
- `Read .reframe/brands/<slug>/DESIGN.md` — ALWAYS read after extract before any HTML work
- `reframe_edit defineTokens` — tokenize scene colors/type/spacing from DESIGN.md values
- `reframe_edit autoBindTokens` — bind raw fills to the matching tokens after the fact
- `reframe_edit rebrand` (or defineTokens with `rebrand: true`) — swap active brand without regenerating
- `reframe_edit setMode` — switch light↔dark within the same token collection
- `reframe_inspect` — read `brandFidelity` score (0–1) + see which nodes carry token bindings

## Gotchas

- **Catalog timeout offline** — `action: list` spawns `npx getdesign` which needs network. If `ETIMEDOUT`, fall back to `.reframe/brands/` cache contents.
- **DESIGN.md completeness varies** — some brands have exhaustive specs (Stripe, Linear); others are thin (smaller brands). If thin, surface that to the user before generating — don't overcommit.
- **Brand palette roles differ** — `primary` in one brand is a CTA color, in another it's a background anchor. Read the DESIGN.md's intent line, not the hex.
- **First extract is network + parse (~3–5s)**; subsequent loads are local (cached in `.reframe/brands/`). Once cached, re-extracts are only needed when the brand itself changed upstream.
- **`brandFidelity` is 0.0 when no brand is loaded** — not a failure; just means the scene has no brand context. Only treat `brandFidelity` < 0.6 as a regression when a brand IS active.

## When NOT to use this skill

- User says "something minimal" / "modern" / "clean" with no brand name → this is a **mood**, not a brand. Route to `reframe-design` with the adjective embedded.
- User wants to design from scratch without brand ("make a landing page, no specific brand") → go straight to `reframe-design` with `brandFidelity` ignored.
- User asks for multi-page site with one brand → `reframe-site-loop` freezes brand on turn 1; you come back to load DESIGN.md once, then step aside.

## Growing the smell table

When you catch a brand drift pattern a future session would miss:

1. Name the signature ("type weight ladder collapsed", "single-accent rule broken")
2. Write the probe (grep / brandFidelity delta / token binding check)
3. Write the fix
4. Add a row

A brand skill that knows 20 common drift patterns is worth more than a brand skill that re-discovers them each session.
