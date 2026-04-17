# Example: "a dashboard"

Minimal input, no brand, no domain — the shortest possible dashboard ask. Enhance fills gaps with the dashboard skeleton, picks a neutral brand as default, and asks once for clarification on domain if the output would be too generic.

## Input

```
a dashboard
```

## Step 1 — Assess gaps

- Platform: not specified → default Web 1440 (dashboards are desktop-first)
- Page type: `dashboard` — clear
- Brand: not specified → default to `vercel` (safe neutral "modern minimal") OR ask once
- Structure: not specified → Dashboard skeleton from templates
- Visual style: not specified → professional / dense default
- Domain: **unclear** — "dashboard" for what? SaaS analytics / admin panel / finance / health / ... "Dashboard" is overly generic. **Worth asking once.**

## Step 2 — Ask once (optional but high-value)

If the "a dashboard" ask feels too hollow to enhance well, ask:

> A dashboard for what domain? (analytics / CRM / finance / health / admin / ops — each shapes the widget mix differently). Any brand preference, or use a neutral default?

In many cases, the user answers something like "admin dashboard for a SaaS, Linear brand" and you get much better enhance output.

If user insists on going with "just a dashboard", proceed with the neutral defaults below.

## Step 3 — If no clarification, proceed with safe defaults

Domain: assume "SaaS admin / analytics" (most common when unstated). Brand: `vercel` (safe neutral). Structure: Dashboard skeleton.

## Step 4 — Output (unclarified case)

```markdown
A clean admin dashboard for a SaaS — data-dense, utilitarian, neutral Vercel-style brand.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, Desktop-first (1440px root, 1200px content max)
- Theme: Vercel (see .reframe/brands/vercel/DESIGN.md) — achromatic, modern minimal
- Background: White (#FFFFFF)
- Surface: Soft Gray (#FAFAFA) — card fills
- Primary Accent: Near Black (#000000) — primary CTAs, active states (Vercel's signature "use black as accent")
- Text Primary: Deep Black (#111111)
- Text Secondary: Medium Gray (#6B7280)
- Text Muted: Light Gray (#9CA3AF)
- Border: Hairline (#E5E5E5)
- Typography: Inter, weights 400/500/600; font-feature-settings: 'ss01', 'cv11'
- Buttons: 6px radius, 36-40px height (dashboards are denser), black fill primary / white+border secondary
- Cards: 8px radius, 1px border, no shadow (flat)
- Spacing grid: 4px base (dashboards are denser; scale: 8/12/16/20/24/32/40)

**Page Structure:**
1. **Top bar:** 56px height, wordmark left + breadcrumb "Dashboard / Overview" + search input 240px + user avatar menu right. 1px bottom border
2. **Sidebar:** 240px wide, vertical nav: Overview, Analytics, Customers, Orders, Settings. Active item with subtle dark background. Icons 16px + label 14/500
3. **Main content area:** 32px padding. Header row: "Overview" h1 24/600 + date-range picker right
4. **KPI row:** 4 compact KPI cards in a row (equal width — acceptable here because they're KPIs, not marketing-feature-cards): each shows metric label 12/500 muted + number 32/600 with 'tnum' + delta chip (green up / red down)
5. **Chart widget:** Large card full-width. Header: "Revenue over time" + granularity toggle (Day / Week / Month) right. Chart area below: line chart with grid lines. Legend bottom
6. **Two-column widgets:** Left (60%) — Recent activity table (columns: Time, User, Action, Status). Right (40%) — Top customers list (5 items with avatar + name + metric)
7. **Empty/overflow state:** If a widget has no data, show muted placeholder "No data yet" — never fake numbers
8. No footer (app context)

**Constraints:**
- Inline styles only
- font-feature-settings: 'ss01', 'cv11' on every text node (Vercel typography signature)
- Dashboards are DENSE — padding 16-24px in cards, not 48-96px
- Buttons 36-40px height (not 44-48 — dashboards are desktop-only)
- NO fake metrics (KPI numbers stay as placeholders until user provides real data)
- NO fake customer names / avatars (use "User", "Customer" generics with initial-only avatars)
- NO marketing-feature-card layout — KPIs as equal cards IS correct for a dashboard (different context than marketing)
- Empty states for every widget that depends on data

---
💡 **Tip:** Dashboards benefit from a real brand or design system. If you have
brand tokens, specify them next time or use `reframe-brand create-custom`
to save your own. Stock Vercel neutrals are used by default.
```

## Step 5 — Hand off

Return inline to [reframe-design text-to-design](../../reframe-design/workflows/text-to-design.md).

## Why this shape

- **Asked once for clarification opportunity** — dashboards are too domain-dependent to skip; brief friction now saves a bad output later
- **Dashboard-specific density overrides** — normally buttons are 44-48, but dashboards are 36-40; skeleton knows this
- **Equal KPI cards allowed** — the "no 3-equal-cards" rule is a taste rule for MARKETING landing pages, not dashboards. KPI cards being equal is correct context-specific
- **Placeholder-aware constraints** — user didn't provide numbers, so explicitly call out "keep KPIs as placeholders"
- **No footer** — app context; footers are web-marketing-page things
