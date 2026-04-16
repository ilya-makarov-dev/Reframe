/**
 * Platform — shared CSS entry point.
 *
 * This is a thin shim. The actual Platform UI stylesheet lives in
 * ./platform-ui.css (a plain CSS file, not a .ts template literal).
 * We read it once at module load and export the string verbatim for
 * the router to serve at /platform/style.css.
 *
 * See ./scripts.ts for the reasoning — same class of template-literal
 * escape bugs, same fix.
 *
 * Visual language principles (preserved from the old file's header):
 * two surface levels (canvas + elevated), one accent color, 13-16px
 * text, no card drop-shadows, borders do the work shadows do elsewhere.
 * The sparseness is the brand — before adding an 11px size, a fourth
 * surface, or a colored card border, stop.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// See ./scripts.ts — same CJS __dirname pattern.
export const PLATFORM_CSS = readFileSync(join(__dirname, 'platform-ui.css'), 'utf-8');
