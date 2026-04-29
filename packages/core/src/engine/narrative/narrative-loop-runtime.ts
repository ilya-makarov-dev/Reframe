/**
 * Runtime + CSS generator for narrative loop sprite animations (T3 #30).
 *
 * Designer attaches `data-reframe-narrative="sprite"` to an element with
 * companion config attrs (sprite URL + frame data + optional rate /
 * loop mode / trigger). Exporter emits per-element scoped CSS rules
 * (a `@keyframes` block walking the sprite strip via background-position
 * + a class rule binding it) plus a single runtime IIFE that wires the
 * three trigger modes (viewport / mount / hover).
 *
 * ─── Why `steps(N)` timing instead of linear ────────────────
 *
 * The animation walks a sprite strip frame-by-frame. Linear interp
 * would scrub HALFWAY between frames at every interval, producing a
 * 50/50 visual blend mid-frame instead of crisp frames. `steps(N)`
 * snaps cleanly between positions — sprite-sheet idiom.
 *
 * ─── Why per-element keyframes (not shared) ─────────────────
 *
 * Each sprite has unique `frameCount * frameWidth` total stride, so
 * `to { background-position: -<N>px 0 }` can't be shared. We could
 * factor a CSS variable for stride length, but the @keyframes `to`
 * value is itself a length and CSS vars in keyframe property values
 * aren't reliably supported across browsers (interp resolution edge
 * cases on Safari). Per-element rules are safe + cheap (~8 lines per
 * narrative node, deduped trivially via the unique key per id).
 *
 * ─── Why CSS animation, not RAF ─────────────────────────────
 *
 * GPU-composited, no main-thread frame budget. RAF would let us pause
 * exactly on intersection-out (animation-play-state toggle pre-pauses
 * but we'd still be repainting), but for Phase 0 the simplicity wins.
 * Off-screen animations DO continue to consume composition cycles —
 * documented limitation; bring `animation-play-state: paused` toggle
 * back if CPU complaints surface (future signal).
 *
 * ─── Multi-mount safety ─────────────────────────────────────
 *
 * Each iframe in variants / sampler / flow gets its own document, own
 * runtime IIFE, own IntersectionObserver. Class names include the node
 * id (`reframe-narrative-<id>`) — collisions across iframes are
 * impossible because each iframe's `<style>` block is document-scoped,
 * but the unique-per-id naming is defense-in-depth for the rare case
 * where multiple scenes share a parent document (debug / preview wall).
 */

