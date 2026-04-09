/**
 * MCP server instructions — sent to EVERY client on connection.
 *
 * This is the universal context for any MCP client (Claude Code, Cursor,
 * Windsurf, managed agents). Equivalent to CLAUDE.md but delivered via
 * the MCP protocol's `instructions` field.
 *
 * Keep this concise — it's injected into every session's system prompt.
 * Detailed reference is available via reframe_inspect() (progressive disclosure).
 */

export function getReframeInstructions(): string {
  return `reframe is a programmable design engine. YOU are the designer — you write HTML+CSS, reframe validates and exports.

PIPELINE (always this order):
1. reframe_design → establish brand (DESIGN.md: colors, typography, spacing, components). Use action "list" to browse 60+ brands, action "extract" + brand slug to load one (e.g. "stripe", "airbnb").
2. reframe_compile → YOU write full HTML with inline styles using DESIGN.md values, pass to compile
3. reframe_inspect → review audit → reframe_edit to fix → re-inspect until clean
4. reframe_export → deliver (html/react/svg/animated_html/lottie/site)

CRITICAL: Step 2 — YOU generate the HTML. The engine does NOT generate designs.
Read the full DESIGN.md from step 1 — it gives you exact colors, fonts, font features (OpenType), button variants, component specs, spacing scale, shadows. Use those values.
Be creative with layout and structure. No template to follow. Every design should be unique.

HTML rules: inline styles only, width on root (1440px), explicit colors on every container, full-width sections (no fixed px on stretching containers), min 44px button height. Apply font-feature-settings if the brand specifies OpenType features.

SOURCE HTML: compile auto-saves your HTML to .reframe/src/<name>.html. For small fixes use reframe_edit (INode props). For big changes, edit the source file and re-compile: reframe_compile({ file: ".reframe/src/home.html", name: "home" }).

Call reframe_inspect() without sceneId for design language reference, INode properties, and spacing guide.`;
}
