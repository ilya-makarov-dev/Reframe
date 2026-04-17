# Baton format — file schemas

The baton pattern lives in three files. This reference defines their exact shapes.

## `.reframe/SITE.md`

Master plan. Single source of truth for what's in the site.

```markdown
# Site: <site-name>

## Meta
- **brand:** stripe
- **tone:** premium, dense, trustworthy
- **target:** web 1440 (mobile-first copy, responsive later)
- **created:** 2026-04-17

## Notes
(optional — any cross-cutting decisions: motion policy, copy voice,
banned patterns that apply to every page)

## Pages

| slug     | title         | purpose                            | status      | sceneId  |
|----------|---------------|------------------------------------|-------------|----------|
| home     | Home          | hero + value + social proof + CTA  | done        | s12      |
| pricing  | Pricing       | 3-tier + FAQ                       | done        | s13      |
| about    | About us      | team + mission                     | in-progress | s14      |
| 404      | Not found     | soft fail with home-link CTA       | pending     |          |

## Export
(filled by finalize-site workflow when site is built)
- Exported: `.reframe/exports/site-<ts>/`
- Bundle: HTML + nav links wired as `/slug`
```

Rules:
- **status** values: `pending` | `in-progress` | `done`
- **sceneId** column is the session id from reframe store; filled as pages complete
- **Never manually edit the page table** — update via Edit tool from the workflow. Humans can read it; agents write it.

## `.reframe/next-prompt.md`

The baton. One page's task.

```markdown
---
page: about
brand: stripe
status: pending
---

A premium "about us" page for the Stripe-branded site. Focuses on trust
and mission — this company moves money, users must feel safety.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first (1440px root)
- Theme: Stripe (see .reframe/brands/stripe/DESIGN.md)
- Background: Deep Ink (#0A2540)
- Accent: Signal (#635BFF) — CTAs, active states
- Text: F6F9FC / ADBDCC / 425466 (primary / secondary / muted)
- Typography: Stripe Sans, OpenType 'ss01', 'tnum' on every text node
- Buttons: 48px height, 24px radius (pill-ish)

**Page Structure:**
1. **Nav** — sticky, matches home's nav exactly
2. **Hero** — headline "Trusted infrastructure for modern commerce" + subhead + primary CTA "Get in touch"
3. **Mission block** — 2-paragraph narrative, left-aligned, max-width 640px
4. **Team section** — asymmetric split: 3-column grid of 6 team cards, each with photo placeholder, name, role. NO fake names — generic "Engineer", "Product Designer" etc.
5. **Values** — 3 value pillars as editorial text (NOT 3 equal cards — use zigzag or intro-with-subvalues)
6. **Footer** — same as home

**Constraints:**
- Inline styles only
- OpenType features on every text node
- No fake testimonials, no made-up metrics, no stock-photo placeholder humans
- Nav links must match: /home, /pricing, /about, /404
```

Rules:
- Frontmatter is **mandatory** — `page` + `brand` + `status`
- Prompt body is **structured** (not raw user words) — run through [reframe-enhance](../../reframe-enhance/SKILL.md) before writing
- When `page: null` + `status: complete` → signal to run [finalize-site](../workflows/finalize-site.md)
- When `status: archived` → site is shipped, don't re-enter the loop without user explicitly resetting

## `.reframe/metadata.json`

Cache of slug → sessionId mappings. Derived from SITE.md + scene store. Authoritative for nav wiring.

```json
{
  "scenes": {
    "home": "s12",
    "pricing": "s13",
    "about": "s14"
  },
  "startedAt": "2026-04-17T09:15:00Z",
  "lastTurnAt": "2026-04-17T10:22:13Z"
}
```

Rules:
- `scenes` keys are page slugs (matches SITE.md slug column)
- Values are session ids from reframe store
- **Not authoritative** — if it disagrees with SITE.md, trust SITE.md and rebuild metadata from the session scene list
- Read every turn to wire nav; update every turn after generation

## Interactions

```
start-site                    advance-page                   finalize-site
     │                              │                              │
     ├─ Write SITE.md               ├─ Read SITE.md                ├─ Read SITE.md
     ├─ Write next-prompt.md        ├─ Read next-prompt.md         ├─ verify all done
     ├─ Write metadata.json         ├─ Read metadata.json          ├─ export site
     │                              │                              │
     ├─ generate first page         ├─ generate page              ├─ final nav sweep
     │                              ├─ wire nav on all done        │
     ├─ Edit SITE.md (home: done)   ├─ Edit SITE.md                ├─ Edit SITE.md (exported)
     ├─ Edit metadata.json          ├─ Edit metadata.json          │
     │                              │                              │
     └─ Write next-prompt.md (next) └─ Write next-prompt.md (next) └─ Write next-prompt.md (archived)
                                     OR (last done) (null, complete)
```

## Migration from stitch-loop

If copying patterns from Google Stitch's `stitch-loop`, the main differences are:

- File paths: `.reframe/` instead of `.stitch/`
- Tool invocations: reframe MCP (compile / inspect / edit / export) instead of Stitch MCP (generate_screen_from_text / edit_screens)
- Brand handling: [reframe-brand](../../reframe-brand/SKILL.md) is a first-class skill; Stitch folds it into design-md
- Export: `reframe_export format=site` instead of per-screen download
