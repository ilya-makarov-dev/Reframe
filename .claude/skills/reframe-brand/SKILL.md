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

## DESIGN.md is the etalon — you walk it, you don't invent

DESIGN.md was designed as a **deterministic reference** so brand work is traversable, not guessed. The getdesign catalog parses a brand into 300+ lines of concrete values (hex, fonts, weights, OpenType tags, radii, shadows, button specs, motion). Once a DESIGN.md is loaded, every field in the compiled scene must trace back to a line in it. **If DESIGN.md doesn't say it, you don't decide it** — you surface the absence.

This is the skill's core discipline. The smells below are all species of the same failure: the scene silently diverged from DESIGN.md, either because a field was dropped in transit or because the skill invented where DESIGN.md was silent.

## The parse pipeline — DESIGN.md is prose; the audit reads a typed object

DESIGN.md is human-readable Markdown. The audit is machine code. The bridge is a **deterministic parser** at [packages/core/src/design-system/parser.ts](packages/core/src/design-system/parser.ts) that walks the 9-section standard (awesome-design-md format) and produces a typed [`DesignSystem`](packages/core/src/design-system/types.ts) object:

```
.reframe/brands/<slug>/DESIGN.md              (prose, 300+ lines)
        │
        ▼    packages/core/src/design-system/parser.ts  (regex + section markers — no LLM)
        ▼
DesignSystem { typography, colors, components, layout, depth, responsive }
        │
        ▼
brandFidelity audit checks scene fills/fonts/radii AGAINST this typed object
```

The 9 sections the parser expects:
1. Visual Theme & Atmosphere
2. Color Palette & Roles
3. Typography Rules
4. Component Stylings
5. Layout Principles
6. Depth & Elevation
7. Do's and Don'ts
8. Responsive Behavior
9. Agent Prompt Guide

**What the parser currently captures** (audit checks this):
- **Typography per role** — hero / title / subtitle / body / caption / disclaimer / button — with fontSize, fontWeight, lineHeight, letterSpacing, textTransform, **OpenType features** (`ss01`, `tnum`, `cv01`, …), and per-breakpoint overrides
- **Colors** — primary / background / text / accent + full role map + gradients
- **Components** — Button variants (style / states / shadow / radius), Card / Badge / Input / Nav specs
- **Layout** — spacing scale, grid, container widths
- **Depth** — shadow layers per elevation tier
- **Responsive breakpoints** — mobile / tablet / desktop overrides

**What is NOT captured** (blind spots the audit cannot check — handle manually):
- **Motion / timing / easing** — HTML doesn't express animation, and the parser currently drops motion specs. Flag as non-goal for static scenes.
- **Voice / tone / copy guidelines** — semantic, not structural; the audit is content-blind.
- **Philosophy prose** (Section 1) — mood and atmosphere read as guidance but don't parametrize the audit.
- **Interaction micro-behavior** — hover cursor changes, focus-ring details beyond the `InteractiveState` fields.

### Debugging when a DESIGN.md field "doesn't count"

If you see a value clearly written in `.reframe/brands/<slug>/DESIGN.md` but `brandFidelity` doesn't penalize its absence in the scene, **the parser probably dropped it**. Check in this order:

1. **Section heading mismatch** — parser splits on `## N. Title` and matches keywords. If a brand's DESIGN.md uses a non-standard section name ("## Colours" vs "## Color Palette"), the section is skipped. Fix: rename the section or extend `findSection` keywords in `parser.ts`.
2. **Value format mismatch** — parser uses regex for hex, rgb, px values. A color written as `oklch(…)` or `hsl(…)` currently slips past the hex extractor. Fix: add the format to the extractor in `parser.ts`.
3. **Field not in `types.ts`** — if DESIGN.md mentions a field the `DesignSystem` type doesn't model (e.g. detailed motion specs), the parser has nowhere to put it. Fix: extend `types.ts` + parser + audit together.

