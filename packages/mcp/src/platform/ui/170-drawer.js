  // ── Phase 1 UI-6b — Missing-surfaces drawer ─────────────────────
  //
  // Slide-in panel from the right edge carrying 4 surfaces lost when
  // the editor-shell route was created (Quality / Variations / Tokens
  // / Rebrand). Linear-style: on-demand, not always-visible bloat;
  // outside-click does NOT close (designer interacts with canvas
  // while drawer is open); Cmd+\ toggles, Esc closes when focused.
  //
  // Mount: editor-shell-page.ts renders the .drawer-root container as
  // a sibling of <aside id="panel">, NOT nested. Architectural lock
  // from UI-6a Pin #4 — inspector's innerHTML overwrite would wipe
  // any nested chrome on first node click. Sibling layout survives.
  //
  // State: { open: boolean, activeTab: 'quality' | 'variations' | 'tokens' | 'rebrand' }.
  // Persisted in localStorage `reframe-drawer-state`. First-paint
  // hydrates from storage; explicit open/close + tab switch updates.
  //
  // Tab switching:
  //   - click any tab in the strip
  //   - Cmd+\ then 1/2/3/4 within 1 s switches active tab AND opens
  //     drawer if closed (kbd power-user path; mirrors VSCode-style
  //     side-panel behavior)
  //
  // Keyboard:
  //   - Cmd+\ (Ctrl+\ on Win/Linux) — toggle open/close
  //   - Esc — close when focused or when drawer is the front-most overlay
  //
  // Per-tab content rendering is owned by tab modules registered via
  // `registerDrawerTab(id, render)`. The drawer module here owns the
  // shell + state + kbd + persistence; tab content lives in 171-
  // tabs.js (next pin).

  var DRAWER_STORAGE_KEY = 'reframe-drawer-state';
  var DRAWER_TAB_IDS = ['quality', 'variations', 'tokens', 'rebrand'];
  var DRAWER_TAB_LABELS = {
    quality: 'Quality',
    variations: 'Variations',
    tokens: 'Tokens',
    rebrand: 'Rebrand',
  };

  // Tab content renderers — registered by 171-drawer-tabs.js. Each
  // renderer takes the body container element and gets called on
  // (a) tab switch, (b) drawer open if the tab is active. Return value
  // ignored — renderers mutate the body in place.
  var __drawerTabRenderers = (window.__drawerTabRenderers = window.__drawerTabRenderers || {});

  window.registerDrawerTab = function(tabId, render) {
    if (!tabId || typeof render !== 'function') return;
    __drawerTabRenderers[tabId] = render;
  };

  function readDrawerState() {
    var defaults = { open: false, activeTab: 'quality' };
    try {
      var raw = localStorage.getItem(DRAWER_STORAGE_KEY);
      if (!raw) return defaults;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      return {
        open: !!parsed.open,
        activeTab: DRAWER_TAB_IDS.indexOf(parsed.activeTab) >= 0 ? parsed.activeTab : 'quality',
      };
    } catch (_) {
      return defaults;
    }
  }

  function writeDrawerState(state) {
    try { localStorage.setItem(DRAWER_STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  function bindDrawer() {
    var root = document.querySelector('[data-drawer-root]');
    if (!root) return; // Not on editor shell

    // Build tab strip + body containers if not already present.
    if (!root.querySelector('[data-drawer-tabs]')) {
      var tabsHtml = DRAWER_TAB_IDS.map(function(id, idx) {
        return '<button type="button" class="drawer-tab" data-drawer-tab="' + id + '" '
          + 'role="tab" aria-controls="drawer-body-' + id + '" '
          + 'data-drawer-tab-idx="' + (idx + 1) + '">'
          + DRAWER_TAB_LABELS[id]
          + '</button>';
      }).join('');
      var bodiesHtml = DRAWER_TAB_IDS.map(function(id) {
        return '<div class="drawer-body" data-drawer-body="' + id + '" id="drawer-body-' + id + '" role="tabpanel" hidden></div>';
      }).join('');
      root.innerHTML =
        '<div class="drawer-tabs" data-drawer-tabs role="tablist">' + tabsHtml + '</div>'
        + '<div class="drawer-bodies">' + bodiesHtml + '</div>';
    }

    // Hydrate from storage.
    var state = readDrawerState();
    applyDrawerState(state);

    // Tab clicks.
    root.querySelectorAll('[data-drawer-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-drawer-tab');
        if (!id) return;
        // Tab click implies drawer should be open.
        var newState = { open: true, activeTab: id };
        applyDrawerState(newState);
        writeDrawerState(newState);
      });
    });

    // Cmd+\ toggle (window-level, gated on focus to editor shell)
    // plus number-key shortcut for tab pick when sequenced after.
    var lastBackslashAt = 0;
    window.addEventListener('keydown', function(e) {
      if (!isOnEditorShell()) return;
      var meta = e.metaKey || e.ctrlKey;
      // Cmd+\ — primary toggle.
      if (meta && e.key === '\\') {
        e.preventDefault();
        var cur = readDrawerState();
        var next = { open: !cur.open, activeTab: cur.activeTab };
        applyDrawerState(next);
        writeDrawerState(next);
        lastBackslashAt = Date.now();
        return;
      }
      // 1/2/3/4 within 1 s of Cmd+\ — tab pick.
      if (lastBackslashAt && Date.now() - lastBackslashAt < 1000) {
        var idx = parseInt(e.key, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= DRAWER_TAB_IDS.length) {
          e.preventDefault();
          var pickState = { open: true, activeTab: DRAWER_TAB_IDS[idx - 1] };
          applyDrawerState(pickState);
          writeDrawerState(pickState);
          lastBackslashAt = 0;
          return;
        }
      }
      // Esc — close when drawer is open. Don't steal Esc when it has
      // higher-priority consumers (inline-edit, modal, etc.).
      if (e.key === 'Escape') {
        var s = readDrawerState();
        if (s.open && shouldDrawerHandleEscape(e)) {
          e.preventDefault();
          var closeState = { open: false, activeTab: s.activeTab };
          applyDrawerState(closeState);
          writeDrawerState(closeState);
        }
      }
    });

    // Public helper: open + activate. Used by 060-stream.js (Cmd+K
    // palette commands) and any future caller that wants to land
    // a designer on a specific tab without keyboard chord.
    window.reframeOpenDrawer = function(tabId) {
      var t = DRAWER_TAB_IDS.indexOf(tabId) >= 0 ? tabId : 'quality';
      var s = { open: true, activeTab: t };
      applyDrawerState(s);
      writeDrawerState(s);
    };

    window.reframeCloseDrawer = function() {
      var cur = readDrawerState();
      var s = { open: false, activeTab: cur.activeTab };
      applyDrawerState(s);
      writeDrawerState(s);
    };
  }

  function isOnEditorShell() {
    // The drawer only exists on /platform/project/<slug>; readiness
    // gate prevents window listeners from firing on dashboards or
    // other shells that may share global key bindings.
    return !!document.querySelector('[data-drawer-root]');
  }

  function shouldDrawerHandleEscape(e) {
    // If a contenteditable element is focused, the inline-text-edit
    // module handles Escape (revert). Don't intercept.
    var t = e.target;
    if (t && t.isContentEditable) return false;
    // If the color-picker rail or another higher-z popover is open,
    // let those handle Escape first.
    if (document.querySelector('[data-rfd-color-picker]')) return false;
    return true;
  }

  function applyDrawerState(state) {
    var root = document.querySelector('[data-drawer-root]');
    if (!root) return;
    root.classList.toggle('open', !!state.open);
    root.setAttribute('aria-hidden', state.open ? 'false' : 'true');
    // Tab strip — active class.
    root.querySelectorAll('[data-drawer-tab]').forEach(function(btn) {
      var id = btn.getAttribute('data-drawer-tab');
      btn.classList.toggle('active', id === state.activeTab);
      btn.setAttribute('aria-selected', id === state.activeTab ? 'true' : 'false');
    });
    // Bodies — show only the active one.
    root.querySelectorAll('[data-drawer-body]').forEach(function(body) {
      var id = body.getAttribute('data-drawer-body');
      var isActive = id === state.activeTab;
      if (isActive) body.removeAttribute('hidden');
      else body.setAttribute('hidden', '');
    });
    // Render active tab content. Called on every state change so
    // re-opening picks up server-side updates (audit, tokens, etc.).
    if (state.open) {
      var activeBody = root.querySelector('[data-drawer-body="' + state.activeTab + '"]');
      var renderer = __drawerTabRenderers[state.activeTab];
      if (activeBody && typeof renderer === 'function') {
        try { renderer(activeBody); } catch (e) { console.warn('[drawer] tab render failed', e); }
      }
    }
  }
