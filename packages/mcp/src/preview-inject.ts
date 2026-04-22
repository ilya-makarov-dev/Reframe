/**
 * Phase 8 — Preview inject script.
 *
 * This script is injected into every `/preview/:id` HTML response (before
 * the closing `</body>` tag). It runs inside the iframe and bridges the
 * live DOM to the parent window (Platform UI) via postMessage.
 *
 * Responsibilities:
 *
 *   1. HOVER TRACKING. mousemove over the document, find the innermost
 *      element with `data-reframe-inode`, compute its bounding rect in
 *      iframe coordinates, and post `{type:'reframe:hover', inode, bbox}`
 *      to the parent. The parent draws an outline on its SVG annotation
 *      overlay at those coordinates (with the iframe scale factor
 *      applied). Leaves send `{type:'reframe:hover', inode:null}`.
 *
 *   2. CLICK CAPTURE. pointerdown on an inode-tagged element posts
 *      `{type:'reframe:click', inode, bbox, modifiers}` so the parent
 *      can update its selection state and surface the verb chip bar.
 *      modifiers carries shift/meta/ctrl/alt for multi-select + modes.
 *      We deliberately suppress navigation from `<a>` clicks while the
 *      parent is in "annotation mode" so clicking a link doesn't navigate
 *      the iframe away — the parent tells us via a "setMode" message.
 *
 *   3. ESCAPE. keydown Escape posts `{type:'reframe:cancel'}` to clear
 *      pending selection / close the chip bar.
 *
 *   4. SCROLL TRACKING. On scroll, post the current scroll offset so
 *      the parent can reposition active outlines without re-hovering.
 *
 *   5. READY HANDSHAKE. After DOMContentLoaded, post `{type:'reframe:ready'}`
 *      to signal the parent that hover tracking is live.
 *
 * Guard rails:
 *
 *   - Idempotent: if the script runs twice (HMR-style replacement), the
 *     second run wipes the first run's listeners via a sentinel.
 *   - Silent on missing data-reframe-inode: hover over unannotated areas
 *     just sends `inode:null`. No errors.
 *   - No transitive side effects: we never touch the DOM visually — all
 *     highlight rendering happens on the parent's SVG overlay.
 */

