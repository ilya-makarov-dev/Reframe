---
name: reframe-design
description: Use when the user asks to design / build / make / redo a scene — a page, landing, section, hero, dashboard, form, nav, footer, card, component, feature panel, 404, or any visual surface inside a reframe session. Not for rebranding alone (→ reframe-brand), not for multi-page sites (→ reframe-site-loop), not for vague one-liners without any specificity (→ reframe-enhance first). This skill carries taste knowledge the 37-rule audit cannot encode — anti-slop patterns, tension cues, and the smell table of "this compiles clean but reads fake".
allowed-tools:
  - "mcp__reframe__*"
  - "Read"
  - "Write"
  - "Edit"
---

# reframe-design

**You are a senior designer writing HTML.** The reframe engine is deterministic: it validates against a 37-rule audit, scores 8 aesthetic metrics, and measures brand fidelity. Your job is **not** to duplicate that work — the engine already knows what's wrong. Your job is to:

1. Translate human intent into inline-styled HTML the engine can compile
2. Know where the engine stays **silent** (taste, genericness, fake content, layout tension)
3. Carry accumulated taste across sessions via the smell table below

The engine catches structural regressions automatically. You catch the patterns that pass every rule and still read as AI slop.

## Sensitive surfaces

Where designs trip — check these before compiling, and especially after:

- **Genericness shape** — 3 equal cards horizontally, centered hero with 5 things in it, text+image 50/50 split, gradient-glass backdrop on everything. Machine-clean, human-obvious AI-slop.
- **Fake content** — invented stats ("40k engineers"), invented logos ("Trusted by ACME / Globex"), invented testimonials ("Sarah, CEO at nowhere"). Single loudest tell that a human didn't write this.
- **Typography for context** — Inter in a premium/editorial scene reads as "default Claude-gen". Serif in a dashboard reads as archaic. Match the type to the scene's job.
- **Color discipline** — pure `#000`, two accents above 80% saturation, corner radius inflation (every container 16px, nothing square), shadow inflation (every card gets a shadow "for depth").
- **Centered hero variance** — centering is only safe when the hero has ≤3 elements total (headline + sub + CTA). Add a badge, a stat row, a secondary CTA, an image — now it needs an asymmetric layout.
- **Interaction targets** — the audit enforces 44px touch. But secondary ghost CTAs often drift to 36px and pass because of min-height; user still can't tap them on mobile.

## Smell table — the patterns the audit cannot catch

| Smell | Why it reads fake | Probe | Fix |
|---|---|---|---|
| "Trusted by 40,000 engineers" (or any round number) | Invented social proof | Grep compiled HTML for round-number stats near "trusted/used/loved by" | Use neutral labels — "trusted by teams", "built for engineers", no number |
| 3 feature cards equal-width horizontal | AI-slop template signature | `probe .feature-grid > *` count == 3 + same w/h | Bento / asymmetric / zig-zag / vertical stack |
| Hero is centered AND has ≥4 top-level children | Variance too high for centering | Count direct children of the hero frame; if > 3 and `primaryAxisAlign=CENTER` | Left-align, keep the badge/stats off-axis |
| All corner radii == 16px (or any single value) | Corner inflation | Scan `cornerRadius` across frames; stdev == 0 | Scale by semantics — cards 12–16, buttons 6–8, pills 9999 |
| Every card has a shadow | Shadow inflation, reads as template | Count shadows per section; if > 2 of same intensity | Pick 1 primary emphasis — remove the rest |
| `Inter` on a scene calling itself "premium", "editorial", "luxury" | Wrong type for context | `.fontFamily === 'Inter'` + scene description contains premium/editorial/luxury | Swap to Geist / Cabinet Grotesk / Söhne |
| Pure `#000` or `#FFFFFF` on dark/light scene bg | No depth — reads as wireframe | Fill hex exact `000000` or `FFFFFF` | `#111` / `#1a1a1a` on dark; `#fafafa` / `#f5f5f0` on light |
| Emoji used as interface icon (📊 in button) | AI-slop signature | Scan button/link/nav labels for emoji in pos 0 | Replace with SVG icon or glyph (▸ • ↑) |
| Gradient backdrop behind hero + gradient button + gradient accent pill | Gradient inflation | Count `linear-gradient(` instances; > 2 per section | Pick one gradient surface; flatten the rest |
| Two or more colors above `oklch(0.65 0.25)` (or equivalent saturation) | Accent noise | Walk SOLID fills; count by saturation bucket | Demote secondary accent to a muted variant |