export const NARRATIVE_LOOP_RUNTIME_SOURCE = `
(function() {
  if (window.__reframeNarrative) return;
  window.__reframeNarrative = true;

  function activate(el) {
    el.classList.add('reframe-narrative-active');
  }
  function deactivate(el) {
    el.classList.remove('reframe-narrative-active');
  }

  function attach(el) {
    var trigger = el.getAttribute('data-reframe-narrative-trigger') || 'viewport';
    var loopMode = el.getAttribute('data-reframe-narrative-loop-mode') || 'forward';

    if (trigger === 'mount') {
      activate(el);
      return;
    }
    if (trigger === 'hover') {
      el.addEventListener('mouseenter', function() { activate(el); });
      el.addEventListener('mouseleave', function() { deactivate(el); });
      return;
    }
    // viewport (default) — IntersectionObserver
    var fired = false;
    var io = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          activate(el);
          // 'once' loops fire one playback then leave the active class
          // off observation. Other modes keep observing — re-entering
          // viewport replays from the keyframe origin.
          if (loopMode === 'once') {
            if (fired) continue;
            fired = true;
            io.unobserve(el);
          }
        } else if (loopMode !== 'once') {
          // Removing the class pauses the animation (CSS animation
          // resets to 'from' on next class re-apply, giving the same
          // entry-into-viewport playback feel as Probe A documents).
          deactivate(el);
        }
      }
    }, { threshold: 0.2 });
    io.observe(el);
  }

  function init() {
    var nodes = document.querySelectorAll('[data-reframe-narrative]');
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

/** Allowed `data-reframe-narrative` discriminator values. Phase 0 ships single-element. */
export const KNOWN_NARRATIVE_KINDS: ReadonlyArray<'sprite'> = ['sprite'];

export function isKnownNarrativeKind(s: string): s is 'sprite' {
  return KNOWN_NARRATIVE_KINDS.indexOf(s as any) !== -1;
}

/** Allowed loop modes — keep in lockstep with the NarrativeLoopMode union. */
export const KNOWN_LOOP_MODES: ReadonlyArray<'forward' | 'reverse' | 'pingpong' | 'once'> = [
  'forward',
  'reverse',
  'pingpong',
  'once',
];

export function isKnownLoopMode(s: string): s is 'forward' | 'reverse' | 'pingpong' | 'once' {
  return KNOWN_LOOP_MODES.indexOf(s as any) !== -1;
}

export const KNOWN_TRIGGERS: ReadonlyArray<'viewport' | 'mount' | 'hover'> = [
  'viewport',
  'mount',
  'hover',
];

export function isKnownTrigger(s: string): s is 'viewport' | 'mount' | 'hover' {
  return KNOWN_TRIGGERS.indexOf(s as any) !== -1;
}

/**
 * Per-narrative-element CSS — a @keyframes block walking the sprite
 * strip + a class rule binding the animation to the element. Returns
 * the concatenated CSS string for ALL narrative nodes in a scene.
 *
 * Naming: animation name + class both keyed on the node id; multiple
 * narrative nodes in one scene each get their own pair.
 *
 * Loop mode encoding:
 *   forward  → default direction, infinite count
 *   reverse  → animation-direction: reverse, infinite count
 *   pingpong → animation-direction: alternate, infinite count
 *   once     → iteration-count: 1, fill-mode: forwards (lock on last frame)
 *
 * Sprite sheets larger than ~2MB significantly inflate exported
 * bundles when inlined as data: URIs. Designer-facing concern, not
 * a hard cap — we just emit; the bundle inliner handles the URL.
 */
export interface NarrativeRule {
  nodeId: string;
  spriteUrl: string;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  frameRate?: number;
  loopMode?: 'forward' | 'reverse' | 'pingpong' | 'once';
}

export function buildNarrativeCss(rules: ReadonlyArray<NarrativeRule>): string {
  if (rules.length === 0) return '';
  const parts: string[] = [];
  for (const r of rules) {
    const fps = r.frameRate ?? 12;
    const loopMode = r.loopMode ?? 'forward';
    // Sub-pixel duration values produce inconsistent step boundaries
    // across browsers — keep three decimals which gives 1ms resolution
    // at 1000fps (well below any sane sprite playback).
    const duration = (r.frameCount / fps).toFixed(3);
    const stride = r.frameCount * r.frameWidth;
    // CSS idents (animation-name, class names) must match
    // [-_A-Za-z0-9 -￿], cannot start with a digit. SceneGraph
    // node IDs are sometimes Figma-style "0:3" — colons / digit-starts
    // break selectors. Sanitize to a safe slug for CSS use; the
    // companion class on the element is set from the SAME slug so the
    // selector and the element class match.
    // Caller passes a CSS-ident-safe slug (allocated via tree-walk
     // counter so two compiles of the same input share slugs). We still
     // run sanitizeForCssIdent as a defensive normalization — mistaken
     // raw-id callers won't blow up CSS selectors.
    const slug = sanitizeForCssIdent(r.nodeId);
    const animName = `reframe-narrative-${slug}-anim`;
    const className = `reframe-narrative-${slug}`;
    let directionDecl = '';
    let iterationDecl = 'animation-iteration-count: infinite;';
    let fillDecl = '';
    if (loopMode === 'reverse') {
      directionDecl = 'animation-direction: reverse;';
    } else if (loopMode === 'pingpong') {
      directionDecl = 'animation-direction: alternate;';
    } else if (loopMode === 'once') {
      iterationDecl = 'animation-iteration-count: 1;';
      fillDecl = 'animation-fill-mode: forwards;';
    }
    parts.push(`
@keyframes ${animName} {
  from { background-position: 0 0; }
  to { background-position: -${stride}px 0; }
}
.${className} {
  width: ${r.frameWidth}px;
  height: ${r.frameHeight}px;
  background-image: url(${cssUrlEscape(r.spriteUrl)});
  background-size: ${stride}px ${r.frameHeight}px;
  background-repeat: no-repeat;
  /* Animation declared but paused until .reframe-narrative-active is
     applied — CSS animations consume composition cycles even when
     paused, but layout/paint cost is zero so this is acceptable. */
  animation-name: ${animName};
  animation-duration: ${duration}s;
  animation-timing-function: steps(${r.frameCount});
  ${iterationDecl}
  ${directionDecl ? directionDecl + '\n  ' : ''}${fillDecl ? fillDecl + '\n  ' : ''}animation-play-state: paused;
}
.${className}.reframe-narrative-active {
  animation-play-state: running;
}`);
  }
  return parts.join('\n');
}

/**
 * Replace any character that's not safe in a CSS identifier with a
 * dash, then prefix with `n` if the result starts with a digit (CSS
 * idents can't start with digits). Both the @keyframes name and the
 * class selector go through this so they always agree.
 *
 * Idempotent: ASCII alphanumeric ids (FNV1A hex) pass through unchanged
 * (no `n` prefix because they may start with a-f, never with a digit-
 * only first char that needs escaping... actually 0-9 hex ids DO start
 * with a digit, so the `n` prefix activates for them too — keeps the
 * sanitizer cheap and uniform).
 */
export function sanitizeForCssIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '-');
  return /^[0-9]/.test(cleaned) ? `n${cleaned}` : cleaned;
}

/**
 * Escape a sprite URL for safe embedding inside `url(...)` in CSS. Most
 * sprite paths are plain ASCII (relative paths, https URLs); the bundle
 * inliner replaces them with `data:` URIs which contain commas and
 * other punctuation that the CSS tokenizer treats specially when
 * un-quoted. Quoting with double-quotes + escaping internal quotes is
 * the safest cross-browser shape.
 */
function cssUrlEscape(url: string): string {
  return `"${url.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