When you catch a parser gap, the bug is in `packages/core/src/design-system/` — not in this skill. Log it, propose the fix, don't work around it by editing the DESIGN.md locally (that breaks other users of the same brand).

### Auto-diff as you go — catch parser drift AND FIX IT without being asked

**The skill's job is to enrich the etalon.** DESIGN.md → parsed `DesignSystem` is the deterministic spine that drives every brandFidelity judgment in the app. Every brand load is an opportunity to tighten that spine. When you catch a mismatch, the default is **fix the parser, not report it** — the skill improves the etalon as a side effect of normal work, and every session leaves the system slightly better calibrated.

This is the inverse of a "bug report" protocol. You don't queue drift for later; you close it now.

**Protocol — run every time you load a brand:**

1. After `reframe_design action=extract brand=<slug>`, `Read .reframe/brands/<slug>/DESIGN.md` and note the **concrete values** in the 9 sections that matter for this scene — hex codes, font weights, radii, button height/padding, shadows, OpenType tags.
2. Call `reframe_inspect` (or read the in-memory DesignSystem) and compare against the parsed fields.
3. Walk the comparison with this smell-list:
   - **Typography role present in prose, absent from `typography[role]`** → section-name mismatch or role keyword missing from parser's allowlist
   - **OpenType tag listed in DESIGN.md, empty `fontFeatures[]`** → regex didn't match the tag notation (`'ss01'` vs `ss01` vs `"ss01"`)
   - **Color written as `oklch(…)` / `hsl(…)` / CSS var, missing from `colors.roles`** → extractor is hex+rgb only
   - **Component spec (Card, Badge, Input, Nav) in prose but `components.<name>` undefined** → subsection keyword miss
   - **Per-breakpoint override described ("mobile: 32px") but `typographyBreakpoints[]` empty** → responsive parser didn't link role × breakpoint
   - **Motion / easing described but no field to hold it** → known `types.ts` gap, NOT a parser bug; flag for the user as "worth modeling?" (architectural decision, not a drop-in fix)
4. **Default action: patch the parser.** For every drift that has an obvious mechanical fix (keyword expansion, regex extension, extractor addition), immediately:
   - Read the relevant section of `packages/core/src/design-system/parser.ts` (or `types.ts` if a new field on the model is needed)
   - Apply a minimal edit — ideally ≤ 10 lines total
   - Re-run `reframe_design extract` on the same brand to confirm the field now parses
   - Add a row to the smell table documenting the drift + the parser change that closed it
   - Tell the user in one sentence what you found and fixed. Don't ask permission for small mechanical patches — patch, verify, move on.
5. **Escalate, don't patch, when:** the fix requires a new `types.ts` field (architectural change that ripples to audit + exporter), the fix would touch more than ~20 lines, the parser change could break another brand already passing, or you can't verify with the currently-loaded brand alone. In those cases: report the drift, propose the fix, wait for the user.
6. **Never edit the DESIGN.md to hide the symptom** — it masks the bug for every other user of that brand. The DESIGN.md is the etalon; the parser catches up to it, not the other way around.

**Why this matters.** The parser is deterministic but the brand catalog evolves — getdesign updates a brand upstream, new brands are added, someone writes `oklch(…)` for the first time. Without this protocol, gaps sit silent for months: fidelity reports 0.92, scene looks "close enough", user never finds out the brand's accent is `oklch(0.65 0.3 250)` and not the fallback `#0071e3`. The skill is the only layer comparing prose against types — be that layer actively, not passively.

**Budget.** A drift scan on a previously-verified brand is < 15 s. A mechanical parser patch is < 5 min. If a single brand load routinely triggers 30 min of parser work, compress — keep a per-brand `verified on <date> / parser hash <X>` note in the smell table and skip re-scan unless the hash changed. The goal is a self-improving system, not a QA loop that blocks every design task.