export const PREVIEW_INJECT_JS = `
(function() {
  'use strict';
  // Idempotent install: previous run's state lives on window.__reframeInject.
  const PRIOR = window.__reframeInject;
  if (PRIOR && typeof PRIOR.teardown === 'function') {
    try { PRIOR.teardown(); } catch (_) {}
  }

  const state = {
    lastHoverInode: null,
    annotationMode: false, // parent toggles this via setMode message
    hoverEl: null,   // currently-outlined hover element (in-iframe paint)
    selectEl: null,  // currently-outlined selected element
  };

  // ── In-iframe hover/select outline ─────────────────────
  // The parent used to draw hover/select outlines on an SVG overlay
  // above the iframe, but on the project canvas there are N iframes
  // and per-iframe overlays are coord-math hell. Painting the outline
  // INSIDE the iframe (via a toggled attribute + injected stylesheet)
  // works everywhere: one line of CSS, no overlay, no scale math.
  // Only runs in annotationMode — otherwise the preview stays clean.
  function installOutlineStyles() {
    if (document.getElementById('__reframe_outline_style')) return;
    const style = document.createElement('style');
    style.id = '__reframe_outline_style';
    style.textContent =
      '[data-reframe-hover]{outline:2px solid rgba(233,75,26,0.55)!important;outline-offset:2px!important;cursor:crosshair!important}' +
      '[data-reframe-selected]{outline:2.5px solid #E94B1A!important;outline-offset:2px!important}';
    (document.head || document.documentElement).appendChild(style);
  }
  function setHoverEl(el) {
    if (state.hoverEl === el) return;
    if (state.hoverEl) {
      try { state.hoverEl.removeAttribute('data-reframe-hover'); } catch (_) {}
    }
    state.hoverEl = el;
    if (el) {
      try { el.setAttribute('data-reframe-hover', ''); } catch (_) {}
    }
  }
  function setSelectEl(el) {
    if (state.selectEl === el) return;
    if (state.selectEl) {
      try { state.selectEl.removeAttribute('data-reframe-selected'); } catch (_) {}
    }
    state.selectEl = el;
    if (el) {
      try { el.setAttribute('data-reframe-selected', ''); } catch (_) {}
    }
  }
  function clearOutlines() {
    setHoverEl(null);
    setSelectEl(null);
  }

  function findInodeElement(target) {
    if (!target || target.nodeType !== 1) return null;
    let el = target;
    while (el && el.nodeType === 1) {
      if (el.hasAttribute && el.hasAttribute('data-reframe-inode')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function bboxOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + window.scrollX,
      y: r.top + window.scrollY,
      w: r.width,
      h: r.height,
    };
  }

  // Parent and preview iframe are same-origin (both served by the sidecar).
  // Pin targetOrigin to window.location.origin so an embedder that mounts
  // /preview/:id in a cross-origin page never receives our hover/click/bbox
  // stream — that would leak scene structure + text content.
  const PARENT_ORIGIN = window.location.origin;
  function post(message) {
    try {
      window.parent.postMessage({ source: 'reframe-preview', ...message }, PARENT_ORIGIN);
    } catch (_) {}
  }

  // ── Hover ──────────────────────────────────────────────
  function onPointerMove(e) {
    const el = findInodeElement(e.target);
    const inode = el ? el.getAttribute('data-reframe-inode') : null;
    // In-iframe hover outline: paint directly on the element when the
    // user is in annotation mode. Parent still gets the event for
    // right-panel updates on click.
    if (state.annotationMode) setHoverEl(el || null);
    if (inode === state.lastHoverInode) return;
    state.lastHoverInode = inode;
    if (!inode || !el) {
      post({ type: 'reframe:hover', inode: null });
      return;
    }
    post({
      type: 'reframe:hover',
      inode: inode,
      tag: el.tagName.toLowerCase(),
      bbox: bboxOf(el),
    });
  }

  function onPointerLeave() {
    state.lastHoverInode = null;
    if (state.annotationMode) setHoverEl(null);
    post({ type: 'reframe:hover', inode: null });
  }

  // ── Click ──────────────────────────────────────────────
  function onPointerDown(e) {
    const el = findInodeElement(e.target);
    if (!el) return;
    const inode = el.getAttribute('data-reframe-inode');
    // Suppress link navigation when parent is driving annotation mode —
    // otherwise the iframe would navigate away from the preview.
    if (state.annotationMode) {
      e.preventDefault();
      e.stopPropagation();
      // Paint selection outline locally — parent still gets the event
      // for right-panel property updates via postMessage below.
      setSelectEl(el);
    }
    post({
      type: 'reframe:click',
      inode: inode,
      tag: el.tagName.toLowerCase(),
      bbox: bboxOf(el),
      modifiers: {
        shift: !!e.shiftKey,
        meta:  !!e.metaKey,
        ctrl:  !!e.ctrlKey,
        alt:   !!e.altKey,
        button: e.button,
      },
    });
  }

  // Also swallow the subsequent click event to prevent <a>/<button>
  // default actions when in annotation mode.
  function onClickCapture(e) {
    if (!state.annotationMode) return;
    const el = findInodeElement(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ── Right-click (context menu) ──────────────────────────
  function onContextMenu(e) {
    if (!state.annotationMode) return;
    var el = findInodeElement(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var inode = el.getAttribute('data-reframe-inode');
    post({
      type: 'reframe:contextmenu',
      inode: inode,
      tag: el.tagName.toLowerCase(),
      bbox: bboxOf(el),
    });
  }

  // ── Keyboard ───────────────────────────────────────────
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      post({ type: 'reframe:cancel' });
    }
  }

  // ── Scroll ─────────────────────────────────────────────
  function onScroll() {
    post({
      type: 'reframe:scroll',
      x: window.scrollX,
      y: window.scrollY,
    });
  }

  // ── Parent → iframe messages ───────────────────────────
  function onMessage(event) {
    // Origin-pin. Without this, ANY page that embeds our preview (or a
    // sibling frame under the same top) can postMessage with a forged
    // source:'reframe-host' tag and flip annotationMode / trigger a
    // measurement storm via reframe:measure-all. String-tag alone is not
    // a trust boundary.
    if (event.origin !== PARENT_ORIGIN) return;
    if (event.source !== window.parent) return;
    const data = event.data || {};
    if (data.source !== 'reframe-host') return;
    if (data.type === 'reframe:setMode') {
      state.annotationMode = !!data.annotationMode;
      // Visual hint: change cursor so the user sees they're in annotation mode.
      document.documentElement.style.cursor = state.annotationMode ? 'crosshair' : '';
      if (state.annotationMode) {
        installOutlineStyles();
      } else {
        // Leaving annotation mode wipes any local outlines.
        clearOutlines();
      }
    }
    if (data.type === 'reframe:ping') {
      post({ type: 'reframe:pong' });
    }
    if (data.type === 'reframe:highlight' && data.inode) {
      // Parent asks us to scroll an inode into view.
      const el = document.querySelector('[data-reframe-inode="' + cssEscape(data.inode) + '"]');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    if (data.type === 'reframe:measure-all') {
      sendMeasurements();
    }
  }

  // ── Measurement — bbox + computed style per inode ─────
  // Parent asks for this on load + when it needs to (re)render persistent
  // annotation marks. We walk every [data-reframe-inode] element, capture
  // its bbox and a compact computed-style signature, and post the whole
  // map back in one message. Cheap — the parent calls us at most once
  // per viewport switch or after a graph mutation.
  function sendMeasurements() {
    const out = [];
    const nodes = document.querySelectorAll('[data-reframe-inode]');
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      const inode = el.getAttribute('data-reframe-inode');
      if (!inode) continue;
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      out.push({
        inode: inode,
        tag: el.tagName.toLowerCase(),
        bbox: {
          x: r.left + window.scrollX,
          y: r.top + window.scrollY,
          w: r.width,
          h: r.height,
        },
        // Compact computed-style signature — used for Resonance matching.
        style: {
          bg: cs.backgroundColor,
          color: cs.color,
          fs: cs.fontSize,
          fw: cs.fontWeight,
          ff: cs.fontFamily,
          br: cs.borderRadius,
          pad: cs.padding,
          display: cs.display,
        },
        className: (typeof el.className === 'string') ? el.className : '',
        role: el.getAttribute('data-role') || '',
        text: ((el.textContent || '').trim()).slice(0, 60),
      });
    }
    post({ type: 'reframe:measurements', measurements: out });
  }

  // ── Auto re-measure on layout changes ─────────────────
  // Debounced at 300ms — any faster and rapid DOM mutations (theme
  // swap, CSS transitions) trigger a measurement storm that forces
  // 500+ synchronous getBoundingClientRect calls. 300ms is below the
  // "feels sluggish" threshold and well above typical mutation bursts.
  let measureTimer = null;
  function scheduleMeasure() {
    if (measureTimer) return;
    measureTimer = setTimeout(function() {
      measureTimer = null;
      sendMeasurements();
    }, 300);
  }

  function cssEscape(s) {
    if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(s);
    return String(s).replace(/["\\\\]/g, '\\\\$&');
  }

  // ── Install / teardown ─────────────────────────────────
  let mutationObs = null;
  let resizeObs = null;

  function install() {
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('message', onMessage);
    window.addEventListener('resize', scheduleMeasure);
    // Any DOM mutation under body triggers a debounced re-measure so
    // persistent marks on the parent stay glued to their anchors.
    if (typeof MutationObserver !== 'undefined') {
      mutationObs = new MutationObserver(scheduleMeasure);
      mutationObs.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
  }

  function teardown() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerleave', onPointerLeave);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', scheduleMeasure);
    if (mutationObs) { try { mutationObs.disconnect(); } catch (_) {} mutationObs = null; }
  }

  window.__reframeInject = { install, teardown, state };

  function ready() {
    install();
    post({ type: 'reframe:ready' });
    // First measurement batch — parent might render annotation marks
    // immediately once it receives this.
    scheduleMeasure();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
`;

/**
 * Splice the inject script into an HTML string, before `</body>`.
 * Idempotent: if the HTML has no `</body>`, appends at the end.
 */
export function injectPreviewScript(html: string): string {
  const script = `<script>${PREVIEW_INJECT_JS}</script>`;
  const closeBody = '</body>';
  const idx = html.lastIndexOf(closeBody);
  if (idx === -1) return html + script;
  return html.slice(0, idx) + script + html.slice(idx);
}
