# Workflow: finalize site (last turn)

Last turn of a multi-page build. Runs a final nav pass, exports the site bundle, reports the summary.

## When

- Baton `.reframe/next-prompt.md` has `page: null, status: complete`
- User says "finalize" / "export the site" / "we're done"

## Steps

### 1. Verify all pages are done

Read SITE.md. Confirm every page row shows `status: done`. If any pending remain → route to [advance-page](advance-page.md) instead.

```ts
Read(".reframe/SITE.md")
// Check the page table — all "done"?
```

If SITE.md claims done but a scene is missing → rebuild `metadata.json` from the session scene list, flag the discrepancy.

### 2. Final nav sweep

During [advance-page](advance-page.md) each page got nav updates as later pages were added. But the **last-added** page only had nav pointing to pages before it. And if user reordered / added mid-flight, earlier pages might not know about the final set.

Pass through every done page once more and confirm nav is consistent:

```ts
// For each sceneId in metadata.scenes:
//   reframe_inspect({ sceneId, includeSemantic: true })
//   find nav nodes
//   check every nav link points to an existing /slug in metadata
//   update via reframe_edit if stale
```

If any nav link points to a slug **not** in `metadata.scenes` → it's a phantom reference. Two options: delete the link, or add the missing page. Report to user, don't auto-decide.

### 3. Global audit pass

Per-page audit was run during generation. But multi-page consistency has its own signal — `brandFidelity` across all pages should cluster. If one page is 0.65 and the rest are 0.92, it's an outlier worth flagging.

```ts
// Collect brandFidelity across all sceneIds, report spread
```

Surface to user if outliers exist: "pricing page has brandFidelity 0.68 vs average 0.89 — wants a look?".

### 4. Site bundle export

```ts
reframe_export({
  sceneId: "<any>",  // tool accepts any scene in the project for site export
  format: "site"
})
// → { path: ".reframe/exports/site-<timestamp>/", bytes, files: [...] }
```

The `site` export produces:
- `index.html` → the `home` page (or the first page in SITE.md if no home)
- `<slug>.html` for every other done page
- Shared assets (images, fonts if embedded)
- Cross-nav links work as relative paths

### 5. Summary report

```
Site "acme-landing" built.
  · 4 pages: home, pricing, about, 404
  · brand: linear
  · brandFidelity average: 0.91
  · audit: all clean
  · exported: .reframe/exports/site-2026-04-17T10-23-15/

Want me to:
  · open the exported folder
  · run reframe-critic for a final taste pass across all pages
  · deploy (if you have a hosting adapter wired)
  · generate a 404 and 500 fallback (if not already in SITE.md)
```

### 6. Close the loop

Move baton to final state (or delete):

```yaml
---
page: null
status: archived
exportedAt: 2026-04-17T10:23:15Z
exportPath: .reframe/exports/site-2026-04-17T10-23-15/
---

Site build complete. See SITE.md for summary.
```

Some teams prefer deleting the baton once the site ships — fine, do that if user prefers. Archive is safer default (provenance preserved).

## Rules

1. **No new pages in finalize.** If user asks "and can you add a /blog?" — reopen loop via [advance-page](advance-page.md), update SITE.md, then come back to finalize.
2. **Broken nav links are not acceptable.** If any nav link is phantom, fix before exporting. A shipped site with 404'ing own-site links is embarrassing.
3. **`format: site` is for multi-page**, don't use `format: html` per-page as a substitute — you'd lose the nav pathing and shared-asset bundling.

## Failure modes

- **Export path exists** — add timestamp suffix automatically (the export tool does this by default with `site-<ts>` pattern).
- **CanvasKit WASM unavailable** — blocks `png` / `pdf` but `site` export is pure HTML, should still work. Surface any raster-related warnings.
- **Brand was refreshed mid-build** (stale tokens on some scenes) — flag in summary, offer to rebuild from source in a follow-up turn.

## Related

- [start-site](start-site.md) — if user wants to start another site
- [advance-page](advance-page.md) — if pages are added post-finalize
- [../../reframe-critic/SKILL.md](../../reframe-critic/SKILL.md) — final taste pass across pages