**Catalog-wide runs are NOT this skill's job.** When the user asks "audit all 60+ brands" / "harden the parser against the whole catalog", that's multi-state orchestrator work, not specialist work — the orchestrator (see `CLAUDE.md § Orchestration → Parallel fix-in-bucket`) drives the parallel-bucket shape and calls this skill's single-brand Auto-diff protocol per bucket. Don't re-implement the parallel machinery here.

## Carrier contract — DESIGN.md → compiled scene

Ten load-bearing axes that MUST flow from DESIGN.md into the rendered scene. Each has a known drop-path (the common way fidelity is lost in transit) and a verification probe. Walk this contract before declaring a brand "applied".

| Axis | Where in DESIGN.md | Common drop | Verification |
|---|---|---|---|
| **1. Palette roles** (primary, secondary, semantic, neutrals) | Colors § | Hex hardcoded into scene, not bound to tokens → `brandFidelity` tanks on later edit | `reframe_inspect` → check `meta.tokenBindings.fill` set on fills |
| **2. Type family** (primary + mono) | Typography § | Missing Google Fonts `<link>` → browser falls back to Inter silently | First text node's computed `fontFamily` == DESIGN.md primary |
| **3. Weight ladder** (e.g. 400 / 510 / 590 / 700) | Typography.weights | Collapsed to 400/700 because the intermediate weights felt "too much" | Count distinct `fontWeight` values across scene ≥ ladder size |
| **4. OpenType features** (ss01, tnum, cv11, …) | Typography.font-feature-settings | NOT applied to every text node (most-forgotten detail) | `probe selector:* all:true` check any non-`normal` `font-feature-settings` |
| **5. Corner scale** (cards vs buttons vs pills have different radii) | Radius § / components.*.radius | Every container gets same radius → corner inflation | `cornerRadius` stdev across frames > 0; cards ≠ buttons ≠ pills |
| **6. Shadow scale** (elevation tiers) | Shadows § | Every card gets the same shadow, or all shadows stripped (flat) | Distinct shadow intensities used; primary emphasis has stronger shadow |
| **7. Button spec** (height, paddingX, radius, weight) | components.button | 36 × 12 defaults because audit wasn't checked | Every button/CTA matches DESIGN.md `minHeight` + `paddingX` + `radius` |
| **8. Spacing rhythm** (4/8/12/16 scale or brand-specific) | Spacing § / layout.grid | Ad-hoc px values (11, 13, 17) because the unit wasn't adopted | All padding/gap values are multiples of brand spacing unit |
| **9. Single-accent discipline** | Colors.accent | 3+ high-saturation accents creep in because the code eats colors freely | Count fills with saturation > 0.65; group by hue; should be ≤ 1 primary + 1 secondary |
| **10. Voice / tone** (when DESIGN.md specifies it) | Voice § / Copy guidelines | Generic AI-gen copy overrides brand voice — Stripe's precise prose becomes marketing-speak | Read copy voice vs DESIGN.md Voice section; mismatch = silent drift |

**Rule:** before calling `reframe_inspect brandFidelity`, re-walk this table on the compiled scene. Fidelity score tells you how bad it is; the contract tells you which axis broke.

## When DESIGN.md is silent — don't fill it

The getdesign catalog varies:

- **Thorough brands** (Stripe, Linear, Airbnb, Vercel, Apple) — 300+ lines, every axis covered. Walk the contract, trust each field.
- **Thin brands** (smaller or newer) — 100–150 lines, often missing motion, OpenType, component specs (button/card/input), spacing scale.

When an axis is absent from DESIGN.md, the only correct moves:

1. **Surface the absence** to the user in plain language — "DESIGN.md doesn't specify button radius; pick 8 px or extend the file?"
2. **Edit the DESIGN.md** (it's a file on disk at `.reframe/brands/<slug>/DESIGN.md`) if the user gives you a value — persist for the next session.
3. **Mark the scene as partial-fidelity** so `reframe-critic` doesn't penalize an axis DESIGN.md never defined.

Never fill from memory. "Stripe's button radius is 8 px" sounds confident but is exactly the kind of invention DESIGN.md exists to prevent.

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
