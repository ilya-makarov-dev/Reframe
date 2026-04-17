# reframe-site-loop skill

Builds multi-page sites in reframe using a baton-passing pattern. One page per turn, consistent brand across all pages, deterministic cross-nav wiring, resumable across sessions.

## What it does

- **Initializes** `.reframe/SITE.md` (master plan) and `.reframe/next-prompt.md` (current page task) on turn 1
- **Advances** one page per turn — reads baton, generates via [reframe-design](../reframe-design/), wires nav, writes next baton
- **Freezes brand** after turn 1 so pages don't drift across the site
- **Finalizes** with `reframe_export format=site` to emit a navigable multi-page bundle
- **Resumable** — server restart, session timeout, walk-away all safe; baton is on disk

## Why baton-pattern

Generating 5 pages in one turn → page 5 looks nothing like page 1 (context quality degrades). Baton pattern = fresh scope per page while preserving site-level context via `SITE.md`.

Works for:
- **Manual** — user types "next" between pages to advance
- **Agent chain** — auto-run until `status: complete`
- **CI** — GitHub Action reads baton, calls `claude -p`, loops

## Example prompt

```
Build a site for a SaaS devtool, Linear brand — home, pricing, docs, 404.
```

1. Turn 1 — [start-site](workflows/start-site.md) — writes SITE.md with 4 pages, loads Linear brand, generates `home`, wires baton to `pricing`
2. Turn 2 — [advance-page](workflows/advance-page.md) — reads baton, generates `pricing`, wires nav (home + pricing), baton → `docs`
3. Turn 3 — same for `docs`
4. Turn 4 — same for `404`, `status: complete`
5. Turn 5 — [finalize-site](workflows/finalize-site.md) — final nav pass, `reframe_export format=site`

## Skill structure

```
reframe-site-loop/
├── SKILL.md                    — agent entry (routing + rules)
├── README.md                   — this file
├── workflows/
│   ├── start-site.md           — first turn: SITE.md + first page + baton
│   ├── advance-page.md         — each subsequent turn
│   └── finalize-site.md        — last turn: nav pass + site export
├── references/
│   ├── baton-format.md         — SITE.md + next-prompt.md + metadata.json schemas
│   └── nav-wiring.md           — how to wire cross-page nav correctly
└── templates/
    ├── SITE.md.template
    └── next-prompt.md.template
```

## Works with

- [`reframe-design`](../reframe-design/) — generates each page
- [`reframe-brand`](../reframe-brand/) — loads DESIGN.md (frozen for whole site)
- [`reframe-enhance`](../reframe-enhance/) — always run before writing next-prompt.md (structured > raw)
- [`reframe-critic`](../reframe-critic/) — optional per-page review before advancing baton

## Resuming an interrupted build

If `.reframe/next-prompt.md` exists and `page != null`:

```
Continue the site build.
```

Skill reads baton, picks up at [advance-page](workflows/advance-page.md). No context needed from prior session.
