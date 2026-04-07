# reframe studio

## Color Palette

**Primary** (#6366f1): Intelligence indigo — the color of the engine. Used on active states, selections, CTA buttons, and accent text. Not scattered — earned through interaction.
**Background** (#09090b): Warm void — not pure black. The canvas for creation, darkness as the native medium.
**Text** (#fafafa): Near-white with imperceptible warmth. Never pure white — prevents eye strain during long sessions.
**Accent** (#818cf8): Lighter indigo for hover states, links, and secondary emphasis.
**CTA** (#6366f1): Primary call-to-action buttons. Solid indigo on dark.
**Error** (#ef4444): Audit errors, destructive actions. Warm red, not clinical.
**Success** (#22c55e): Audit pass, successful operations. Confident green.
**Warning** (#eab308): Audit warnings, caution states. Amber visibility.
**Surface** (#18181b): Elevated panels, cards. One luminance step above background.
**Muted** (#52525b): De-emphasized text, timestamps, metadata.
**Secondary** (#a1a1aa): Body copy, descriptions, secondary labels.
**Border** (#27272a): Panel separators, input outlines. Visible but quiet.
**Selection** (#6366f1): Node selection on canvas, highlighted items.
**Hover** (#27272a): Interactive hover states on dark surfaces.

## Typography

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Hero | 48px | 600 | 1.00 | -1.44px |
| Title | 24px | 600 | 1.20 | -0.72px |
| Subtitle | 18px | 500 | 1.30 | -0.36px |
| Body | 13px | 400 | 1.50 | 0px |
| Caption | 11px | 500 | 1.40 | 0.2px |
| Disclaimer | 10px | 400 | 1.40 | 0px |
| Button | 12px | 500 | 1.00 | 0.2px |

Font families:
- **Sans**: Inter Variable with OpenType features `cv01`, `ss03` — geometric alternates for precision
- **Mono**: JetBrains Mono, Berkeley Mono, SF Mono, Consolas — for code, values, data

## Components

### Buttons
- **Primary**: Background #6366f1, text #ffffff, border-radius 6px, font-weight 500, text-transform none
- **Secondary**: Background transparent, border 1px solid #27272a, text #a1a1aa, border-radius 6px
- **Ghost**: Background transparent, text #a1a1aa, border-radius 6px
- **Danger**: Background transparent, border 1px solid #27272a, text #ef4444, border-radius 6px
- Button style: rounded (not pill, not square)
- Hover: background shifts one luminance step, 150ms ease-out transition
- Active: scale(0.98) transform for tactile feedback

### Inputs
- Background: #111113
- Border: 1px solid #1f1f23
- Focus border: #6366f1
- Text: #fafafa
- Placeholder: #52525b
- Border-radius: 4px
- Padding: 4px 8px

### Panels
- Background: #111113
- Border: 1px solid #1f1f23
- Header: uppercase, letter-spacing 0.5px, font-weight 500, font-size 11px, color #52525b

## Layout

- Spacing unit: 8px
- Max width: 1920px
- Section spacing: 8px
- Border radius scale: 0, 2, 4, 6, 8, 12, 9999

Panel proportions:
- Left panel: 260px (layers + audit)
- Right panel: 260px (properties + design system + assets)
- Bottom panel: 320px (animation + chat)
- Toolbar: 40px
- Artboard tabs: 32px

## Responsive

| Breakpoint | Width |
|-----------|-------|
| Compact | <1280px |
| Standard | 1280-1920px |
| Wide | >1920px |

## Depth

| Level | Treatment |
|-------|-----------|
| Base | No shadow — surface color alone defines level |
| Raised | rgba(0, 0, 0, 0.2) 0px 2px 4px 0px, rgba(0, 0, 0, 0.1) 0px 0px 0px 1px |
| Floating | rgba(0, 0, 0, 0.3) 0px 8px 24px 0px, rgba(0, 0, 0, 0.15) 0px 0px 0px 1px |
| Overlay | rgba(0, 0, 0, 0.5) 0px 16px 48px 0px, rgba(0, 0, 0, 0.2) 0px 0px 0px 1px |

Depth philosophy: Luminance stacking. Surfaces get brighter as they elevate.
- Level 0: #09090b (void)
- Level 1: #111113 (panels)
- Level 2: #18181b (cards, inputs)
- Level 3: #27272a (hover, active)
- Level 4: #3f3f46 (elevated interactive)

No drop shadows on chrome. Ring borders (1px solid rgba) for structure.
Shadows reserved for overlays, modals, and floating elements only.
