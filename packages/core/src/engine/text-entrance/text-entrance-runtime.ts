/**
 * Runtime source for text entrance animations (T2 #32).
 *
 * Single IIFE inlined into html.ts exports. Walks
 * `[data-reframe-entrance]` elements at DOMContentLoaded, attaches one
 * IntersectionObserver per element. On viewport entry (≥20% visible),
 * splits the element's text per the type's strategy (chars / words /
 * whole-block), wraps fragments in `<span>` with staggered
 * animation-delay, applies the matching CSS class. CSS keyframes (in
 * the scene <style>) drive the actual visual transform.
 *
 * ─── Why split at runtime, not at import ────────────────────
 *
 * Split-at-import bloats output HTML (each char wrapped in span — a
 * 30-char headline becomes 30 `<span>` nodes). Worse: editor mutations
 * see the split spans, not the original text — `reframe_edit op=update`
 * on the headline would have to know about the split, defeating the
 * "INode contains the readable text" invariant.
 *
 * Runtime split: source HTML is clean, INode.text stays editable, and
 * the split lives entirely in browser-side concern. Trade-off: first
 * paint flashes the original text before split kicks in. Acceptable
 * because IntersectionObserver fires after layout, splits are <1ms,
 * and the unsplit text is invisible (opacity 0 via base class) until
 * IO triggers the animation anyway.
 *
 * ─── Why IntersectionObserver, not on-load ──────────────────
 *
 * Above-fold elements: IO fires immediately on mount because element
 * is already in viewport. Below-fold: animation triggers when user
 * scrolls to it — the canonical "reveal-on-scroll" pattern. Single
 * mechanism covers both cases without an opt-in flag.
 *
 * ─── Caps (per-char 200, per-word 50) ───────────────────────
 *
 * Splitting beyond these counts thrashes layout — N spans × M frames
 * × 60fps = many compositing operations. Runtime detects, downgrades
 * to fade-up (whole-block) with a one-time console.warn. Designer
 * sees a working scene + a clear log line pointing at the specific
 * element to refactor.
 *
 * ─── Unicode handling ───────────────────────────────────────
 *
 * Array.from(text) — iterates by codepoint, preserves surrogate pairs
 * (most emoji, CJK extension B+). NOT grapheme-cluster aware: combining
 * marks split at codepoint boundary. Acceptable for Phase 0 ASCII +
 * basic-Unicode design content. Intl.Segmenter would fix this once
 * Safari support stabilizes — future signal.
 */

export const TEXT_ENTRANCE_RUNTIME_SOURCE = `
(function() {
  if (window.__reframeTextEntrance) return;
  window.__reframeTextEntrance = true;

  var DEFAULTS = {
    streaming:    { duration: 600, stagger: 15, easing: 'ease-out' },
    typing:       { duration: 50,  stagger: 50, easing: 'steps(1)' },
    'word-reveal':{ duration: 400, stagger: 80, easing: 'ease-out' },
    'fade-up':    { duration: 600, stagger: 0,  easing: 'ease-out' },
  };
  var CHAR_CAP = 200;
  var WORD_CAP = 50;
  var warned = {};

  function readConfig(el) {
    var raw = el.getAttribute('data-reframe-entrance-config');
    var cfg = {};
    if (raw) {
      try { cfg = JSON.parse(raw); }
      catch (e) { console.warn('[reframe-entrance] failed to parse config on', el, e); }
    }
    return cfg;
  }

  function warnOnce(key, msg) {
    if (warned[key]) return;
    warned[key] = true;
    console.warn(msg);
  }

  function splitAndPlay(el, type, config) {
    var defaults = DEFAULTS[type] || DEFAULTS['fade-up'];
    var stagger = typeof config.stagger === 'number' ? config.stagger : defaults.stagger;
    var delay = typeof config.delay === 'number' ? config.delay : 0;
    // Capture original text before mutating element.
    var text = el.textContent || '';
    var actualType = type;

    if (type === 'streaming' || type === 'typing') {
      var chars = Array.from(text);  // surrogate-pair safe
      if (chars.length > CHAR_CAP) {
        warnOnce('char-cap-' + type,
          '[reframe-entrance] element with ' + chars.length + ' chars exceeds ' + CHAR_CAP + '-char cap for "' + type + '". Falling back to fade-up. Split into smaller text blocks for staggered char effect.');
        actualType = 'fade-up';
      }
      if (actualType !== 'fade-up') {
        el.textContent = '';
        for (var i = 0; i < chars.length; i++) {
          var c = chars[i];
          var span = document.createElement('span');
          // Preserve whitespace — &nbsp; for breaking spaces so layout
          // stays predictable when each char is inline-block.
          span.textContent = c === ' ' ? '\\u00a0' : c;
          span.style.display = 'inline-block';
          span.style.opacity = '0';
          span.style.animationDelay = (delay + i * stagger) + 'ms';
          el.appendChild(span);
        }
        el.classList.add('reframe-entrance-' + actualType);
        return;
      }
    }

    if (type === 'word-reveal') {
      var tokens = text.split(/(\\s+)/);  // keeps separators
      var wordCount = tokens.filter(function(t) { return t && !/^\\s+$/.test(t); }).length;
      if (wordCount > WORD_CAP) {
        warnOnce('word-cap',
          '[reframe-entrance] element with ' + wordCount + ' words exceeds ' + WORD_CAP + '-word cap for "word-reveal". Falling back to fade-up.');
        actualType = 'fade-up';
      } else {
        el.textContent = '';
        var wIdx = 0;
        for (var j = 0; j < tokens.length; j++) {
          var tok = tokens[j];
          if (!tok) continue;
          if (/^\\s+$/.test(tok)) {
            el.appendChild(document.createTextNode(tok));
            continue;
          }
          var wspan = document.createElement('span');
          wspan.textContent = tok;
          wspan.style.display = 'inline-block';
          wspan.style.opacity = '0';
          wspan.style.transform = 'translateY(20px)';
          wspan.style.animationDelay = (delay + wIdx * stagger) + 'ms';
          el.appendChild(wspan);
          wIdx++;
        }
        el.classList.add('reframe-entrance-word-reveal');
        return;
      }
    }

    // fade-up — whole-element animation. Falls through here either as
    // the original requested type OR a cap-driven downgrade.
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.animationDelay = delay + 'ms';
    el.classList.add('reframe-entrance-fade-up');
  }

  function attach(el) {
    var type = el.getAttribute('data-reframe-entrance');
    var KNOWN = { streaming: 1, typing: 1, 'word-reveal': 1, 'fade-up': 1 };
    if (!type || !KNOWN[type]) return;
    var config = readConfig(el);
    var once = config.once !== false;  // default true

    // Set the unanimated baseline immediately so a flash of unstyled
    // text doesn't blink before IO fires. opacity:0 covers all four
    // type variants; specific transforms applied at split time.
    el.style.opacity = '0';

    var triggered = false;
    var io = new IntersectionObserver(function(entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          if (once && triggered) continue;
          triggered = true;
          // Reset state on replay (once=false).
          if (!once && triggered) {
            el.classList.remove('reframe-entrance-streaming', 'reframe-entrance-typing', 'reframe-entrance-word-reveal', 'reframe-entrance-fade-up');
            el.textContent = (el.dataset.reframeEntranceOriginalText || el.textContent || '');
          }
          if (!el.dataset.reframeEntranceOriginalText) {
            el.dataset.reframeEntranceOriginalText = el.textContent || '';
          }
          splitAndPlay(el, type, config);
          if (once) io.disconnect();
        }
      }
    }, { rootMargin: '0px', threshold: 0.2 });
    io.observe(el);
  }

  function init() {
    var nodes = document.querySelectorAll('[data-reframe-entrance]');
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

// ─── CSS keyframe blocks per entrance type ───────────────────
//
// Emitted only for types actually used in the scene (subset CSS). The
// exporter walks the tree, collects unique entrance.type values, calls
// entranceCssFor(usedTypes) → returns a string with just those keyframes
// + class rules. Unused types' CSS never ships — keeps scene <style>
// blocks lean.
//
// Each block is independent: streaming keyframes don't reference typing
// rules. Concatenation order doesn't matter.

const CSS_BY_TYPE: Record<string, string> = {
  streaming: `
