# Brand catalog — top 30

Reframe ships 60+ pre-extracted brands via the `getdesign` npm catalog. This reference covers the **most-used 30** with one-line profiles so you can match a user's fuzzy reference to the right slug without calling `reframe_design action=list` every time.

Use this first. For anything not listed, fall back to:

```ts
reframe_design({ action: "list" })
```

## Tech / SaaS

| Slug | Profile | Typical use |
|---|---|---|
| `stripe` | Premium payments infra; deep ink navy + one purple accent, Stripe Sans, OpenType heavy (`ss01`, `tnum`). Subtle shadows. | Dev-focused SaaS landings, pricing, dashboards |
| `linear` | Minimal project management; soft paper white, near-black text, single indigo accent, Inter with cv11. Sharp-to-editorial radius. | Lean dev tools, issue trackers, roadmap UIs |
| `vercel` | Modern neutral; achromatic (black/white/gray), Inter, sharp radius, near-zero ornamentation. | Neutral "modern minimal" default |
| `github` | Dense, utilitarian; white + slate, orange-pink accents (`#FF6B6B`), monospace for code blocks. | Dev platforms, repo-heavy UIs |
| `notion` | Warm document; off-white bg, Inter + serif display, generous whitespace, gentle radius. | Content-heavy productivity tools |
| `figma` | Playful creative; bright primary (`#F24E1E`), Whyte font family, friendly rounded. | Design tools, collaborative workspaces |
| `openai` | Clean research-lab; near-white, bold sans, green accent sparingly. | AI product landings, technical docs |
| `anthropic` | Editorial serious; warm cream bg (`#F2ECDA`), orange accent (`#E94B1A`), Source Serif for reading, mono for code. | Long-form content, thought leadership |
| `supabase` | Emerald green / dark mode; greens on deep bg, Inter. | Open-source infra, devtools |
| `cloudflare` | Orange-first corporate; `#F38020` everywhere, Poppins-ish. | Infrastructure, network-heavy products |

## Consumer / Lifestyle

| Slug | Profile | Typical use |
|---|---|---|
| `airbnb` | Warm rounded humanist; cream + coral (`#FF5A5F`), Cereal font, generous radius, friendly shadows. | Marketplaces, travel, hospitality |
| `uber` | Bold minimal; pure black + white + single green accent, condensed display for hero numbers. | Transport, logistics, mobility |
| `spotify` | Vibrant dark; `#1DB954` green on near-black, Circular font. | Music, audio content |
| `instagram` | Soft gradient accents; subtle purples/oranges, SF Pro. | Social media, creator tools |
| `discord` | Friendly dark; blurple `#5865F2`, Whitney font, rounded generous. | Community, chat, gaming adjacent |
| `robinhood` | Financial clean; pure black bg, financial-green, Inter. | Fintech, trading |

## Hardware / Premium

| Slug | Profile | Typical use |
|---|---|---|
| `apple` | Restrained premium; pure white / near-black, SF Pro, minimal radius, soft shadows only on product shots. | Consumer hardware, premium product pages |
| `tesla` | Performance minimal; black / white only, Gotham, aggressive white space, no accent at all. | Automotive, performance products |
| `ferrari` | Racing luxury; red (`#FF2800`) as the entire brand, condensed display, serif for prestige. | Automotive, luxury goods |
| `rolex` | Timeless premium; deep greens / gold, serif display, heavy spacing, quiet layout. | Watches, luxury accessories |
| `nike` | Bold sport; pure black + white + single accent per campaign, condensed display. | Athletic wear, performance gear |

## Creative / Editorial

| Slug | Profile | Typical use |
|---|---|---|
| `medium` | Reading-first; paper white, Charter serif for body, Söhne for UI, minimal chrome. | Blogs, long-form editorial |
| `substack` | Writer-centric cream; warm off-white, serif display, orange accents sparingly. | Newsletters, independent publishing |
| `newyorker` | Classic editorial; deep bg, Adobe Caslon-like serif, layered columns. | Magazine-style, long-form |
| `awwwards` | Dark maximalist; motion-heavy, mixed fonts, aggressive layouts. | Portfolio, creative showcase |

## Finance / Enterprise

| Slug | Profile | Typical use |
|---|---|---|
| `chase` | Trust blue (`#117ACA`), Helvetica Neue, dense information layouts. | Banking, insurance, enterprise |
| `mastercard` | Orange-red-yellow gradient heritage, Neue Plak, structured grids. | Payments, financial services |

## Gaming / Entertainment

| Slug | Profile | Typical use |
|---|---|---|
| `playstation` | Iconic blue (`#003087`), SST font family, sharp tech geometry. | Gaming platforms, entertainment |
| `epic` | Dark gamer chic; near-black + bright accent per game, Brutal Type. | Games storefronts, dev tools |

## Neutral fallbacks

If user's ask doesn't cleanly map to any catalog brand:

- **"modern minimal generic"** → `vercel` (no opinion, safe)
- **"warm, approachable"** → `notion`
- **"technical / dev-heavy"** → `linear` or `stripe`
- **"premium / serious"** → `apple` or `anthropic`
- **"dark mode SaaS"** → `supabase` or `linear`

## Guidance for fuzzy references

| User says | Usually means | Slug |
|---|---|---|
| "make it feel like GitHub" | dense utilitarian white + orange/pink | `github` |
| "Stripe-like" | premium payments / dev-focused | `stripe` |
| "Notion-ish" | warm reading-first productivity | `notion` |
| "Linear vibes" | lean minimal dev tools | `linear` |
| "Apple-clean" | restrained premium | `apple` |
| "playful / fun" | Figma / Discord / Spotify | `figma` most often |
| "serious enterprise" | financial / banking | `chase` |
| "creator tool" | Instagram / Notion / Medium hybrid | `notion` |

## Missing from this list

Calling `reframe_design action=list` returns the full current catalog. The 60+ brands also include: `coinbase`, `snapchat`, `twitter`/`x`, `meta`, `google`, `microsoft`, `adobe`, `atlassian`, `slack`, `dropbox`, `asana`, `monday`, `shopify`, `square`, `tinder`, `bumble`, `doordash`, `lyft`, `canva`, `miro`, `framer`, `webflow`, `zoom`, `twitch`, `pinterest`, `bmw`, `rolls-royce`, `porsche` — and more shipping regularly via `getdesign` updates.

## Not in catalog?

- [../workflows/apply-existing.md](../workflows/apply-existing.md) fallback: offer closest catalog match OR route to [../workflows/create-custom.md](../workflows/create-custom.md)