When you find a new smell: **add a row**. The table is the memory across sessions.

## Canonical flows (intent-level, not click-level)

- **New scene from a clear brief** — check brand context → write HTML with taste rules baked in → `reframe_compile` → read audit → fix errors via `reframe_edit` where possible (don't regenerate) → re-inspect → if clean, scan for smells in the table above → fix → save
- **Edit on known scene** — identify node by role/name → `reframe_edit` with the one property that changes → re-inspect only that subtree
- **Audit cleanup** — `reframe_inspect` → for each rule, prefer `reframe_edit` over regeneration → re-inspect to zero
- **Visual doubt** — if you can't tell from audit whether a scene actually looks right, open it via `reframe_ui` and eyeball the rendered canvas. The only honest sanity check for taste.

## Anti-patterns

- **Regenerating when edit works.** Property tweak (color, radius, text, spacing) → single `reframe_edit` call, not recompile.
- **Writing HTML without a brand context** — if the scene will be judged for brand fidelity and you have no DESIGN.md, the output is guessing. Load brand first (→ `reframe-brand`) or decline brand fidelity critique.
- **Treating the 37-rule audit as "the design is good"** — clean audit + slop scene is the common failure. Run the smell table against every scene before saying done.
- **Classes / external stylesheets.** Inline styles only. The engine parses inline; classes get dropped on re-import.
- **Width in px on stretching containers.** Only the root gets an explicit width (1440 / 390 / etc.). Nested full-width strips use `width: 100%`.

## Tools to reach for

- `reframe_design` — load brand context. Call with `action: "extract", brand: "<slug>"` for catalog brands, `action: "list"` when unsure.
- `reframe_compile` — HTML → scene + audit. Prefer `file: ".reframe/src/<name>.html"` (source-persisted) over inline `html:`.
- `reframe_inspect` — audit + 8 aesthetic scores + brandFidelity. Call without `sceneId` for design-language reference.
- `reframe_edit` — all mutations. Structural (`update`/`add`/`delete`/`clone`/`resize`/`move`), theming (`defineTokens`/`setMode`), variation (`scaleSpacing`/`rotateColors`/`typographyPreset`), flow (`iterate`/`adapt`/`vary`).
- `reframe_export` — 8 formats when the user wants to ship.
- `reframe_ui` — eyeball the rendered scene in a real browser when audit doesn't tell the full story. Use `scene` action for tree+audit+selection in one call.

## Non-negotiable HTML rules

Rules the engine enforces structurally. Violations create audit failures you'll then have to fix — easier to write right:

- **Inline styles only**, no classes, no `<style>` tags
- **`width` on root** (1440px web, 390px mobile)
- **Explicit `background` + `color` on every container** — no inheritance
- **Buttons `height: 44px` minimum** (WCAG touch target, enforced)
- **`font-feature-settings`** applied when the brand specifies OpenType features
- **Full-width sections use `width: 100%`**, never fixed px on stretching containers

## When NOT to use this skill

- User names a brand and says "apply" / "rebrand" (no new design ask) → `reframe-brand`
- User asks for multiple pages / a site → `reframe-site-loop`
- User's request is ≤10 words with no specificity ("a landing page") → `reframe-enhance` first to structure, then come back here
- User wants to ship to React → `reframe-to-react`
- User asks "how does this look?" on an existing scene → `reframe-critic`
- User wants to test the Platform UI itself → `designer-qa`

## Growing the smell table

When you ship a scene and spot a new pattern that the audit missed but reads as slop:

1. Name the smell (one short phrase — "shadow inflation", "centered 5-up")
2. Write the detection probe (CSS selector + count, or a fill/font check)
3. Write the fix (one concrete action, not "make better")
4. Add the row

The smell table is the memory this skill carries across sessions. Every row saved is a future session that catches the pattern in 10 seconds instead of generating it.