@keyframes reframe-entrance-streaming-anim {
  to { opacity: 1; }
}
.reframe-entrance-streaming > span {
  animation: reframe-entrance-streaming-anim 600ms ease-out forwards;
}`,
  typing: `
@keyframes reframe-entrance-typing-anim {
  to { opacity: 1; }
}
.reframe-entrance-typing > span {
  animation: reframe-entrance-typing-anim 50ms steps(1) forwards;
}
@keyframes reframe-entrance-cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.reframe-entrance-typing::after {
  content: '|';
  display: inline-block;
  margin-left: 0.05em;
  animation: reframe-entrance-cursor-blink 800ms infinite;
}`,
  'word-reveal': `
@keyframes reframe-entrance-word-reveal-anim {
  to { opacity: 1; transform: translateY(0); }
}
.reframe-entrance-word-reveal > span {
  animation: reframe-entrance-word-reveal-anim 400ms ease-out forwards;
}`,
  'fade-up': `
@keyframes reframe-entrance-fade-up-anim {
  to { opacity: 1; transform: translateY(0); }
}
.reframe-entrance-fade-up {
  animation: reframe-entrance-fade-up-anim 600ms ease-out forwards;
}`,
};

/** Build CSS for the subset of entrance types used in a scene. */
export function entranceCssFor(usedTypes: ReadonlySet<string>): string {
  const parts: string[] = [];
  // Cap fallback always emits fade-up classes — include fade-up CSS
  // whenever streaming / typing / word-reveal appear, so a runtime
  // downgrade (oversized text → fade-up) renders correctly.
  const needsFadeUpFallback = usedTypes.has('streaming') || usedTypes.has('typing') || usedTypes.has('word-reveal');
  for (const type of ['streaming', 'typing', 'word-reveal', 'fade-up']) {
    if (usedTypes.has(type)) parts.push(CSS_BY_TYPE[type]);
    else if (type === 'fade-up' && needsFadeUpFallback) parts.push(CSS_BY_TYPE[type]);
  }
  return parts.join('\n');
}

export const KNOWN_ENTRANCE_TYPES: ReadonlyArray<'streaming' | 'typing' | 'word-reveal' | 'fade-up'> = [
  'streaming',
  'typing',
  'word-reveal',
  'fade-up',
];

export function isKnownEntranceType(s: string): s is 'streaming' | 'typing' | 'word-reveal' | 'fade-up' {
  return KNOWN_ENTRANCE_TYPES.indexOf(s as any) !== -1;
}
