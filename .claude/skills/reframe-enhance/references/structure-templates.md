# Structure templates — page type → default skeleton

Skeletons for common page types. Use as a starting point when user didn't name sections. Customize per brand's tone (Stripe's landing ≠ Airbnb's).

## Landing page (marketing)

```
1. Nav — sticky, wordmark + 4-5 links + primary CTA right
2. Hero — asymmetric split (text left 58%, visual 42%); headline 72/76, subhead 20/28, primary CTA
3. Trust anchor — neutral label "Trusted by engineering teams" + 4-6 dim logos OR skip if no real logos
4. Value block #1 — lead feature, narrative style (left: ~50% text, right: ~50% visual OR inline mockup)
5. Value block #2 — secondary feature, reverse layout (image left, text right)
6. Social proof — case study quote if real, neutral metric block otherwise, skip if neither
7. Pricing teaser — "Plans" anchor with link to /pricing OR inline 3-tier card if single-page
8. Final CTA block — headline + supporting line + primary CTA on dark/contrast surface
9. Footer — 3-4 col (Products / Resources / Legal / Social)
```

**Tone variations:**
- Premium (Stripe-ish): quiet palette, dense info, subtle shadows, generous vertical padding (120px+)
- Warm (Airbnb-ish): cream/coral, rounded 12-16px, generous spacing, lifestyle imagery
- Lean (Linear-ish): near-white, one accent, compact padding (64-96px), text does the work

## Pricing page

```
1. Nav — same as site
2. Hero — short: headline + 1-line subtext, no CTA (users scroll)
3. Plan toggle — Monthly / Annual segmented control (right-aligned or centered)
4. Tier grid — 3 tiers asymmetric: middle tier elevated + accent border + "Recommended" badge, others flanking
5. Feature comparison — expandable table, first 4-5 features visible, rest behind "See all features"
6. FAQ — accordion, 5-8 real questions
7. Final CTA — "Need something custom?" with contact link
8. Footer
```

## Dashboard (app UI)

```
1. Top bar — wordmark + breadcrumb + search + user menu (right)
2. Sidebar — nav vertical, icon + label, grouped by section, active state visible
3. Main content — grid of widgets (asymmetric: large chart + 3 small KPI cards + table row)
4. Empty state — IF data not provided: "No activity yet" with subtle illustration placeholder
5. No footer (app context)
```

Dashboards are data-dense. Skip hero-ish fluff. Focus on structure + filter UX.

## Form pages (login / signup / onboarding)

### Login
```
1. Centered card, 400×auto
2. Wordmark top (48px from top of card)
3. Heading "Sign in"
4. Email input (label above)
5. Password input (label above) + "Forgot?" inline helper
6. Primary submit full-width
7. OR divider + 1-2 SSO buttons (Google / GitHub) — only if real
8. Bottom link "Don't have an account? Sign up"
```

### Signup
```
1-2. (same as login)
3. Heading "Create account"
4. Name input
5. Email input
6. Password input + helper (requirements)
7. Checkbox "Accept Terms of Service"
8. Primary submit full-width
9. Bottom link "Already have an account? Sign in"
```

### Multi-step onboarding
```
1. Progress bar at top (1 of 4)
2. Current step content (heading + description + inputs)
3. Navigation: Back / Next buttons bottom
4. Skip option (if applicable) top-right
```

## 404 / 500 / error pages

```
1. Nav (matching site)
2. Centered content:
   - Large number "404" or "500" in display size (72-120px)
   - Heading: "Page not found" / "Something broke"
   - 1-line apologetic subtext
   - Primary CTA "Return home" → /
   - Secondary link "Contact support" if relevant
3. Footer (matching site, slimmed if user wants)
```

Keep it short. Nobody dwells on an error page.

## About / team page

```
1. Nav
2. Hero — 1-line mission statement, no CTA
3. Mission block — 2-3 paragraph narrative, left-aligned, max-width 680px
4. Team section — grid of cards:
   - If user provided team → use real names/roles
   - If not → generic roles ("Engineer", "Product Designer") no fake names
5. Values — EITHER 3-pillar editorial style (NOT 3 cards) OR single long statement
6. Join us — if hiring, link to /careers
7. Footer
```

## Blog / content listing

```
1. Nav
2. Heading + dateline filter
3. Post list:
   - Featured post at top (large card, full-width)
   - Followed by 2-col grid OR dense list with date + title + excerpt
4. Pagination OR "Load more" button
5. Footer
```

## Blog post detail

```
1. Nav
2. Post header:
   - Category label (top)
   - Title (display size, 48-72px)
   - Date + author byline
   - Featured image (full-width) OR skip
3. Body: max-width 680px column, 18/1.6 body, generous whitespace
4. Call-out / quote / image blocks as needed
5. Author card at bottom
6. "Related posts" 3-card strip
7. Footer
```

## E-commerce (small / focused)

### Catalog
```
1. Nav with cart indicator
2. Filter bar (top OR left sidebar)
3. Product grid — 3-4 col, each card: image 1:1, title, price, CTA
4. Pagination
5. Footer
```

### Product detail
```
1. Nav
2. Split layout: images gallery left 50%, product info right 50%
3. Right side: title, price, variant selectors, quantity, "Add to cart"
4. Below fold: description, specs table, reviews
5. "Related products" strip
6. Footer
```

## Changelog / release notes

```
1. Nav
2. Page heading: "Changelog" or "What's new"
3. Entries (newest top):
   - Date
   - Version / release title
   - Bullet list of changes (feature / fix / improvement)
4. No footer needed OR minimal
```

## Usage

- When user's ask is "a [page type]" → pull that skeleton
- Adapt to brand tone via [mood-map.md](mood-map.md)
- Don't use all sections blindly — remove if irrelevant (e.g. skip testimonials if user didn't provide real ones)
- User can override any default by mentioning sections in their ask

## Related

- [keyword-map.md](keyword-map.md) — for component-level rewrites within sections
- [mood-map.md](mood-map.md) — for tone customization
- [output-format.md](output-format.md) — the final shape the prompt takes
