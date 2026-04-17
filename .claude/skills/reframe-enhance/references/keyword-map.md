# Keyword map — vague → concrete

Dictionary of vague UI terms → specific components with layout / size / position. Use this to rewrite user phrases before handing to [reframe-design](../../reframe-design/SKILL.md).

## Navigation

| User says | Enhanced |
|---|---|
| "menu at the top" | "Sticky navigation bar, 64px height, wordmark left + 4-5 menu items center + primary CTA right" |
| "hamburger menu" | "Mobile nav: hamburger icon top-right, expands to full-screen overlay with 5-6 items stacked" |
| "sidebar menu" | "Persistent left sidebar 240px, vertical nav with section labels, collapsed icon-only at 64px on small screens" |
| "breadcrumbs" | "Breadcrumb row below nav, slug chain with `>` separators, terminal slug bold" |
| "tabs" | "Tab strip with underline indicator on active, 4-6 tabs max, 13-14px label weight 500" |

## Hero

| User says | Enhanced |
|---|---|
| "hero section" | "Full-width hero, 1440×auto (min 560px), content on 8/12-col grid" |
| "big header image" | "Hero section with full-bleed background image + dark overlay gradient for text contrast" |
| "headline with CTA" | "Headline 72/76 weight 600, subhead 20/28 weight 400 max-width 640, primary CTA 48×pill" |
| "split hero" | "Asymmetric 7/5 split: text content left 58%, visual anchor right 42% (product shot / animated mockup / live data)" |
| "video hero" | "Hero with muted autoplay video background, text overlay left-aligned, controls hidden" |

## Buttons / CTAs

| User says | Enhanced |
|---|---|
| "button" | "Primary CTA button, 44-48px height, brand accent fill, 15/500 letter-spacing -0.01em, radius per brand" |
| "rounded button" | "Pill-shaped button (border-radius 999px), 44px height, 20-24px horizontal padding" |
| "sharp button" | "4-8px radius, 44px height, 14-16px horizontal padding" |
| "big CTA" | "Primary button at 56-64px height, 15-16/600 label, prominent placement at end of section" |
| "secondary button" | "Transparent fill, 1px border at text color 18% alpha, same height as primary, text color = text-primary" |
| "text link" | "Inline link, color = accent OR text-primary bold 500, underline on hover only" |

## Cards / tiles / grids

| User says | Enhanced |
|---|---|
| "cards" | (context-dependent) "3-column asymmetric grid OR bento OR zigzag — NEVER 3-equal-horizontal" |
| "product cards" | "Each card: image top 180×240, title 18/24 weight 600, description 14/20 weight 400, price 16/600, CTA below" |
| "feature grid" | "3-col grid with first card doubled-width as 'lead feature' — NOT 3 equal" |
| "bento grid" | "Mixed-size tiles filling rectangle: 1 large (2×2), 2 medium (1×2 each), 2 small (1×1 each)" |
| "testimonial cards" | "Only if user provided real quotes. Layout: photo-less quote cards in 2-col, italic body, name + role below" |

## Forms

| User says | Enhanced |
|---|---|
| "login form" | "Centered form card, 400×auto, Sign-in heading, email + password inputs (label on top), 'Forgot password?' right-aligned helper, full-width primary submit" |
| "contact form" | "Name / email / message inputs stacked, message textarea 120px min-height, submit button right-aligned below" |
| "search bar" | "Full-width input with leading icon, placeholder, subtle rounded (8-12px)" |
| "input field" | "Label 13/500 above, input 40-44px height, 1px border, 8px radius, focus ring 2px accent" |
| "checkbox list" | "Vertical stack with leading custom checkbox + 14/500 label, 32-40px row height" |

## Content blocks

| User says | Enhanced |
|---|---|
| "text section" | "Centered content column, max-width 680px, body 16-18/1.5, subtle paragraph spacing 1.25em" |
| "FAQ" | "Accordion list, question 16/500 bold, answer 14/1.5 on expand, 16-24px vertical rhythm between items" |
| "pricing" | "3 tiers: asymmetric (lead tier center, elevated, accent border); each shows tier name, price, 4-5 features, CTA" |
| "timeline" | "Horizontal timeline with milestone markers, labels alternating above/below for density" |
| "stats" | "Only if user provided real numbers. Layout: 4-col grid, each stat 56-72px number + 14/500 label below" |

## Images / media

| User says | Enhanced |
|---|---|
| "image" | "`<img src='./local.png'>` with alt text, specific width/height to lock layout" |
| "icon" | "SVG from Lucide / Heroicons / Phosphor, 20-24px, currentColor stroke" |
| "illustration" | "SVG or PNG at declared size; if brand has illustration system, pull from DESIGN.md references" |
| "logo" | "Wordmark or SVG — don't invent; use brand's known mark or write a text wordmark in brand font" |

## Footer

| User says | Enhanced |
|---|---|
| "footer" | "3-4 column footer: links (Products / Resources / Legal), social icons row, wordmark + copyright, 80-120px vertical padding" |
| "simple footer" | "One line: wordmark left, legal links right, 48-64px vertical padding, subtle top border" |
| "footer with newsletter" | "2 rows: top = newsletter form (email + submit) centered, bottom = standard link columns" |

## Anti-patterns (explicit replacements)

User says these → rewrite them out:

| User says | Replace with |
|---|---|
| "three cards with icons" | "3-col asymmetric with one lead feature + two stacked — no icon-top-of-text" |
| "section with stats" | IF user provided numbers → fine; ELSE → replace with neutral qualitative labels |
| "testimonials section" | IF user provided quotes → fine; ELSE → "trusted by teams" neutral anchor, no fake testimonials |
| "call to action at the bottom" | "Final CTA block — headline + supporting line + primary CTA, full-width dark surface for contrast" |
| "something modern" | See [mood-map.md](mood-map.md) for the "modern" rewrite |

## Usage in the pipeline

This reference is read during [enhance-prompt step 3A](../workflows/enhance-prompt.md). Agent consults it mentally (not literally on every call) — the patterns become internalized quickly.

For terms not in this table, write your own concrete description based on:
- What the user seems to want visually
- What the brand DESIGN.md suggests
- Invariants from [reframe-design HTML rules](../../reframe-design/references/html-rules.md)

## Related

- [mood-map.md](mood-map.md) — for adjective rewrites
- [structure-templates.md](structure-templates.md) — for full-page skeletons when structure is missing
- [output-format.md](output-format.md) — exact output shape
