/*
  site.js
  Agent J, below-fold motion for The Healing Bench.

  Vanilla JS, no libraries, no build step. Owns: the spine drive, the hold
  interaction, per-child staggered reveal choreography, the word-mask heading
  reveal, scroll-linked parallax, the reviews depth-drift carousel, the
  magnetic book CTA, the FAQ accordion, nav (smooth scroll, current-section
  highlight, mobile toggle), tab visibility, live reduced-motion pinning,
  ambient steam particles and the spine scroll-progress fill.

  Nine distinct mechanisms, mapped one per section so no two neighbours read
  the same way (see the bottom of this file for the map):
    1. word-mask heading reveal on every [data-split="words"] heading
    2. the section label rule drawing itself in, riding the reveal system
    3. per-child staggered entrances (the workhorse, most sections)
    4. scroll-linked parallax, writing --p on [data-parallax]
    5. the practitioner photo clip-path unwrap, riding the reveal system
    6. the reviews depth-drift carousel, self-driving, draggable
    7. the magnetic book CTA
    8. the press-and-hold heat stone, carried over from v2 unchanged
    9. the spine nodes filling as sections pass, carried over from v2

  Direction v3 dropped the single dark ground for alternating warm bands
  (espresso, tan, cream) and the ember accent. Nothing here writes a colour
  value except the ambient steam particles, and that now reads the host
  section's own computed text colour at runtime instead of assuming a dark
  ground, so it still reads correctly if a future edit moves the stone onto a
  light band.

  Every DOM lookup is guarded: a missing element degrades that one feature,
  never the page. One live reduced() helper is checked fresh, every call, in
  every feature below. Every feature that pins to a final state on reduced
  motion undoes that pin on the way back out.
*/
(function () {
  'use strict';

  var doc = document;
  var body = doc.body;

  /* -----------------------------------------------------------------------
     Shared helpers.
  ----------------------------------------------------------------------- */

  function noop() {}

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function mq(query) {
    if (typeof window.matchMedia === 'function') return window.matchMedia(query);
    // Ancient-browser fallback: never matches, listener add/remove are no-ops.
    return { matches: false, addEventListener: noop, removeEventListener: noop };
  }

  var reduceMotionMQ = mq('(prefers-reduced-motion: reduce)');
  var phoneMQ = mq('(max-width: 720px)');
  var finePointerMQ = mq('(hover: hover) and (pointer: fine)');

  // The one live reduced-motion check. Never cache its result in a variable
  // that outlives the call it was read for; every feature below calls this
  // fresh, at the moment it matters, so a mid-session OS toggle is honoured
  // immediately in both directions.
  function reduced() { return !!reduceMotionMQ.matches; }

  function hexToRgb(hex, fallback) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || '').trim());
    if (!m) return fallback;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function parseRgbString(str) {
    var m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(str || '');
    if (!m) return null;
    return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  }

  // Reads an element's own computed text colour rather than a hardcoded
  // token, so an ambient effect placed on a dark band and one placed on a
  // light band both come out legible without the script knowing which band
  // it is on. Falls back to a bone-ish tone (v3's --bone) if the read fails.
  function readAmbientColor(el, fallbackHex) {
    try {
      var rgb = parseRgbString(getComputedStyle(el).color);
      if (rgb) return rgb;
    } catch (e) { /* a detached or exotic node: fall through to the fallback */ }
    return hexToRgb(fallbackHex, [247, 241, 232]);
  }

  // The eight below-fold sections, in document order. Nav links point at
  // these; the spine carries one node per id.
  var SECTION_IDS = ['intro', 'practitioners', 'treatments', 'fees', 'visit', 'reviews', 'faq', 'book'];

  // Shared "is the tab hidden" flag, read by every rAF-driven feature below
  // so their loops rest instead of animating an invisible tab.
  var tabPaused = doc.visibilityState === 'hidden';
  var pauseListeners = [];

  function notifyPauseListeners() {
    for (var i = 0; i < pauseListeners.length; i++) {
      try { pauseListeners[i](tabPaused); } catch (e) { /* one listener failing must not break the rest */ }
    }
  }

  /* -----------------------------------------------------------------------
     TAB VISIBILITY. body.paused toggled on visibilitychange. Agent S's CSS
     rule is body.paused *, body.paused *::before, body.paused *::after
       { animation-play-state: paused !important }
  ----------------------------------------------------------------------- */

  function initVisibility() {
    function update() {
      var next = doc.visibilityState === 'hidden';
      if (next === tabPaused) return; // delta gate
      tabPaused = next;
      body.classList.toggle('paused', tabPaused);
      notifyPauseListeners();
    }
    doc.addEventListener('visibilitychange', update);
    body.classList.toggle('paused', tabPaused);
  }

  /* -----------------------------------------------------------------------
     MECHANISM 9. THE SPINE DRIVE. One IntersectionObserver over the eight
     sections. Adds .is-passed to .spine__node[data-for="<id>"] as each
     section is reached, removes it on the way back up. Drives nav
     current-section highlighting from the same observer, no second scroll
     listener. Carried over unchanged from v2.
  ----------------------------------------------------------------------- */

  function initSpine() {
    var sections = [];
    for (var i = 0; i < SECTION_IDS.length; i++) {
      var el = doc.getElementById(SECTION_IDS[i]);
      if (el) sections.push(el);
    }
    if (!sections.length) return { pin: noop, unpin: noop };

    var nodes = {};
    for (var n = 0; n < SECTION_IDS.length; n++) {
      var id = SECTION_IDS[n];
      var node = doc.querySelector('.spine__node[data-for="' + id + '"]');
      if (node) nodes[id] = node;
    }

    var navLinks = Array.prototype.slice.call(doc.querySelectorAll('a[href^="#"]')).filter(function (a) {
      var href = a.getAttribute('href') || '';
      return SECTION_IDS.indexOf(href.slice(1)) !== -1;
    });

    var passedState = {};
    var currentId = null;
    var io = null;

    function setPassed(id, passed) {
      if (passedState[id] === passed) return; // delta gate
      passedState[id] = passed;
      var node = nodes[id];
      if (node) node.classList.toggle('is-passed', passed);
    }

    function setCurrent(id) {
      if (id === currentId) return; // delta gate
      currentId = id;
      for (var i = 0; i < navLinks.length; i++) {
        var a = navLinks[i];
        var match = a.getAttribute('href').slice(1) === id;
        if (a.classList.contains('is-current') !== match) {
          a.classList.toggle('is-current', match);
        }
        if (match) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }

    function recomputeCurrent() {
      var found = null;
      for (var i = 0; i < sections.length; i++) {
        if (passedState[sections[i].id]) found = sections[i].id;
      }
      if (found) setCurrent(found);
    }

    var TRIGGER_FRACTION = 0.2; // 20 percent from the top of the viewport

    function onIntersect(entries) {
      var triggerY = window.innerHeight * TRIGGER_FRACTION;
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        var id = entry.target.id;
        setPassed(id, entry.boundingClientRect.top <= triggerY);
      }
      recomputeCurrent();
    }

    function startObserving() {
      if (io) return;
      io = new IntersectionObserver(onIntersect, { root: null, rootMargin: '0px 0px -80% 0px', threshold: 0 });
      for (var i = 0; i < sections.length; i++) io.observe(sections[i]);
    }

    function stopObserving() {
      if (!io) return;
      io.disconnect();
      io = null;
    }

    function pin() {
      stopObserving();
      for (var i = 0; i < SECTION_IDS.length; i++) setPassed(SECTION_IDS[i], true);
      recomputeCurrent();
    }

    function unpin() {
      for (var i = 0; i < SECTION_IDS.length; i++) setPassed(SECTION_IDS[i], false);
      currentId = null;
      startObserving();
    }

    if (!('IntersectionObserver' in window)) {
      pin(); // no way to track scroll position: show the finished state
    } else if (reduced()) {
      pin();
    } else {
      startObserving();
    }

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     NAV. Smooth scroll honouring reduced motion, mobile toggle with correct
     aria-expanded, focus trapping while open, Escape to close. Current-
     section highlighting is handled inside initSpine() above, off the same
     observer. Carried over unchanged from v2.
  ----------------------------------------------------------------------- */

  function initNav() {
    var toggle = doc.getElementById('navToggle') || doc.querySelector('.nav__toggle, [data-nav-toggle]');
    var panel = null;
    if (toggle) {
      var panelId = toggle.getAttribute('aria-controls');
      if (panelId) panel = doc.getElementById(panelId);
    }
    if (!panel) panel = doc.querySelector('.nav__list, #navList, .nav__panel, [data-nav-panel]');

    var open = false;

    // The toggle button is always the correct focus-return point for a
    // disclosure widget, and it is known reliably up front. Safari
    // (desktop and iOS) does not move focus to a <button> on click or tap
    // unless "Full Keyboard Access" is turned on, so document.activeElement
    // read at open time cannot be trusted to be the toggle on those
    // browsers. Hardcode the restore target instead of deriving it.
    var restoreFocusTo = toggle;

    // Background content stays reachable to a screen reader (swipe
    // navigation ignores the Tab trap) while the panel is open. inert
    // removes it from the accessibility tree and tab order in supporting
    // browsers; aria-hidden is the fallback where inert is not supported.
    // Assigning a nonexistent IDL property is a harmless no-op, so this is
    // safe even in ancient browsers.
    var backgroundEls = (function () {
      var list = [];
      var main = doc.getElementById('main') || doc.querySelector('main');
      if (main) list.push(main);
      var footer = doc.querySelector('footer');
      if (footer) list.push(footer);
      return list;
    })();

    function setBackgroundHidden(hidden) {
      for (var i = 0; i < backgroundEls.length; i++) {
        var el = backgroundEls[i];
        el.inert = hidden;
        if (hidden) el.setAttribute('aria-hidden', 'true');
        else el.removeAttribute('aria-hidden');
      }
    }

    function focusablesIn(container) {
      if (!container) return [];
      var found = container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      var list = [];
      for (var i = 0; i < found.length; i++) {
        if (found[i].offsetParent !== null) list.push(found[i]);
      }
      return list;
    }

    function onKeydown(e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.key === 'Tab') {
        var focusables = focusablesIn(panel);
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (e.shiftKey && doc.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && doc.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function onDocClick(e) {
      if (!panel || !toggle) return;
      if (panel.contains(e.target) || toggle.contains(e.target)) return;
      closeMenu();
    }

    function openMenu() {
      if (open || !toggle || !panel) return;
      open = true;
      toggle.setAttribute('aria-expanded', 'true');
      panel.classList.add('is-open');
      toggle.classList.add('is-open');
      body.classList.add('nav-open');
      setBackgroundHidden(true);
      var focusables = focusablesIn(panel);
      if (focusables.length) focusables[0].focus();
      doc.addEventListener('keydown', onKeydown);
      doc.addEventListener('click', onDocClick, true);
    }

    // Unconditional: every close path (Escape, outside click, the toggle
    // itself, or a nav link) restores focus to the toggle, no exceptions.
    // A nav link click moves focus onward to its target section immediately
    // after calling this, which is a deliberate, separate focus move for
    // in-page navigation, not a bug: the two focus() calls are synchronous
    // with no paint between them, so a screen reader announces only the
    // final target, never an intermediate stop on the toggle.
    function closeMenu() {
      if (!open) return;
      open = false;
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (panel) panel.classList.remove('is-open');
      if (toggle) toggle.classList.remove('is-open');
      body.classList.remove('nav-open');
      setBackgroundHidden(false);
      doc.removeEventListener('keydown', onKeydown);
      doc.removeEventListener('click', onDocClick, true);
      if (restoreFocusTo && typeof restoreFocusTo.focus === 'function') restoreFocusTo.focus();
    }

    if (toggle && panel) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', function () {
        if (open) closeMenu(); else openMenu();
      });
    }

    var links = Array.prototype.slice.call(doc.querySelectorAll('a[href^="#"]'));
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        var hash = (a.getAttribute('href') || '').slice(1);
        if (SECTION_IDS.indexOf(hash) === -1 && hash !== 'hero' && hash !== 'top') return;
        a.addEventListener('click', function (e) {
          var target = doc.getElementById(hash);
          if (!target) return;
          e.preventDefault();
          target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
          if (open) closeMenu();
          var hadTabIndex = target.hasAttribute('tabindex');
          if (!hadTabIndex) target.setAttribute('tabindex', '-1');
          if (typeof target.focus === 'function') target.focus({ preventScroll: true });
          if (!hadTabIndex) {
            target.addEventListener('blur', function onBlur() {
              target.removeAttribute('tabindex');
              target.removeEventListener('blur', onBlur);
            }, { once: true });
          }
        });
      })(links[i]);
    }
  }

  /* -----------------------------------------------------------------------
     MECHANISM 3 (plus the CSS-only riders for mechanisms 2 and 5). REVEAL
     CHOREOGRAPHY. IntersectionObserver adds .in to [data-reveal] elements,
     unobserved after entrance (one-shot).

     A container carrying data-stagger="<ms>" gets its direct children each
     given .in with an incrementing transitionDelay, the per-child cascade
     that replaces the old single whole-block fade. A container with no
     data-stagger just gets .in on itself, which is all the section-label
     rule draw (mechanism 2, .slabel__rule inside .slabel[data-reveal]) needs.

     The practitioner photo clip-path unwrap (mechanism 5) rides this same
     stagger: .practitioners__grid carries data-stagger, each
     .practitioner-card gets .in in turn, and Agent S's CSS keys the
     clip-path and photo scale off ".practitioner-card.in ...". No bespoke
     JS is needed for that mechanism because a clip-path transition is pure
     CSS; this function's only job is handing out the right class at the
     right moment, which it already does generically.

     Pin/unpin only affects elements not yet genuinely revealed, so a real
     entrance never reverses.
  ----------------------------------------------------------------------- */

  function initReveal() {
    var els = Array.prototype.slice.call(doc.querySelectorAll('[data-reveal]'));
    if (!els.length) return { pin: noop, unpin: noop };

    var pinned = [];
    var io = null;

    function staggerChildren(el) {
      var ms = parseFloat(el.getAttribute('data-stagger'));
      if (isNaN(ms) || ms <= 0) return;
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        var kid = kids[i];
        kid.style.transitionDelay = (i * ms) + 'ms';
        if (!kid.classList.contains('in')) kid.classList.add('in');
      }
    }

    function clearStagger(el) {
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].style.transitionDelay = '';
        kids[i].classList.remove('in');
      }
    }

    function markIn(el) {
      if (!el.classList.contains('in')) el.classList.add('in');
      staggerChildren(el);
    }
    function markOut(el) {
      if (el.classList.contains('in')) el.classList.remove('in');
      clearStagger(el);
    }

    function onIntersect(entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          markIn(entry.target);
          if (io) io.unobserve(entry.target);
        }
      }
    }

    function startObserving(targets) {
      if (!('IntersectionObserver' in window)) {
        for (var i = 0; i < targets.length; i++) markIn(targets[i]);
        return;
      }
      if (!io) io = new IntersectionObserver(onIntersect, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      for (var t = 0; t < targets.length; t++) io.observe(targets[t]);
    }

    function pin() {
      // Accumulate rather than reset, so a pin() called twice in a row
      // (should not happen given matchMedia's change semantics, but this
      // stays correct either way) never loses track of earlier pins.
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (!el.classList.contains('in')) {
          if (io) io.unobserve(el);
          markIn(el);
          if (pinned.indexOf(el) === -1) pinned.push(el);
        }
      }
    }

    function unpin() {
      if (!pinned.length) return;
      var targets = pinned;
      pinned = [];
      for (var i = 0; i < targets.length; i++) markOut(targets[i]);
      startObserving(targets);
    }

    if (reduced()) pin(); else startObserving(els);

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 1. WORD-MASK HEADING REVEAL. Every [data-split="words"]
     element outside the hero (Agent F already splits the hero's own bands
     inside film-engine.js) is split at runtime into one .word-mask span per
     word, each wrapping a .word-mask__inner span that Agent S's CSS rises
     out from behind an overflow:hidden mask, 55ms stagger via inline
     transitionDelay. The full string is preserved as an aria-label on the
     element itself and every per-word span is aria-hidden, so nothing is
     lost to assistive tech. One-shot, same IntersectionObserver shape as
     initReveal above but kept separate since it drives a different DOM
     transform (splitting text nodes) rather than just a class toggle.
  ----------------------------------------------------------------------- */

  function splitWords(el) {
    if (!el || el.dataset.splitDone === 'true') return;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) { if (el.dataset) el.dataset.splitDone = 'true'; return; }
    el.setAttribute('aria-label', text);
    el.textContent = '';
    var words = text.split(' ');
    for (var i = 0; i < words.length; i++) {
      var mask = doc.createElement('span');
      mask.className = 'word-mask';
      mask.setAttribute('aria-hidden', 'true');
      var inner = doc.createElement('span');
      inner.className = 'word-mask__inner';
      inner.textContent = words[i];
      inner.style.transitionDelay = (i * 55) + 'ms';
      mask.appendChild(inner);
      el.appendChild(mask);
      if (i < words.length - 1) el.appendChild(doc.createTextNode(' '));
    }
    el.dataset.splitDone = 'true';
  }

  function initWordSplit() {
    var all = Array.prototype.slice.call(doc.querySelectorAll('[data-split="words"]'));
    var els = [];
    for (var i = 0; i < all.length; i++) {
      // The hero's own bands are Agent F's territory (film-engine.js).
      if (all[i].closest('#hero') || all[i].closest('#heroStage')) continue;
      els.push(all[i]);
    }
    if (!els.length) return { pin: noop, unpin: noop };

    var pinned = [];
    var io = null;

    function markIn(el) {
      splitWords(el);
      if (!el.classList.contains('in')) el.classList.add('in');
    }
    function markOut(el) {
      if (el.classList.contains('in')) el.classList.remove('in');
    }

    function onIntersect(entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          markIn(entry.target);
          if (io) io.unobserve(entry.target);
        }
      }
    }

    function startObserving(targets) {
      if (!('IntersectionObserver' in window)) {
        for (var i = 0; i < targets.length; i++) markIn(targets[i]);
        return;
      }
      if (!io) io = new IntersectionObserver(onIntersect, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
      for (var t = 0; t < targets.length; t++) io.observe(targets[t]);
    }

    function pin() {
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        splitWords(el);
        if (!el.classList.contains('in')) {
          if (io) io.unobserve(el);
          el.classList.add('in');
          if (pinned.indexOf(el) === -1) pinned.push(el);
        }
      }
    }

    function unpin() {
      if (!pinned.length) return;
      var targets = pinned;
      pinned = [];
      for (var i = 0; i < targets.length; i++) markOut(targets[i]);
      startObserving(targets);
    }

    if (reduced()) pin(); else startObserving(els);

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 4. SCROLL-LINKED PARALLAX. Writes --p, 0 to 1, onto every
     [data-parallax] element as it travels from just entering the bottom of
     the viewport to fully leaving the top. Agent S's CSS turns --p into an
     actual transform (never this script: --p is a data channel, so there is
     no risk of this colliding with a transform another mechanism writes on
     the same element).

     No free-running loop: a scroll or resize event schedules at most one
     rAF frame, that frame does the read/write pass and does not
     reschedule itself, so the loop is inherently at rest until the next
     real scroll/resize event. An IntersectionObserver with a generous
     margin keeps off-screen elements out of the per-frame pass entirely.
  ----------------------------------------------------------------------- */

  function initParallax() {
    var els = Array.prototype.slice.call(doc.querySelectorAll('[data-parallax]'));
    if (!els.length) return { pin: noop, unpin: noop };

    var lastValues = [];
    for (var i0 = 0; i0 < els.length; i0++) lastValues.push(-1);

    var active = []; // { el, idx }
    var rafId = null;
    var enabled = true;

    function activeIndexOf(idx) {
      for (var i = 0; i < active.length; i++) if (active[i].idx === idx) return i;
      return -1;
    }

    function computeAndWrite(el, idx) {
      var rect = el.getBoundingClientRect();
      var vh = window.innerHeight || doc.documentElement.clientHeight;
      var span = vh + rect.height;
      var p = span > 0 ? clamp((vh - rect.top) / span, 0, 1) : 0;
      var rounded = Math.round(p * 500) / 500;
      if (Math.abs(rounded - lastValues[idx]) < 0.001) return; // delta gate
      lastValues[idx] = rounded;
      el.style.setProperty('--p', rounded.toFixed(4));
    }

    function frame() {
      rafId = null;
      if (!enabled || reduced() || tabPaused || !active.length) return;
      for (var i = 0; i < active.length; i++) computeAndWrite(active[i].el, active[i].idx);
      // Deliberately no reschedule here: only a new scroll/resize event, or
      // the IntersectionObserver adding a newly-visible element, asks for
      // another frame. A continuously self-scheduling loop is not needed
      // for a value that only changes when the page actually scrolls.
    }

    function schedule() {
      if (rafId !== null) return;
      if (!enabled || reduced() || tabPaused || !active.length) return;
      rafId = requestAnimationFrame(frame);
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          var idx = els.indexOf(entry.target);
          if (idx === -1) continue;
          var pos = activeIndexOf(idx);
          if (entry.isIntersecting) {
            if (pos === -1) active.push({ el: entry.target, idx: idx });
          } else if (pos !== -1) {
            active.splice(pos, 1);
          }
        }
        schedule();
      }, { rootMargin: '25% 0px 25% 0px', threshold: 0 });
      for (var i1 = 0; i1 < els.length; i1++) io.observe(els[i1]);
    } else {
      for (var i2 = 0; i2 < els.length; i2++) active.push({ el: els[i2], idx: i2 });
    }

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    pauseListeners.push(function (paused) { if (!paused) schedule(); });

    function pin() {
      enabled = false;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      for (var i = 0; i < els.length; i++) els[i].style.setProperty('--p', '0');
    }
    function unpin() {
      enabled = true;
      for (var i = 0; i < lastValues.length; i++) lastValues[i] = -1;
      schedule();
    }

    if (reduced()) pin(); else schedule();

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 6. THE REVIEWS DEPTH-DRIFT CAROUSEL. One scroll position
     drives everything: a continuous idle drift, and every interaction
     (drag/swipe, arrow keys, the prev/next buttons) moves that same
     position through the same code path. Every cell repaints its own scale,
     opacity and transform-origin every frame as a pure function of its own
     distance from view centre.

     Markup contract (documented for Agent M/Agent S, not enforced here
     beyond guarded lookups):
       <div class="reviews__carousel" data-carousel>
         <div class="reviews__view" data-carousel-view tabindex="0"
              role="group" aria-label="Reviews, scrolls sideways">
           <div class="reviews__track" data-carousel-track>
             ...one element per review, at least two...
           </div>
         </div>
         <button data-carousel-prev aria-label="Previous review">...</button>
         <button data-carousel-next aria-label="Next review">...</button>
       </div>

     Generic over any [data-carousel] on the page, not hardcoded to reviews,
     in case a future section wants the same mechanism.

     Reduced motion: the drift stops, every cell sits at rest (no transform,
     no opacity dimming, .is-focus on all of them so nothing looks
     artificially demoted), and the view is still a real scroller with live
     prev/next buttons and arrow keys, never a hidden effect.
  ----------------------------------------------------------------------- */

  function initCarousels() {
    var strips = Array.prototype.slice.call(doc.querySelectorAll('[data-carousel]'));
    if (!strips.length) return { pin: noop, unpin: noop };

    var instances = [];

    for (var s = 0; s < strips.length; s++) {
      (function (strip) {
        var view = strip.querySelector('[data-carousel-view]');
        var track = strip.querySelector('[data-carousel-track]');
        var prevBtn = strip.querySelector('[data-carousel-prev]');
        var nextBtn = strip.querySelector('[data-carousel-next]');
        if (!view || !track) return; // malformed markup: this one strip degrades, not the page

        var originals = Array.prototype.slice.call(track.children);
        if (originals.length < 2) return; // nothing meaningful to loop

        for (var copies = 0; copies < 2; copies++) {
          for (var oi = 0; oi < originals.length; oi++) {
            var copy = originals[oi].cloneNode(true);
            copy.setAttribute('aria-hidden', 'true');
            copy.removeAttribute('id');
            if (copy.querySelectorAll) {
              var idEls = copy.querySelectorAll('[id]');
              for (var k = 0; k < idEls.length; k++) idEls[k].removeAttribute('id');
            }
            track.appendChild(copy);
          }
        }

        var cells = Array.prototype.slice.call(track.children);
        var setWidth = 0;

        function measure() {
          if (!cells[originals.length] || !cells[0]) return;
          setWidth = cells[originals.length].offsetLeft - cells[0].offsetLeft;
        }

        var pos = null;
        var DRIFT = 40; // px/s, tuned per the depth-drift-carousel skill

        function wrap() {
          if (setWidth <= 0) return;
          if (pos === null) pos = view.scrollLeft;
          if (pos >= setWidth * 2) pos -= setWidth;
          else if (pos < setWidth) pos += setWidth;
          view.scrollLeft = pos;
        }
        function normalise() {
          if (setWidth <= 0) return;
          var p = pos === null ? view.scrollLeft : pos;
          pos = setWidth + (((p % setWidth) + setWidth) % setWidth);
          view.scrollLeft = pos;
        }

        function paint() {
          if (reduced()) return;
          var span = view.clientWidth;
          if (!span) return;
          var mid = view.scrollLeft + span / 2;
          for (var i = 0; i < cells.length; i++) {
            var cell = cells[i];
            var off = cell.offsetLeft + cell.offsetWidth / 2 - mid;
            var d = Math.abs(off) / span;
            var scale = Math.max(0.84, 1 - d * 0.38);
            var fade = Math.max(0.38, 1 - d * 1.5);
            var t = Math.max(-1, Math.min(1, off / (span * 0.5)));
            cell.style.transformOrigin = (50 - t * 50).toFixed(1) + '% 50%';
            cell.style.transform = 'scale(' + scale.toFixed(3) + ')';
            cell.style.opacity = fade.toFixed(3);
            cell.classList.toggle('is-focus', d < 0.14);
          }
        }

        function restState() {
          for (var i = 0; i < cells.length; i++) {
            cells[i].style.transform = '';
            cells[i].style.opacity = '';
            cells[i].classList.add('is-focus');
          }
        }

        var held = { hover: false, press: false, hidden: tabPaused, off: true, step: false };
        var running = false, last = 0, rafId = null;

        function shouldRun() {
          return !reduced() && !held.hover && !held.press && !held.hidden && !held.off && !held.step;
        }

        function frame(now) {
          if (!running) return;
          var dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          if (pos === null) pos = view.scrollLeft;
          pos += DRIFT * dt;
          wrap();
          paint();
          if (running) rafId = requestAnimationFrame(frame);
        }

        function sync() {
          var should = shouldRun();
          strip.setAttribute('data-running', should ? 'true' : 'false');
          if (should === running) return;
          running = should;
          if (running) {
            last = performance.now();
            pos = null;
            rafId = requestAnimationFrame(frame);
          } else if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
        }
        function hold(key, on) { held[key] = on; sync(); }

        var stepTimer = null;
        function goTo(target) {
          if (!target) return;
          hold('step', true);
          view.scrollTo({
            left: target.offsetLeft + target.offsetWidth / 2 - view.clientWidth / 2,
            behavior: reduced() ? 'auto' : 'smooth'
          });
          if (stepTimer) clearTimeout(stepTimer);
          stepTimer = setTimeout(function () { pos = null; wrap(); hold('step', false); }, 700);
        }
        function step(dir) {
          var mid = view.scrollLeft + view.clientWidth / 2;
          var best = -1, dist = Infinity;
          for (var i = 0; i < cells.length; i++) {
            var d = Math.abs(cells[i].offsetLeft + cells[i].offsetWidth / 2 - mid);
            if (d < dist) { dist = d; best = i; }
          }
          if (best === -1) return;
          goTo(cells[Math.min(cells.length - 1, Math.max(0, best + dir))]);
        }

        if (prevBtn) prevBtn.addEventListener('click', function () { step(-1); });
        if (nextBtn) nextBtn.addEventListener('click', function () { step(1); });
        view.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
          else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
        });

        view.addEventListener('scroll', paint, { passive: true });
        strip.addEventListener('pointerenter', function () { hold('hover', true); });
        strip.addEventListener('pointerleave', function () { hold('hover', false); });
        strip.addEventListener('focusin', function () { hold('hover', true); });
        strip.addEventListener('focusout', function () { hold('hover', false); });
        view.addEventListener('pointerdown', function () { hold('press', true); });
        window.addEventListener('pointerup', function () { hold('press', false); }, { passive: true });
        pauseListeners.push(function (paused) { hold('hidden', paused); });

        function settle() {
          measure();
          normalise();
          if (reduced()) restState(); else paint();
          sync();
        }

        window.addEventListener('resize', function () { setTimeout(settle, 120); }, { passive: true });

        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) hold('off', !entries[i].isIntersecting);
          }, { threshold: 0.15 });
          io.observe(strip);
        } else {
          held.off = false;
        }

        settle();

        instances.push({
          pin: function () {
            sync(); // shouldRun() sees reduced() === true now and stops the drift
            restState();
          },
          unpin: function () { settle(); } // re-measures and re-syncs against a live reduced()
        });
      })(strips[s]);
    }

    if (!instances.length) return { pin: noop, unpin: noop };

    return {
      pin: function () { for (var i = 0; i < instances.length; i++) instances[i].pin(); },
      unpin: function () { for (var i = 0; i < instances.length; i++) instances[i].unpin(); }
    };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 7. THE MAGNETIC BOOK CTA. Any [data-magnetic] element leans
     toward a nearby pointer, translate only, released back to rest on
     pointer leave. Gated to (hover:hover) and (pointer:fine): on a touch
     device or under reduced motion the listeners are never attached at all,
     which is stronger than checking every frame, since no work happens.
     Re-evaluated live on both a reduced-motion change and a fine-pointer
     change (a hybrid device switching from mouse to touch mid-session).
  ----------------------------------------------------------------------- */

  function initMagnetic() {
    var els = Array.prototype.slice.call(doc.querySelectorAll('[data-magnetic]'));
    if (!els.length) return { pin: noop, unpin: noop };

    var instances = [];

    for (var e = 0; e < els.length; e++) {
      (function (el) {
        el.style.transition = 'transform .1s linear';

        var target = { x: 0, y: 0 };
        var current = { x: 0, y: 0 };
        var rafId = null;
        var attached = false;
        var onScreen = false;

        function write() {
          el.style.transform = 'translate(' + current.x.toFixed(2) + 'px,' + current.y.toFixed(2) + 'px)';
        }

        function tick() {
          current.x += (target.x - current.x) * 0.22;
          current.y += (target.y - current.y) * 0.22;
          write();
          var settled = Math.abs(target.x - current.x) < 0.1 && Math.abs(target.y - current.y) < 0.1;
          if (!settled && onScreen && !tabPaused) {
            rafId = requestAnimationFrame(tick);
          } else {
            rafId = null;
            if (settled) { current.x = target.x; current.y = target.y; write(); }
          }
        }
        function schedule() {
          if (rafId !== null) return;
          if (!onScreen || tabPaused) return;
          rafId = requestAnimationFrame(tick);
        }

        function onMove(ev) {
          var rect = el.getBoundingClientRect();
          target.x = (ev.clientX - rect.left - rect.width / 2) * 0.18;
          target.y = (ev.clientY - rect.top - rect.height / 2) * 0.18;
          schedule();
        }
        function onLeave() {
          target.x = 0; target.y = 0;
          schedule();
        }

        function attach() {
          if (attached) return;
          attached = true;
          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerleave', onLeave);
        }
        function detach() {
          attached = false;
          el.removeEventListener('pointermove', onMove);
          el.removeEventListener('pointerleave', onLeave);
          target.x = 0; target.y = 0; current.x = 0; current.y = 0;
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
          el.style.transform = 'translate(0px,0px)';
        }

        function maybeAttach() {
          if (!reduced() && finePointerMQ.matches) attach(); else detach();
        }

        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) onScreen = entries[i].isIntersecting;
            if (onScreen) schedule();
          }, { threshold: 0 });
          io.observe(el);
        } else {
          onScreen = true;
        }

        pauseListeners.push(function (paused) { if (!paused) schedule(); });
        finePointerMQ.addEventListener('change', maybeAttach);

        maybeAttach();

        instances.push({ pin: detach, unpin: maybeAttach });
      })(els[e]);
    }

    return {
      pin: function () { for (var i = 0; i < instances.length; i++) instances[i].pin(); },
      unpin: function () { for (var i = 0; i < instances.length; i++) instances[i].unpin(); }
    };
  }

  /* -----------------------------------------------------------------------
     BONUS, not one of the nine but cheap and safe: a measured accordion on
     the FAQ's native <details>/<summary> pairs, so the answer eases open
     instead of snapping. Reduced motion is checked fresh inside the click
     handler itself (not cached anywhere), and simply lets the native
     instant open/close happen, which is already the correct reduced-motion
     behaviour for a state change, not a degraded one. No rAF loop, so no
     pin/unpin bookkeeping is needed.
  ----------------------------------------------------------------------- */

  function initFaqAccordion() {
    var items = Array.prototype.slice.call(doc.querySelectorAll('.faq-item'));
    if (!items.length) return;

    for (var i = 0; i < items.length; i++) {
      (function (details) {
        var content = details.querySelector('.faq-item__a');
        if (!content) return;

        details.addEventListener('click', function (e) {
          if (reduced()) return; // native instant toggle, no JS animation
          var opening = !details.open;
          e.preventDefault();
          if (opening) {
            details.open = true;
            var h = content.scrollHeight;
            content.style.height = '0px';
            content.style.opacity = '0';
            requestAnimationFrame(function () {
              content.style.height = h + 'px';
              content.style.opacity = '1';
            });
          } else {
            content.style.height = content.scrollHeight + 'px';
            content.style.opacity = '1';
            requestAnimationFrame(function () {
              content.style.height = '0px';
              content.style.opacity = '0';
            });
            content.addEventListener('transitionend', function onEnd() {
              details.open = false;
              content.style.height = '';
              content.removeEventListener('transitionend', onEnd);
            }, { once: true });
          }
        });
      })(items[i]);
    }
  }

  /* -----------------------------------------------------------------------
     Supporting the spine drive: a subtle fill tracking page progress,
     throttled to about 10Hz, written only when the value actually changed.
     Carried over unchanged from v2.
  ----------------------------------------------------------------------- */

  function initProgress() {
    var target = doc.querySelector('.spine__rule') || doc.getElementById('spine') || doc.querySelector('.spine');
    if (!target) return { pin: noop, unpin: noop };

    var lastValue = -1;
    var lastWriteAt = 0;
    var enabled = true;

    function computeProgress() {
      var root = doc.documentElement;
      var scrollable = (root.scrollHeight || body.scrollHeight) - window.innerHeight;
      if (scrollable <= 0) return 0;
      var y = window.scrollY || root.scrollTop || 0;
      return clamp(y / scrollable, 0, 1);
    }

    function write(value) {
      var rounded = Math.round(value * 200) / 200; // about half a percent steps
      if (rounded === lastValue) return; // delta gate
      lastValue = rounded;
      target.style.setProperty('--spine-progress', rounded.toFixed(3));
    }

    function onScroll() {
      if (!enabled) return;
      var now = performance.now();
      if (now - lastWriteAt < 95) return; // about 10Hz
      lastWriteAt = now;
      write(computeProgress());
    }

    function onResize() {
      if (!enabled) return;
      write(computeProgress());
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    function pin() {
      enabled = false;
      write(1);
    }
    function unpin() {
      enabled = true;
      write(computeProgress());
    }

    if (reduced()) pin(); else write(computeProgress());

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 8. THE HOLD INTERACTION. #heatStone builds --heat 0 to 1 over
     about 1.4s while held (pointer or space/enter). Releasing early eases
     back down, never snaps to zero. Completing flips #heatReveal
     [data-state] to done. A rAF loop that rests when converged, off-screen,
     or tab-paused. One of the site's three big moments, carried over
     unchanged from v2.
  ----------------------------------------------------------------------- */

  function initHeat() {
    var stone = doc.getElementById('heatStone');
    if (!stone) return { pin: noop, unpin: noop };

    var revealEl = doc.getElementById('heatReveal');
    var hint = doc.getElementById('heatStoneHint');
    var originalHintText = hint ? hint.textContent : '';

    var HOLD_MS = 1400;
    var EASE_K = 0.14;

    var heatValue = 0;
    var lastWritten = -1;
    var holding = false;
    var state = 'idle'; // idle | warming | done
    var pinnedByReducedMotion = false;
    var rafId = null;
    var lastTick = 0;
    var onScreen = false;
    var ownsLabel = false;

    if (revealEl && !revealEl.hasAttribute('aria-live')) {
      revealEl.setAttribute('aria-live', 'polite');
    }

    if (stone && !stone.hasAttribute('aria-label') && !stone.hasAttribute('aria-labelledby') && !stone.textContent.trim()) {
      ownsLabel = true;
      stone.setAttribute('aria-label', 'Press and hold to warm the stone');
    }

    function updateAccessibleLabel() {
      if (!ownsLabel) return;
      if (state === 'done') {
        stone.setAttribute('aria-label', reduced()
          ? 'Stone already warmed. Pricing revealed below.'
          : 'Stone warmed. Pricing revealed below.');
      } else {
        stone.setAttribute('aria-label', 'Press and hold to warm the stone');
      }
    }

    function updateHint() {
      if (!hint) return;
      if (reduced()) {
        hint.setAttribute('aria-live', hint.getAttribute('aria-live') || 'polite');
        hint.textContent = 'Already warm. No hold needed.';
      } else {
        hint.textContent = originalHintText || 'Press and hold';
      }
    }

    function setState(next) {
      if (state === next) return; // delta gate
      state = next;
      if (revealEl) revealEl.setAttribute('data-state', next);
      if (next === 'done' && hint && !pinnedByReducedMotion) {
        hint.setAttribute('aria-live', hint.getAttribute('aria-live') || 'polite');
        hint.textContent = 'Warmth complete. Pricing revealed below.';
      }
      updateAccessibleLabel();
    }

    function writeHeat(v) {
      if (lastWritten !== -1 && Math.abs(v - lastWritten) < 0.002) return; // delta gate
      lastWritten = v;
      stone.style.setProperty('--heat', v.toFixed(4));
    }

    function ensureLoop() {
      if (rafId !== null) return;
      if (!onScreen || tabPaused) return;
      if (state === 'done' && !holding) return; // nothing left to animate
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }

    function tick(now) {
      var dt = Math.min(100, now - (lastTick || now));
      lastTick = now;

      if (!onScreen || tabPaused) {
        rafId = null; // rest off-screen or while the tab is hidden
        return;
      }

      if (state !== 'done') {
        if (holding) {
          heatValue = Math.min(1, heatValue + dt / HOLD_MS);
          if (state === 'idle' && heatValue > 0) setState('warming');
          if (heatValue >= 1) {
            heatValue = 1;
            setState('done');
          }
        } else {
          var decay = 1 - Math.pow(1 - EASE_K, dt / 16.667);
          heatValue -= heatValue * decay;
          if (heatValue < 0.0015) heatValue = 0;
          if (heatValue === 0 && state === 'warming') setState('idle');
        }
      }

      writeHeat(heatValue);

      var stillAnimating = state !== 'done' && (holding ? heatValue < 1 : heatValue > 0);
      if (stillAnimating) rafId = requestAnimationFrame(tick);
      else rafId = null; // converged: rest
    }

    function beginHold() {
      if (reduced() || state === 'done') return;
      holding = true;
      ensureLoop();
    }

    function endHold() {
      holding = false;
      ensureLoop();
    }

    stone.addEventListener('pointerdown', function (e) {
      if (typeof e.button === 'number' && e.button !== 0) return;
      beginHold();
    });
    stone.addEventListener('pointerup', endHold);
    stone.addEventListener('pointerleave', endHold);
    stone.addEventListener('pointercancel', endHold);

    stone.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') {
        e.preventDefault();
        beginHold();
      }
    });
    stone.addEventListener('keyup', function (e) {
      if (e.key === ' ' || e.key === 'Spacebar' || e.key === 'Enter') endHold();
    });
    stone.addEventListener('blur', endHold);

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          onScreen = entries[i].isIntersecting;
          if (onScreen) ensureLoop();
        }
      }, { threshold: 0 });
      io.observe(stone);
    } else {
      onScreen = true; // no way to detect visibility: assume visible
    }

    pauseListeners.push(function () { ensureLoop(); });

    function applyDone() {
      holding = false;
      heatValue = 1;
      setState('done');
      writeHeat(1);
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function applyIdle() {
      holding = false;
      heatValue = 0;
      setState('idle');
      writeHeat(0);
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    function pin() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (state !== 'done') {
        pinnedByReducedMotion = true;
        applyDone();
      }
      updateHint();
      stone.setAttribute('aria-disabled', 'true');
    }

    function unpin() {
      stone.removeAttribute('aria-disabled');
      updateHint();
      if (pinnedByReducedMotion) {
        pinnedByReducedMotion = false;
        applyIdle();
      }
      updateAccessibleLabel();
    }

    if (reduced()) pin(); else { updateHint(); updateAccessibleLabel(); }

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     AMBIENT STEAM PARTICLES, hot stone section only, whisper level.
     Canvas-based. Pauses off-screen and when body.paused. Never runs under
     reduced motion. Low particle cap on phones. Carried over from v2, with
     one change for direction v3: the particle colour is read from the host
     section's own computed text colour at runtime instead of a hardcoded
     dark-ground token, so it stays legible regardless of which warm band
     the stone ends up living on.
  ----------------------------------------------------------------------- */

  function initSteam() {
    var stone = doc.getElementById('heatStone');
    var host = stone ? stone.closest('section') : null;
    if (!host) return { pin: noop, unpin: noop };

    if (getComputedStyle(host).position === 'static') {
      host.style.position = 'relative'; // one-time static setup, not a per-frame write
    }

    var canvas = doc.createElement('canvas');
    canvas.className = 'steam-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    host.insertBefore(canvas, host.firstChild);

    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return { pin: noop, unpin: noop };

    var rgb = readAmbientColor(host, '#F7F1E8');
    var particles = [];
    var width = 0, height = 0, dpr = 1;
    var rafId = null;
    var lastTick = 0;
    var onScreen = false;
    var active = false;

    function particleCap() { return phoneMQ.matches ? 6 : 16; }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(p) {
      p.x = Math.random() * width;
      p.y = height + Math.random() * 60;
      p.r = 8 + Math.random() * 16;
      p.vy = 8 + Math.random() * 10; // px per second, upward
      p.sway = 8 + Math.random() * 14;
      p.phase = Math.random() * Math.PI * 2;
      p.freq = 0.4 + Math.random() * 0.3;
      p.alpha = 0.04 + Math.random() * 0.05; // whisper level
      p.age = 0;
      p.life = 7 + Math.random() * 5;
      p.baseX = p.x;
    }

    function ensureParticles() {
      var cap = particleCap();
      if (particles.length > cap) particles.length = cap;
      while (particles.length < cap) {
        var p = {};
        spawn(p);
        p.age = Math.random() * p.life; // stagger initial phases
        particles.push(p);
      }
    }

    function tick(now) {
      var dt = Math.min(0.1, (now - (lastTick || now)) / 1000);
      lastTick = now;

      if (!active || !onScreen || tabPaused || reduced()) {
        rafId = null;
        return;
      }

      ctx.clearRect(0, 0, width, height);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.age += dt;
        if (p.age >= p.life || p.y < -40) { spawn(p); continue; }
        p.y -= p.vy * dt;
        var t = clamp(p.age / p.life, 0, 1);
        var fade = Math.sin(Math.PI * t);
        var x = p.baseX + Math.sin(p.age * p.freq + p.phase) * p.sway;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (p.alpha * fade).toFixed(3) + ')';
        ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (reduced()) return;
      active = true;
      if (rafId !== null) return;
      resize();
      ensureParticles();
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      active = false;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (width && height) ctx.clearRect(0, 0, width, height);
    }

    function maybeStart() {
      if (onScreen && !tabPaused && !reduced()) start();
      else stop();
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) onScreen = entries[i].isIntersecting;
        maybeStart();
      }, { threshold: 0 });
      io.observe(host);
    } else {
      onScreen = false; // cannot detect visibility safely: skip the ambient effect
    }

    window.addEventListener('resize', function () { if (active) resize(); }, { passive: true });
    pauseListeners.push(function () { maybeStart(); });

    function pin() { stop(); }
    function unpin() { maybeStart(); }

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     BOOT AND REDUCED-MOTION GOVERNANCE, LIVE AND IN BOTH DIRECTIONS.
  ----------------------------------------------------------------------- */

  function boot() {
    initVisibility();

    var spine = initSpine();
    initNav();
    var reveal = initReveal();
    var wordSplit = initWordSplit();
    var parallax = initParallax();
    var carousels = initCarousels();
    var magnetic = initMagnetic();
    var progress = initProgress();
    var heat = initHeat();
    var steam = initSteam();
    initFaqAccordion();

    var pinnable = [spine, reveal, wordSplit, parallax, carousels, magnetic, progress, heat, steam];

    function pinToFinalStates() {
      for (var i = 0; i < pinnable.length; i++) pinnable[i].pin();
      if (window.filmEngine && typeof window.filmEngine.pinToFinalStates === 'function') {
        window.filmEngine.pinToFinalStates();
      }
    }

    function unpinFinalStates() {
      for (var i = 0; i < pinnable.length; i++) pinnable[i].unpin();
      if (window.filmEngine && typeof window.filmEngine.unpinFinalStates === 'function') {
        window.filmEngine.unpinFinalStates();
      }
    }

    reduceMotionMQ.addEventListener('change', function (e) {
      if (e.matches) pinToFinalStates();
      else unpinFinalStates();
    });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

/*
  Mechanism map, one per section, no two neighbours sharing one. Hero (Agent
  F's territory) sits outside this list:

    About (tan)          -> mechanism 3, per-child staggered entrance
                             (.intro__frame with data-reveal data-stagger)
    Practitioners (cream)-> mechanism 5, clip-path photo unwrap, big moment
                             two (.practitioners__grid data-reveal
                             data-stagger, each .practitioner-card gets .in
                             in turn; Agent S keys the clip-path off that)
    Treatments (espresso) -> mechanism 3's accent-bar variant on each
                             .treatment-row, plus mechanism 8, the
                             press-and-hold heat stone, big moment three
    Fees (cream)          -> mechanism 3's scale-and-fade variant, per panel
    Visit (tan)           -> mechanism 4, scroll-linked parallax on the
                             section's own photo layer (data-parallax)
    Reviews (espresso)    -> mechanism 6, the self-driving depth-drift
                             carousel
    FAQ (cream)           -> mechanism 3, plain per-child staggered
                             entrance, plus the bonus measured accordion
    Book (espresso)       -> mechanism 3's scale-and-fade entrance on
                             .book__frame, plus mechanism 7, the magnetic
                             CTA on the primary button

  Mechanisms 1 (word-mask headings) and 2 (the section label rule draw) are
  connective tissue riding the reveal system across every section rather
  than one section's own identity, the same way the spine (mechanism 9) and
  the ambient steam are continuous systems rather than single-section
  moments. That is deliberate: the brief asks for nine distinct mechanisms
  with no two neighbours sharing one AND a shared, recognisable rhythm
  across the whole page. A different primary mechanism every section gives
  the first; the shared heading and label treatment gives the second.
*/
