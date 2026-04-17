# Nav wiring — how to make pages link to each other correctly

Navigation is the **difference between a site and a pile of pages**. A broken nav link is embarrassing and makes the whole output unusable. This reference is the mechanical how-to.

## The contract

Every page in a reframe site has:
- **One nav element** identifiable via `semanticRole: 'nav'` in `reframe_inspect`
- **Link children** — anchor (`<a>`) or navigable nodes with `href` / `route` metadata
- **Href values shaped as `/<slug>`** (not `#`, not `onclick`, not absolute URLs)

`reframe_export format=site` reads the hrefs and stitches the bundle. Any non-`/slug` href → broken link in the exported site.

## How to find nav nodes

```ts
reframe_inspect({ sceneId: <current>, includeSemantic: true })
// returns:
//   semantic: [
//     { role: 'nav', nodeId: 'n1' },
//     { role: 'nav-item', nodeId: 'n1a' },
//     { role: 'nav-item', nodeId: 'n1b' },
//     ...
//   ]
```

Pick the `nav` role for the container, `nav-item` children for individual links. On scenes without explicit semantic roles, look for:
- Top-of-scene flex row with 4-6 text children
- Text nodes whose content matches known slug names ("Home", "Pricing", "About")

## How to set an href

```ts
reframe_edit({
  sceneId: <current>,
  op: "update",
  nodeId: <nav-item-id>,
  changes: { href: "/pricing" }
})
```

If the INode graph doesn't have a `href` field on the nav-item (it was rendered as plain text in the initial compile):

```ts
reframe_edit({
  sceneId: <current>,
  op: "update",
  nodeId: <nav-item-id>,
  changes: {
    type: "A",           // promote text node to anchor
    href: "/pricing"
  }
})
```

## How to update nav across ALL done pages

Each time a new page completes, older pages' navs don't know about it. Loop over `metadata.scenes` and update every done sceneId's nav to include the new slug.

```ts
const metadata = JSON.parse(Read(".reframe/metadata.json"));
const allSlugs = Object.keys(metadata.scenes);

for (const [slug, sceneId] of Object.entries(metadata.scenes)) {
  const inspected = reframe_inspect({ sceneId, includeSemantic: true });
  const navItems = inspected.semantic.filter(s => s.role === 'nav-item');

  // Check: does this scene's nav have a link for every slug?
  // For each missing slug, add a new nav-item
  // For each existing link, verify href matches /<slug>
  for (const slug of allSlugs) {
    if (!hasLinkToSlug(navItems, slug)) {
      // Add via reframe_edit op=add
      reframe_edit({
        sceneId,
        op: "add",
        parentId: findNavNode(inspected).nodeId,
        type: "A",
        props: { href: `/${slug}`, characters: slugToTitle(slug) }
      });
    }
  }
}
```

(Pseudocode — in practice the logic is compact per-turn in [advance-page](../workflows/advance-page.md).)

## Nav design rules (so it actually looks right)

- **Consistent across pages.** Same nav container, same item order, same styling. Users shouldn't notice the nav "changing shape" between pages.
- **Active state on current page.** The nav-item for the current page gets `fontWeight: 600` (or whatever the brand's DESIGN.md specifies). Use `reframe_edit` to set this per-page.
- **Order matches SITE.md page table.** Not alphabetical. The table is the source of truth for order.
- **Home first, always.** Even if the brand usually hides "Home" behind the wordmark, keep it addressable in the slug list.

## Common failures

### Phantom links

Nav points to `/contact` but `contact` isn't in `metadata.scenes`. Export-time: broken link, user clicks, 404.

Fix (during [advance-page](../workflows/advance-page.md) or [finalize-site](../workflows/finalize-site.md)):
- Remove the phantom nav-item, OR
- Add `contact` to SITE.md as pending and generate it

Either is fine — user decides. Don't leave the phantom.

### Nav element not found

`reframe_inspect includeSemantic=true` returned no `nav` role on a page. Three causes:
1. The page was generated without a nav (acceptable for a `404` fallback)
2. The semantic-role inference missed it (the compile didn't tag the top flex row as nav)
3. The page's HTML source had no `<nav>` — writer forgot

Decide:
- If intentional (404) → skip, fine
- If missed inference → manually locate the top flex row and treat as nav
- If forgotten in source → re-compile from source with a nav added

### Hrefs as `#`

Every `#` href is a loaded gun — export serializes them as literal fragments, clicking jumps to top, not to the page.

Grep for `href: "#"` during the final nav sweep in [finalize-site](../workflows/finalize-site.md) and replace with real slugs or remove the nav-item.

### Absolute external URLs leaked into nav

`href: "https://stripe.com"` in the nav breaks exports (relative-pathing assumption). Footer-level "external resources" CAN be absolute; nav CAN'T. Keep external links in a separate Resources section.

## Per-page active state pattern

After each page generation, during [advance-page](../workflows/advance-page.md) step 4:

```ts
// Current page's nav: set active state on its own slug
reframe_edit({
  sceneId: <current>,
  op: "update",
  nodeId: <nav-item-for-current-slug>,
  changes: { fontWeight: 600, color: <active-color-from-DESIGN.md> }
})

// All other nav-items stay at their default color/weight
```

Apply symmetrically on each done page so every page has its own active state.

## Keyboard / ARIA

If the brand's DESIGN.md specifies accessibility expectations, wire ARIA attributes via `reframe_edit` on nav nodes:

- `role="navigation"` on nav container
- `aria-current="page"` on the current page's nav-item
- `aria-label` per nav-item if label differs from href

Not every brand asks for this. Check DESIGN.md first — don't add if unasked.
