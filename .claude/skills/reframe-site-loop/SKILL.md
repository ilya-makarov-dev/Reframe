---
name: reframe-site-loop
description: Use when the user asks for multiple pages, a full site, a sitemap, or a group like "home + pricing + about + 404". Runs a baton pattern via `.reframe/next-prompt.md` + `.reframe/SITE.md` — pages generated one per turn with consistent design system, cross-nav wired. NOT for single-scene work.
allowed-tools:
  - "mcp__reframe__*"
  - "Read"
  - "Write"
  - "Edit"
---

# reframe site loop

You build **multi-page sites** in reframe by advancing a baton one page per turn. Each turn reads the current task from `.reframe/next-prompt.md`, generates one page using [reframe-design](../reframe-design/SKILL.md), wires nav to previously-built pages, updates `SITE.md`, then writes the next task back to the baton. Inspired by `stitch-loop` but wired to reframe's tools.

## Workflow routing

| Loop state | Workflow | What it does |
|---|---|---|
| Site doesn't exist yet (first turn) | [start-site](workflows/start-site.md) | Write `SITE.md`, generate first page, seed baton |
| Baton has a pending page (mid-loop) | [advance-page](workflows/advance-page.md) | Read baton, generate, wire nav, advance baton |
| Baton reports `status: complete` | [finalize-site](workflows/finalize-site.md) | Final nav pass, `reframe_export format=site`, summary |

## Why a baton pattern

**Context discipline.** Generating 5 pages in one turn blows past context quality — the 5th page doesn't look like the 1st. Baton pattern keeps each turn scoped to **one page + site context**, preserving quality across the full site.

**Review gates.** User can inspect between turns, say "redo the hero on pricing", change direction. Continuous chain = no review surface.

**Resumability.** Server restart, session timeout, user walks away — the baton is on disk. Next session reads `.reframe/next-prompt.md` and continues exactly where the previous stopped.

**CI/agent-chain capable.** Same baton can drive a GitHub Action or `claude-code` chain run to build a site overnight without human intervention.

## When

- "build me a site for X"
- "make a landing + pricing + about page"
- "generate 4 pages: home, features, pricing, signup"
- Resuming a partial site (baton exists, status not complete)

Not this workflow:
- Single scene → [reframe-design](../reframe-design/SKILL.md) text-to-design
- Design variants of one scene (density × radius grid) → `reframe_edit op=vary`

## The baton files

See [references/baton-format.md](references/baton-format.md) for full schemas. Quick version:

- **`.reframe/SITE.md`** — master plan: sitemap, brand, tone, done/pending table
- **`.reframe/next-prompt.md`** — current page's structured prompt + metadata (page slug, brand)
- **`.reframe/metadata.json`** — cache: slug → sessionId mapping

Templates you can copy to initialize a site: [templates/SITE.md.template](templates/SITE.md.template), [templates/next-prompt.md.template](templates/next-prompt.md.template).

## Core rules

1. **Brand is frozen on turn 1.** All subsequent pages use the same DESIGN.md. Drift across pages = broken site.
2. **One page per turn.** Never attempt 2+ pages in one chain — context degrades, nav wires break.
3. **Nav links are real slugs.** `<a href="/pricing">` — not `#`, not `onclick`. `reframe_export format=site` depends on this.
4. **SITE.md is source of truth.** `metadata.json` is a cache. On conflict, trust SITE.md.
5. **Don't regenerate done pages.** If user says "tweak the hero on home" mid-loop, that's a [reframe-design](../reframe-design/SKILL.md) edit on the `home` scene, NOT a re-entry to this loop.

## Orchestration modes

The baton supports three modes without any code changes:

- **Manual** — user reviews between pages, types "next" to advance
- **Agent-chain** — Claude Code auto-advances turn after turn until `status: complete`
- **CI** — a GitHub Action reads baton, calls `claude -p`, commits, loops

Don't assume a mode. If the user hasn't said, **ask once**: "build all pages now, or one-at-a-time with review?"

## Handoffs

Every turn ends with a handoff to one of:
- [reframe-design](../reframe-design/SKILL.md) text-to-design — to actually generate the current page
- [reframe-brand](../reframe-brand/SKILL.md) — on turn 1, before first generation, to load DESIGN.md
- [reframe-enhance](../reframe-enhance/SKILL.md) — BEFORE writing next-prompt.md, to rewrite raw intents into structured prompts

The baton file **always carries a structured prompt**, never raw user words. Run [reframe-enhance](../reframe-enhance/SKILL.md) before writing to next-prompt.md.

## Failure modes

- **Brand missing** → stop, invoke [reframe-brand](../reframe-brand/SKILL.md) apply-existing first.
- **Nav won't wire because sessionIds unknown** → refuse to advance. Update `metadata.json` from current scene list, retry.
- **User interrupts with off-plan change** → options are: (a) absorb the change into next baton, (b) branch into [reframe-design](../reframe-design/SKILL.md) for a one-off edit, (c) discard the interruption. Pick via one-line check with user.

## Related

- [reframe-design](../reframe-design/SKILL.md) — generates each page (receives baton)
- [reframe-brand](../reframe-brand/SKILL.md) — loads DESIGN.md, frozen for the whole site
- [reframe-enhance](../reframe-enhance/SKILL.md) — always-on before writing next-prompt.md
- [reframe-critic](../reframe-critic/SKILL.md) — optional per-page review (run at end of each turn before advancing)
