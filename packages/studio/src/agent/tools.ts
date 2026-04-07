/**
 * Agent Tool Definitions — maps Claude API tool_use to studio actions.
 *
 * Each tool maps to a reframe core function called through the store.
 */

export const TEMPLATE_NAMES = [
  'Tech Banner', 'Social Card', 'Story', 'Card', 'Ad Banner', 'Dashboard',
];

export const AGENT_TOOLS = [
  {
    name: 'create_design',
    description: 'Create a design by generating HTML/CSS. The HTML will be imported into the INode tree and rendered on canvas. Always include explicit width and height on the root element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: { type: 'string', description: 'Complete self-contained HTML with inline styles. Root element must have explicit width/height in pixels. Use absolute positioning or flexbox.' },
        description: { type: 'string', description: 'Brief description of what was created' },
      },
      required: ['html', 'description'],
    },
  },
  {
    name: 'modify_design',
    description: 'Modify the current design by generating updated HTML/CSS that replaces the entire scene.',
    input_schema: {
      type: 'object' as const,
      properties: {
        html: { type: 'string', description: 'Updated complete HTML with all changes applied' },
        description: { type: 'string', description: 'What was changed' },
      },
      required: ['html', 'description'],
    },
  },
  {
    name: 'animate_design',
    description: 'Add animations to nodes in the current design using presets. Available presets: fadeIn, fadeOut, slideInLeft, slideInRight, slideInUp, slideInDown, scaleIn, scaleOut, popIn, revealLeft, revealUp, pulse, shake, bounce, typewriter, colorShift, blurIn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        animations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              nodeName: { type: 'string', description: 'Target node name' },
              preset: { type: 'string', description: 'Animation preset name' },
              delay: { type: 'number', description: 'Delay in ms (default: 0)' },
              duration: { type: 'number', description: 'Duration in ms (default: preset default)' },
            },
            required: ['nodeName', 'preset'],
          },
          description: 'Array of preset animations to apply to nodes',
        },
        loop: { type: 'boolean', description: 'Loop the timeline (default: false)' },
        description: { type: 'string', description: 'Description of animation intent' },
      },
      required: ['animations', 'description'],
    },
  },
  {
    name: 'update_node',
    description: 'Update properties of a specific node by name. Use this for targeted changes like resizing, repositioning, changing colors, editing text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        nodeName: { type: 'string', description: 'Name of the node to update' },
        changes: {
          type: 'object',
          description: 'Properties to change: x, y, width, height, opacity, cornerRadius, text, fontSize, fontWeight, fontFamily, visible, rotation',
        },
        description: { type: 'string', description: 'What was changed' },
      },
      required: ['nodeName', 'changes', 'description'],
    },
  },
  {
    name: 'load_design_system',
    description: 'Load a DESIGN.md to enable brand compliance auditing. Provide the markdown content of the design system definition.',
    input_schema: {
      type: 'object' as const,
      properties: {
        markdown: { type: 'string', description: 'DESIGN.md content with typography, colors, spacing, components sections' },
      },
      required: ['markdown'],
    },
  },
  {
    name: 'run_audit',
    description: 'Run design audit (17 rules) on the current scene. Returns issues with severity and auto-fix suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'export_design',
    description: 'Export the current design to a specific format.',
    input_schema: {
      type: 'object' as const,
      properties: {
        format: { type: 'string', enum: ['html', 'svg', 'react', 'animated_html', 'lottie'], description: 'Export format' },
      },
      required: ['format'],
    },
  },
  {
    name: 'use_template',
    description: `Load a starter template. Available: ${TEMPLATE_NAMES.join(', ')}. Templates provide professional starting points that you can then modify.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        templateName: { type: 'string', description: 'Template name to load' },
      },
      required: ['templateName'],
    },
  },
  {
    name: 'new_artboard',
    description: 'Create a new artboard with specified dimensions. Use for multi-format campaigns (e.g. desktop + mobile + story versions).',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Artboard name (e.g. "Mobile", "Desktop")' },
        width: { type: 'number', description: 'Width in pixels' },
        height: { type: 'number', description: 'Height in pixels' },
      },
      required: ['name', 'width', 'height'],
    },
  },
];

export const SYSTEM_PROMPT = `You are the design agent in reframe studio — an AI-native design environment.

You create and modify visual designs by generating HTML/CSS, which gets imported into an INode tree (design AST) and rendered on a live canvas.

## Your capabilities:
1. **create_design** — Generate complete HTML/CSS designs
2. **modify_design** — Replace the entire design with updated HTML
3. **update_node** — Change specific node properties (position, size, color, text)
4. **animate_design** — Add animations using 17 built-in presets
5. **load_design_system** — Load DESIGN.md for brand compliance
6. **run_audit** — Validate against 17 design rules
7. **export_design** — Export to HTML, SVG, React, animated HTML, or Lottie
8. **use_template** — Load a starter template as a starting point
9. **new_artboard** — Create a new artboard for multi-format campaigns

## Multi-artboard workflow:
For campaigns that need multiple formats (desktop + mobile + story), create separate artboards.
Each artboard has its own independent scene. Design each size separately — don't scale, redesign.

## HTML rules:
- Root element: explicit width and height in pixels (e.g. width: 1920px; height: 1080px)
- Layout: absolute positioning (position: absolute; left/top) or flexbox
- Styles: all inline or in <style> block — must be self-contained
- Quality: specific colors, real fonts, proper sizes — professional grade
- Every visible element should have a meaningful data-name attribute for targeting

## Design principles:
- Create polished, production-ready designs
- Use proper visual hierarchy and spacing
- Ensure text contrast meets WCAG 4.5:1
- Add meaningful data-name attributes to all elements
- When animating, use appropriate presets with staggered delays for polish`;
