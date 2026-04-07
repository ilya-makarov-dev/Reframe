/**
 * Design System Presets — curated brand design systems from top companies.
 *
 * Each preset is a compact DESIGN.md that our parseDesignMd() can parse.
 * Extracted from awesome-design-md collection.
 * Colors, typography, layout — the tokens that drive audit + agent.
 */

export interface DesignPreset {
  name: string;
  category: 'dark-tech' | 'warm-editorial' | 'bold-vibrant' | 'dev-tool' | 'corporate';
  description: string;
  markdown: string;
}

export const DESIGN_PRESETS: DesignPreset[] = [
  // ─── Dark Tech ────────────────────────────────────────────

  {
    name: 'Linear',
    category: 'dark-tech',
    description: 'Precision engineering — indigo accent, luminance stacking, Inter 510',
    markdown: `# Linear

## Color Palette

**Primary** (#5e6ad2): Brand indigo — CTAs, active states, brand marks
**Background** (#08090a): Near-black canvas, darkness as native medium
**Text** (#f7f8f8): Near-white with warm cast
**Accent** (#7170ff): Interactive violet — links, selected items
**Secondary** (#d0d6e0): Cool silver-gray for body text
**Muted** (#8a8f98): Tertiary — metadata, placeholders
**Border** (#23252a): Subtle structure, moonlight wireframes
**Success** (#10b981): Emerald — completion states
**Error** (#ef4444): Status red

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 72px | 510 | 1.00 | -1.584px |
| Title | 48px | 510 | 1.00 | -1.056px |
| Subtitle | 32px | 400 | 1.13 | -0.704px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 13px | 510 | 1.40 | 0px |
| Button | 14px | 510 | 1.00 | 0px |

Font: Inter Variable with OpenType cv01, ss03
Mono: Berkeley Mono

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 2, 6, 8, 12, 9999`,
  },

  {
    name: 'Vercel',
    category: 'dark-tech',
    description: 'Shadow-as-border, Geist font, monochromatic restraint',
    markdown: `# Vercel

## Color Palette

**Primary** (#171717): Vercel Black — headings, primary text
**Background** (#ffffff): Pure white canvas
**Text** (#171717): Near-black, not pure
**Accent** (#0072f5): Link blue — interactive elements
**Secondary** (#666666): Tertiary text, muted
**Muted** (#808080): Placeholder, disabled
**Border** (#ebebeb): Gray-100 dividers
**Success** (#0070f3): Console blue
**Error** (#ff5b4f): Ship red
**Warning** (#de1d8d): Preview pink

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 48px | 600 | 1.00 | -2.4px |
| Title | 32px | 600 | 1.25 | -1.28px |
| Subtitle | 24px | 500 | 1.33 | -0.96px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 14px | 500 | 1.50 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: Geist Sans with OpenType liga
Mono: Geist Mono

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 2, 4, 6, 8, 12, 64, 9999`,
  },

  {
    name: 'Raycast',
    category: 'dark-tech',
    description: 'Blue-shifted black, macOS depth, positive letter-spacing',
    markdown: `# Raycast

## Color Palette

**Primary** (#FF6363): Raycast Red — punctuation accent, sparingly used
**Background** (#07080a): Blue-shifted near-black
**Text** (#f9f9f9): Near-white primary
**Accent** (#55b3ff): Raycast Blue — interactive states
**Secondary** (#cecece): Light gray body
**Muted** (#9c9c9d): Medium gray metadata
**Border** (#1a1a1a): Subtle dark separation
**Success** (#5fc992): Green confirmation
**Warning** (#ffbc33): Amber alerts
**Error** (#FF6363): Red alerts

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 64px | 600 | 1.05 | -1.28px |
| Title | 40px | 600 | 1.10 | -0.8px |
| Subtitle | 24px | 500 | 1.30 | 0px |
| Body | 16px | 500 | 1.50 | 0.2px |
| Caption | 13px | 500 | 1.40 | 0.4px |
| Button | 14px | 600 | 1.00 | 0.2px |

Font: Inter with OpenType calt, kern, liga, ss03
Mono: GeistMono

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 2, 8, 16, 32, 86`,
  },

  {
    name: 'Framer',
    category: 'dark-tech',
    description: 'Cinematic void, extreme compression, electric blue accent',
    markdown: `# Framer

## Color Palette

**Primary** (#0099ff): Framer Blue — links, borders, glow
**Background** (#000000): Pure black void
**Text** (#ffffff): Pure white on void
**Accent** (#0099ff): Electric blue for interaction
**Secondary** (#a6a6a6): Muted silver body text
**Muted** (#666666): De-emphasized content
**Border** (#333333): Dark structure lines

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 110px | 500 | 0.95 | -5.5px |
| Title | 62px | 500 | 1.00 | -3.1px |
| Subtitle | 32px | 400 | 1.20 | -0.64px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 13px | 400 | 1.40 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: GT Walsheim Medium
Body: Inter Variable with OpenType cv01, cv05, cv09, cv11, ss03, ss07

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 1, 5, 8, 12, 20, 100`,
  },

  {
    name: 'Supabase',
    category: 'dark-tech',
    description: 'Dark-native, brand green accent, no shadows — border depth only',
    markdown: `# Supabase

## Color Palette

**Primary** (#3ecf8e): Supabase Green — sparse brand accent
**Background** (#171717): Dark canvas
**Text** (#fafafa): Near-white primary
**Accent** (#00c573): Link green
**Secondary** (#b4b4b4): Body copy gray
**Muted** (#898989): Metadata gray
**Border** (#2e2e2e): Standard separation
**Success** (#3ecf8e): Green confirmation
**Error** (#f87171): Warm red

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 72px | 400 | 1.00 | -1.44px |
| Title | 40px | 400 | 1.10 | -0.8px |
| Subtitle | 24px | 400 | 1.30 | -0.48px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 14px | 500 | 1.40 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: Circular
Mono: Source Code Pro

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 6, 8, 9999`,
  },

  // ─── Warm & Editorial ─────────────────────────────────────

  {
    name: 'Claude',
    category: 'warm-editorial',
    description: 'Parchment warmth, serif headlines, terracotta accent',
    markdown: `# Claude

## Color Palette

**Primary** (#c96442): Terracotta — warm CTA accent
**Background** (#f5f4ed): Parchment cream
**Text** (#4d4c48): Warm charcoal
**Accent** (#c96442): Terracotta interactive
**Secondary** (#87867f): Warm gray body
**Muted** (#5e5d59): De-emphasized warm gray
**Border** (#d5d4cd): Warm light border

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 56px | 500 | 1.10 | -1.12px |
| Title | 36px | 500 | 1.20 | -0.72px |
| Subtitle | 24px | 400 | 1.30 | -0.24px |
| Body | 16px | 400 | 1.60 | 0px |
| Caption | 13px | 400 | 1.40 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: Anthropic Serif (headlines), system sans-serif (body)
Mono: monospace

## Layout

- Spacing unit: 8px
- Max width: 1000px
- Border radius scale: 4, 8, 12, 9999`,
  },

  {
    name: 'Notion',
    category: 'warm-editorial',
    description: 'Warm neutrals, single blue accent, whisper borders',
    markdown: `# Notion

## Color Palette

**Primary** (#0075de): Notion Blue — sole saturated accent
**Background** (#ffffff): Pure white canvas
**Text** (#191919): Near-black with warmth
**Accent** (#0075de): Blue CTAs and links
**Secondary** (#615d59): Warm secondary text
**Muted** (#a39e98): Warm muted metadata
**Border** (#e6e3de): Warm light border
**Success** (#1aae39): Green
**Error** (#dd5b00): Orange-red

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 64px | 700 | 1.00 | -2.125px |
| Title | 40px | 700 | 1.10 | -1.2px |
| Subtitle | 24px | 600 | 1.25 | -0.48px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 12px | 600 | 1.40 | 0.125px |
| Button | 14px | 500 | 1.00 | 0px |

Font: NotionInter (modified Inter)

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 4, 8, 12, 16, 9999`,
  },

  {
    name: 'Cursor',
    category: 'warm-editorial',
    description: 'Warm minimalism, three-voice typography, oklab borders',
    markdown: `# Cursor

## Color Palette

**Primary** (#f54e00): Cursor Orange — primary CTA
**Background** (#f2f1ed): Warm off-white
**Text** (#26251e): Warm near-black
**Accent** (#f54e00): Orange interactive
**Secondary** (#76736d): Warm mid-gray
**Muted** (#a39f97): Light warm gray
**Border** (#d8d5ce): Warm border
**Error** (#cf2d56): Warm crimson
**Success** (#1f8a65): Muted teal

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 72px | 400 | 1.00 | -2.16px |
| Title | 40px | 400 | 1.10 | -1.2px |
| Subtitle | 24px | 400 | 1.20 | -0.48px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 11px | 400 | 1.40 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: CursorGothic (display), jjannon serif (editorial), berkeleyMono (code)

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 4, 8, 10, 9999`,
  },

  {
    name: 'Superhuman',
    category: 'warm-editorial',
    description: 'Mysteria purple, lavender glow, binary radius system',
    markdown: `# Superhuman

## Color Palette

**Primary** (#714cb6): Amethyst — link and interactive color
**Background** (#ffffff): Pure white canvas
**Text** (#292827): Charcoal ink
**Accent** (#cbb7fb): Lavender glow — sole accent
**Secondary** (#76736c): Warm gray body
**Muted** (#a39f97): De-emphasized
**Border** (#dcd7d3): Parchment border
**CTA** (#e9e5dd): Warm cream buttons

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 64px | 540 | 0.96 | -1.32px |
| Title | 40px | 540 | 1.05 | -0.8px |
| Subtitle | 24px | 460 | 1.20 | -0.24px |
| Body | 16px | 460 | 1.50 | 0px |
| Caption | 12px | 460 | 1.40 | 0px |
| Button | 14px | 500 | 1.00 | 0px |

Font: Super Sans VF (custom variable, non-standard weights: 460, 540, 600, 700)

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 8, 16`,
  },

  // ─── Bold & Vibrant ───────────────────────────────────────

  {
    name: 'Stripe',
    category: 'bold-vibrant',
    description: 'Purple + navy, blue-tinted shadows, light weight 300 headlines',
    markdown: `# Stripe

## Color Palette

**Primary** (#533afd): Stripe Purple
**Background** (#ffffff): White canvas
**Text** (#061b31): Deep navy — not black, financial sophistication
**Accent** (#533afd): Purple interactive
**Secondary** (#64748d): Body gray
**Muted** (#8e99a8): Placeholder
**Border** (#e5edf5): Cool light border
**CTA** (#533afd): Purple CTAs
**Error** (#ea2261): Ruby red
**Success** (#15be53): Confident green

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 56px | 300 | 1.05 | -1.4px |
| Title | 48px | 300 | 1.10 | -0.96px |
| Subtitle | 26px | 300 | 1.25 | -0.26px |
| Body | 16px | 400 | 1.40 | 0px |
| Caption | 14px | 400 | 1.40 | 0px |
| Button | 14px | 400 | 1.00 | 0px |

Font: sohne-var with OpenType ss01
Mono: SourceCodePro

## Layout

- Spacing unit: 8px
- Max width: 1080px
- Border radius scale: 4, 5, 6, 8`,
  },

  {
    name: 'Figma',
    category: 'bold-vibrant',
    description: 'Binary B&W, custom variable font, colorless gallery wall',
    markdown: `# Figma

## Color Palette

**Primary** (#000000): Pure black
**Background** (#ffffff): Pure white
**Text** (#000000): Black on white
**Accent** (#000000): Black interactive (colorless chrome)
**Secondary** (#6e6e6e): Gray body
**Muted** (#999999): Placeholder
**Border** (#e6e6e6): Light gray structure

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 86px | 400 | 1.00 | -1.72px |
| Title | 64px | 400 | 1.05 | -1.28px |
| Subtitle | 32px | 340 | 1.15 | -0.32px |
| Body | 18px | 320 | 1.50 | -0.1px |
| Caption | 14px | 450 | 1.40 | -0.14px |
| Button | 14px | 480 | 1.00 | 0px |

Font: figmaSans (custom variable, precision weights: 320, 330, 340, 450, 480, 540, 700)
Mono: figmaMono

## Layout

- Spacing unit: 8px
- Max width: 1920px
- Border radius scale: 6, 8, 50`,
  },

  {
    name: 'Spotify',
    category: 'bold-vibrant',
    description: 'Immersive dark, green accent, pill geometry, dense content',
    markdown: `# Spotify

## Color Palette

**Primary** (#1ed760): Spotify Green — brand accent
**Background** (#121212): Near-black immersive
**Text** (#ffffff): White primary
**Accent** (#1ed760): Green interactive
**Secondary** (#b3b3b3): Silver body text
**Muted** (#727272): Gray metadata
**Border** (#282828): Dark separation
**Error** (#f3727f): Warm red
**Warning** (#ffa42b): Orange alerts

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 48px | 700 | 1.05 | -0.96px |
| Title | 32px | 700 | 1.10 | -0.64px |
| Subtitle | 24px | 700 | 1.20 | -0.24px |
| Body | 16px | 400 | 1.50 | 0px |
| Caption | 12px | 600 | 1.40 | 1.4px |
| Button | 14px | 700 | 1.00 | 2px |

Font: SpotifyMixUI / CircularSp
Button text-transform: uppercase

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 4, 8, 500, 9999`,
  },

  {
    name: 'Apple',
    category: 'corporate',
    description: 'SF Pro, single blue accent, translucent navigation, extreme whitespace',
    markdown: `# Apple

## Color Palette

**Primary** (#0071e3): Apple Blue — sole interactive color
**Background** (#ffffff): White / #f5f5f7 light gray sections
**Text** (#1d1d1f): Near-black text
**Accent** (#0071e3): Blue links and CTAs
**Secondary** (#6e6e73): Gray body
**Muted** (#86868b): Placeholder
**Border** (#d2d2d7): Light gray border

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 56px | 600 | 1.07 | -0.28px |
| Title | 40px | 600 | 1.10 | -0.4px |
| Subtitle | 28px | 600 | 1.14 | 0.07px |
| Body | 17px | 400 | 1.47 | -0.374px |
| Caption | 12px | 400 | 1.33 | 0px |
| Button | 17px | 400 | 1.00 | -0.374px |

Font: SF Pro Display (20px+), SF Pro Text (<20px)

## Layout

- Spacing unit: 8px
- Max width: 980px
- Border radius scale: 5, 8, 12, 980`,
  },

  {
    name: 'Resend',
    category: 'dev-tool',
    description: 'Cinematic void, serif display, frost borders, extreme compression',
    markdown: `# Resend

## Color Palette

**Primary** (#ffffff): White on void
**Background** (#000000): Pure black
**Text** (#f0f0f0): Near-white
**Accent** (#ffffff): White interactive
**Secondary** (#a0a0a0): Silver body
**Muted** (#666666): Dark gray metadata
**Border** (#222222): Barely-visible structure

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 96px | 400 | 1.00 | -0.96px |
| Title | 56px | 400 | 1.00 | -2.8px |
| Subtitle | 32px | 400 | 1.20 | -0.64px |
| Body | 16px | 400 | 1.50 | 0.35px |
| Caption | 13px | 400 | 1.40 | 0px |
| Button | 14px | 400 | 1.00 | 0.35px |

Font: Domaine Display (serif), ABC Favorit (geometric sans)
Mono: ABC Favorit Mono

## Layout

- Spacing unit: 8px
- Max width: 1200px
- Border radius scale: 4, 8, 9999`,
  },
];

/** Get presets by category */
export function getPresetsByCategory(category: DesignPreset['category']): DesignPreset[] {
  return DESIGN_PRESETS.filter(p => p.category === category);
}

/** All unique categories */
export const PRESET_CATEGORIES: { id: DesignPreset['category']; label: string }[] = [
  { id: 'dark-tech', label: 'Dark Tech' },
  { id: 'warm-editorial', label: 'Warm & Editorial' },
  { id: 'bold-vibrant', label: 'Bold & Vibrant' },
  { id: 'dev-tool', label: 'Dev Tools' },
  { id: 'corporate', label: 'Corporate' },
];
