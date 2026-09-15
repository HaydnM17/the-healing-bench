/*
  site.js
  Agent J, below-fold motion for The Healing Bench.

  Vanilla JS, no libraries, no build step. Owns: the spine drive, the hold
  interaction, per-child staggered reveal choreography, the word-mask heading
  reveal, the reviews depth-drift carousel, the magnetic book CTA, the FAQ
  accordion, nav (smooth scroll, current-section highlight, mobile toggle),
  tab visibility, live reduced-motion pinning, ambient steam particles and
  the spine scroll-progress fill.

  Nine mechanisms remain, numbered 1-10 with 4 retired (the scroll-linked
  parallax that used to write --p onto [data-parallax] -- the site owner
  found it choppy through two smoothing passes and asked for the images to
  just sit still, so [data-parallax] is now a static CSS-only crop and
  nothing here writes to it). The first eight mapped one per section so no
  two neighbours read the same way (see the bottom of this file for the
  map):
    1. word-mask heading reveal on every [data-split="words"] heading
    2. the section label rule drawing itself in, riding the reveal system
    3. per-child staggered entrances (the workhorse, most sections)
    5. the practitioner bubbles, drifting on their own and opening with an
       iris reveal that rides the reveal system
    6. the reviews depth-drift carousel, self-driving, draggable
    7. the magnetic book CTA
    8. the press-and-hold heat stone, carried over from v2 unchanged
    9. the spine nodes filling as sections pass, carried over from v2
   10. live hours in the Book panel, marking today and reading open or closed

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
  /* -----------------------------------------------------------------------
     WHERE A SECTION LANDS. Shared by the nav links (mechanism, initNav) and
     the jump arrows (mechanism 13), so the two can never disagree about
     where a press puts you.

     Measured from the section's HEADING, not from its box. scroll-margin-top
     does put a section's top edge a comfortable distance under the fixed
     header, but .section then adds up to 132px of its own padding before the
     heading appears, so the heading was arriving about 200px down the screen
     with a band of empty colour above it. Measuring from the heading makes
     the landing identical for every section regardless of how much padding
     that band happens to carry at the current viewport height.
  ----------------------------------------------------------------------- */

  var LAND_GAP = 26; // px of air between the header's underside and the heading

  function headerHeight() {
    var h = doc.querySelector('.site-header');
    return h ? h.getBoundingClientRect().height : 78;
  }

  // .slabel is display:none in six of the eight sections, and a display:none
  // element reports a zero rect, which would send every one of those to the
  // top of the page. Take the first candidate that actually has a box.
  function landingAnchor(target) {
    var candidates = target.querySelectorAll('.slabel, .shead, h2');
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].getBoundingClientRect().height > 0) return candidates[i];
    }
    return null;
  }

  // The absolute scroll-Y that lands this section. The hero has no heading,
  // so it correctly resolves to the top of the page.
  function landingY(target) {
    var anchor = landingAnchor(target);
    var y;
    if (anchor) {
      y = anchor.getBoundingClientRect().top + (window.scrollY || 0) - headerHeight() - LAND_GAP;
    } else {
      y = target.getBoundingClientRect().top + (window.scrollY || 0);
    }
    return Math.max(0, y);
  }

  function scrollToY(y) {
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: y, behavior: reduced() ? 'auto' : 'smooth' });
        return;
      } catch (err) { /* older browsers reject the options object */ }
    }
    window.scrollTo(0, y);
  }

  function scrollToSection(target) {
    scrollToY(landingY(target));
  }


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

    // SECTION_IDS above is the SPINE's list only: the eight content sections
    // that have a .spine__node[data-for] to fill. The hero has no such node
    // and must never get one, so it stays out of SECTION_IDS on purpose.
    // But the nav's Home link (href="#hero") still needs to light up while
    // the hero is on screen, so it is added to the current-link candidates
    // here, separately from the spine's own bookkeeping below. Scoped to
    // .nav specifically because the header's brand mark also links to
    // #hero and must never be marked current by accident.
    var homeLink = doc.querySelector('.nav a[href="#hero"]');
    if (homeLink && navLinks.indexOf(homeLink) === -1) navLinks.push(homeLink);

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
      // Nothing passed yet, or the visitor has scrolled back up above every
      // section: that is precisely "still in the hero", so Home is the
      // fallback rather than leaving the previous link lit or none at all.
      setCurrent(found || 'hero');
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
          scrollToSection(target);
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
      // threshold is a FRACTION OF THE TARGET'S OWN AREA, so it scales with
      // element height rather than with how far the visitor has scrolled: a
      // 0.12 threshold needs ~12% of the element inside the box before it
      // fires, which is a handful of px for a short .slabel but hundreds of
      // px of scrolling for something as tall as .treatments__group (it
      // holds a whole cascading list of treatment rows). Same rule, wildly
      // different real-world delay depending on what it's attached to --
      // that's why Treatments read as broken ("blank when I get there")
      // while short sections felt fine. threshold: 0 fires on the first
      // sliver of intersection, so trigger timing no longer depends on
      // element height at all.
      //
      // rootMargin used to be '0px 0px -8% 0px', shrinking the detection
      // box 8% up from the viewport's bottom edge and delaying entry
      // further on top of the threshold delay. Flipped to a small POSITIVE
      // bottom margin instead: the box now extends past the fold, so an
      // element starts its reveal shortly before it is scrolled into view
      // and is already animating (often nearly finished, given the base
      // .6s [data-reveal] transition) by the time it is actually on
      // screen, instead of only starting once the visitor is already
      // looking at it. 10% keeps that lead small on purpose -- big enough
      // to beat the "arrives still blank" problem, not big enough that a
      // short element (a lone .slabel or .about__copy) finishes its
      // entrance off-screen before it is ever seen.
      if (!io) io = new IntersectionObserver(onIntersect, { threshold: 0, rootMargin: '0px 0px 10% 0px' });
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

        function appendSet() {
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

        /* How many copies of the run the loop needs.

           wrap() keeps the scroll position inside the band [setWidth,
           setWidth * 2), and the element can only actually scroll as far as
           scrollWidth - clientWidth. So the track has to be at least
           setWidth * 2 + clientWidth wide or the band runs off the end: the
           browser clamps scrollLeft, pos and the real scroll position stop
           agreeing, and the loop dies. That is exactly what was happening
           here. Three reviews at 31% each come to 1129px, the viewport is
           1137px, and two spare sets left the track eight pixels short, so
           the third review was never reachable.

           Two spare sets is the old fixed guess. Here it keeps adding whole
           sets until there is genuinely enough track, which holds at any
           viewport width and for any number of reviews. The cap is there so
           a pathological case (a viewport far wider than the content) cannot
           clone forever. */
        appendSet();
        appendSet();

        var MAX_SETS = 8;
        var setCount = 3; // the originals plus the two above
        while (setCount < MAX_SETS) {
          var run = track.scrollWidth / setCount;
          if (track.scrollWidth >= view.clientWidth + run * 2.25) break;
          appendSet();
          setCount++;
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

        // paint() is called from the drift frame AND from the view's own
        // scroll event, and wrap() writes view.scrollLeft, which fires that
        // scroll event in turn. Without this guard every cell was being
        // measured and restyled twice for the same position, every frame,
        // for as long as the section was on screen: nine cells, two layout
        // reads and four style writes each, doubled.
        var lastPainted = null;

        function paint(force) {
          if (reduced()) return;
          var span = view.clientWidth;
          if (!span) return;
          var at = view.scrollLeft;
          if (force !== true && at === lastPainted) return;
          lastPainted = at;
          var mid = at + span / 2;
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

        /* Click a card to bring it to the middle. Without this the only way
           to reach a card you can see but is not centred was the arrows, and
           on a strip where every card is visible at once that reads as the
           cards being inert. A click that lands on a link inside the card is
           left alone. */
        track.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('a, button')) return;
          var cell = e.target.closest ? e.target.closest('.review-card') : null;
          if (!cell) return;
          goTo(cell);
        });
        view.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
          else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
        });

        // Scroll drives the paint, and also re-wraps the loop once the
        // scrolling settles. wrap() used to be reachable ONLY from the drift
        // frame, so the moment the drift was not running the strip stopped
        // being infinite and became a plain nine-card row with two hard
        // ends. That is what made the last review unreachable. Wrapping is
        // deferred to a short quiet period rather than done inline, because
        // writing scrollLeft in the middle of a live drag or a smooth
        // scrollTo fights whatever is doing the scrolling.
        var wrapTimer = null;
        view.addEventListener('scroll', function () {
          paint();
          if (wrapTimer) clearTimeout(wrapTimer);
          wrapTimer = setTimeout(function () {
            if (held.press || held.step) return;
            pos = null;
            wrap();
          }, 140);
        }, { passive: true });

        // No hover pause. A strip that stops the moment the pointer crosses
        // it reads as broken rather than considerate, and the arrows, the
        // arrow keys and a drag are all still there for anyone who wants to
        // take control. Keyboard focus still pauses it (below), which is
        // what actually matters: someone tabbing through the cards needs
        // them to hold still.
        strip.addEventListener('focusin', function () { hold('hover', true); });
        strip.addEventListener('focusout', function () { hold('hover', false); });

        // press is released by pointercancel as well as pointerup. Without
        // the cancel, one interrupted swipe (a system back-gesture, a
        // notification, a second finger) leaves press stuck true and the
        // drift never restarts for the rest of the session.
        view.addEventListener('pointerdown', function () { hold('press', true); });
        window.addEventListener('pointerup', function () { hold('press', false); }, { passive: true });
        window.addEventListener('pointercancel', function () { hold('press', false); }, { passive: true });
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

    var FAQ_MS = 350; // keeps step with .faq-item's CSS transition duration (.35s)

    for (var i = 0; i < items.length; i++) {
      (function (details) {
        var summary = details.querySelector('summary');
        var content = details.querySelector('.faq-item__a');
        if (!summary || !content) return;

        // styles.css only puts a `transition: height` on .faq-item (the
        // <details> element) as a default "in case JS toggles a class
        // rather than setting its own" (see its comment) — it does not
        // cover .faq-item__a, which is the element actually measured and
        // animated below. Without a transition declared on THIS element,
        // changing its height/opacity never starts a CSS transition, so
        // transitionend below never fires, details.open never gets reset
        // to false on close, and every click after the first close is
        // misread as "already open" — the answer can never be reopened.
        // Setting the transition here, inline, is what the CSS comment
        // was anticipating: JS sets its own instead of relying on the
        // fallback.
        content.style.transition = 'height ' + FAQ_MS + 'ms var(--ease-out), opacity ' + FAQ_MS + 'ms var(--ease-out)';

        // Bound to the <summary> only, not the whole <details>. A click
        // anywhere in an open answer bubbles up through <details> too, so
        // binding there re-triggered this handler on every text selection
        // or copy inside the answer and collapsed the accordion out from
        // under the reader. Scoping to <summary> means only a real summary
        // click (pointer, or Enter/Space activation, which the browser
        // fires as a click on the summary itself) ever reaches this
        // handler, while the measured height animation below is untouched.
        summary.addEventListener('click', function (e) {
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

            // details.open must get reset to false, and the inline height
            // cleared, no matter what — otherwise the next click still
            // sees details.open === true and this item is dead forever.
            // transitionend is the precise signal for "the close finished",
            // but it is backed by a timer fallback so a missed event
            // (interrupted animation, zero-height content, a future CSS
            // change that drops the transition again) can never leave the
            // item stuck. Whichever fires first wins; the other is inert.
            var finished = false;
            function finishClose() {
              if (finished) return;
              finished = true;
              details.open = false;
              content.style.height = '';
              content.style.opacity = '';
              content.removeEventListener('transitionend', onEnd);
              clearTimeout(fallback);
            }
            function onEnd(ev) {
              if (ev.target === content && ev.propertyName === 'height') finishClose();
            }
            content.addEventListener('transitionend', onEnd);
            var fallback = setTimeout(finishClose, FAQ_MS + 80);
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

    var initialLabel = stone.getAttribute('aria-label') || '';

    function updateAccessibleLabel() {
      if (state === 'done') {
        stone.setAttribute('aria-label', reduced()
          ? 'Stone already warmed.'
          : 'Stone warmed.');
      } else {
        stone.setAttribute('aria-label', initialLabel);
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
        hint.textContent = 'Warmth complete.';
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
     AMBIENT STEAM PARTICLES, hot stone section only.
     Canvas-based, spanning the section's full width and height so the
     bubbles read as background texture behind the whole section rather
     than a band pinned to the bottom edge. Population scales with section
     area rather than a flat count (a lower absolute ceiling on phones for
     GPU budget), and each particle's own life is matched to its own rise
     speed so a lap really does travel from the bottom of the section to
     the top instead of fading out a few dozen pixels up.

     Two scroll couplings, both sampled and eased once per rAF frame
     rather than driven off scroll events, so neither one can go choppy
     through a gap in event delivery the way a scroll-position map would:

     - Velocity coupling: every frame reads window.scrollY, turns the
       delta into an eased px/s estimate, and uses that (clamped) as a
       temporary multiplier on the particles' resting upward speed.
       Bubbles always drift upward on their own; scrolling speeds that up
       for as long as it continues, then the multiplier eases back to 1x.
       This is deliberately NOT a scroll-position map - it is a
       continuously-integrated velocity multiplier, so motion stays smooth
       even when scroll events arrive sparsely.

     - Density/wave coupling: each particle carries a threshold along the
       section's own scroll progress (0 at the section's top edge, 1 at
       its bottom edge) and fades in and out around that threshold, so the
       section reads empty near its top and the bubbles gather into full
       population by the time the visitor has scrolled into its body. The
       progress value itself is eased so the fill reads as one gathering
       wave rather than particles popping in, and it is fully reversible:
       scrolling back up drains the wave out the same way it filled in.

     Pauses off-screen and when body.paused (tabPaused), and is inert
     under reduced motion, same as before. The particle colour is still
     read from the host section's own computed text colour at runtime
     instead of a hardcoded dark-ground token, so it stays legible
     regardless of which warm band the stone ends up living on.
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

    // Scroll-velocity coupling state: sampled and eased once per rAF
    // frame, never driven directly off scroll events.
    var lastScrollY = 0;
    var scrollSpeed = 0; // eased px/s estimate of how fast the page is moving
    var STEAM_SCROLL_REFERENCE = 2200; // smoothed px/s that maps to +1x boost
    var STEAM_SCROLL_BOOST_MAX = 2.2; // clamp: a fast flick tops out at 3.2x resting speed
    var STEAM_SCROLL_ATTACK_TAU = 0.15; // seconds: how fast the estimate rises
    var STEAM_SCROLL_DECAY_TAU = 0.5; // seconds: how gently it settles back down

    // Density/wave coupling state: eased section-scroll progress, 0 at the
    // section's own top edge, 1 at its own bottom edge.
    var sectionProgress = 0;
    var STEAM_PROGRESS_TAU = 0.25; // seconds: eases the wave so a jump-scroll can't pop it
    var STEAM_REVEAL_BAND = 0.18; // width, in progress units, of each particle's fade-in
    var STEAM_THRESHOLD_MIN = 0.05;
    var STEAM_THRESHOLD_RANGE = 0.65; // thresholds spread across [0.05, 0.70] of the section

    // Population scales with section area rather than a flat count, so a
    // short wide desktop section and a tall narrow phone section both fill
    // without either looking sparse or turning into visual noise. Phones
    // also carry a lower absolute ceiling for GPU budget.
    var STEAM_AREA_PER_PARTICLE_DESKTOP = 26000;
    var STEAM_AREA_PER_PARTICLE_PHONE = 21000;
    var STEAM_CAP_MIN_DESKTOP = 36, STEAM_CAP_MAX_DESKTOP = 70;
    var STEAM_CAP_MIN_PHONE = 18, STEAM_CAP_MAX_PHONE = 36;

    function particleCap() {
      var area = Math.max(1, width * height);
      if (phoneMQ.matches) {
        return clamp(Math.round(area / STEAM_AREA_PER_PARTICLE_PHONE), STEAM_CAP_MIN_PHONE, STEAM_CAP_MAX_PHONE);
      }
      return clamp(Math.round(area / STEAM_AREA_PER_PARTICLE_DESKTOP), STEAM_CAP_MIN_DESKTOP, STEAM_CAP_MAX_DESKTOP);
    }

    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function computeSectionProgress() {
      var rect = host.getBoundingClientRect();
      var vh = window.innerHeight || doc.documentElement.clientHeight || 1;
      return clamp((vh * 0.5 - rect.top) / Math.max(1, rect.height), 0, 1);
    }

    function spawn(p, scatter) {
      scatter = scatter || 0; // 0 = fresh from the bottom, >0 = fast-forwarded up the section
      p.r = 8 + Math.random() * 16;
      p.vy = 8 + Math.random() * 10; // px per second, upward, resting pace
      p.sway = 8 + Math.random() * 14;
      p.phase = Math.random() * Math.PI * 2;
      p.freq = 0.4 + Math.random() * 0.3;
      p.alpha = 0.04 + Math.random() * 0.05; // whisper level
      p.threshold = STEAM_THRESHOLD_MIN + Math.random() * STEAM_THRESHOLD_RANGE;
      p.baseX = Math.random() * width;
      var startY = height + 20 + Math.random() * 60; // just below the fold
      p.life = Math.max(4, (startY + 40) / p.vy); // seconds to cross from spawn to just above the top
      p.age = scatter * p.life;
      p.y = startY - p.vy * p.age; // fast-forward position to match a staggered/scattered start
    }

    function ensureParticles() {
      var cap = particleCap();
      if (particles.length > cap) particles.length = cap;
      while (particles.length < cap) {
        var p = {};
        spawn(p, Math.random()); // scattered across the full height on first fill
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

      // Sample real scroll position once per animation frame (never off
      // the scroll event itself) so the boost keeps integrating smoothly
      // through any gap in event delivery.
      var scrollY = window.scrollY || doc.documentElement.scrollTop || 0;
      var speedSample = dt > 0 ? Math.abs(scrollY - lastScrollY) / dt : 0;
      lastScrollY = scrollY;
      var speedTau = speedSample > scrollSpeed ? STEAM_SCROLL_ATTACK_TAU : STEAM_SCROLL_DECAY_TAU;
      scrollSpeed += (speedSample - scrollSpeed) * (1 - Math.exp(-dt / speedTau));
      var velocityMultiplier = 1 + clamp(scrollSpeed / STEAM_SCROLL_REFERENCE, 0, STEAM_SCROLL_BOOST_MAX);

      var targetProgress = computeSectionProgress();
      sectionProgress += (targetProgress - sectionProgress) * (1 - Math.exp(-dt / STEAM_PROGRESS_TAU));

      ctx.clearRect(0, 0, width, height);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.age += dt;
        if (p.age >= p.life || p.y < -40) { spawn(p); continue; }
        p.y -= p.vy * velocityMultiplier * dt;
        var t = clamp(p.age / p.life, 0, 1);
        var lifeFade = Math.sin(Math.PI * t);
        var reveal = clamp((sectionProgress - p.threshold) / STEAM_REVEAL_BAND + 0.5, 0, 1);
        var alpha = p.alpha * lifeFade * reveal;
        if (alpha > 0.002) {
          var x = p.baseX + Math.sin(p.age * p.freq + p.phase) * p.sway;
          ctx.beginPath();
          ctx.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')';
          ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
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
      lastScrollY = window.scrollY || doc.documentElement.scrollTop || 0;
      scrollSpeed = 0;
      sectionProgress = computeSectionProgress();
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

    window.addEventListener('resize', function () {
      if (active) { resize(); ensureParticles(); }
    }, { passive: true });
    pauseListeners.push(function () { maybeStart(); });

    function pin() { stop(); }
    function unpin() { maybeStart(); }

    return { pin: pin, unpin: unpin };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 10. LIVE HOURS, in the Book panel.

     Marks today's row and writes an open/closed line above the schedule.
     Two things this is careful about:

     1. It reads the schedule off the DOM (data-open / data-close, minutes
        past midnight, data-closed for a dark day) rather than carrying its
        own copy. There is exactly one schedule on the page, so the status
        line can never contradict the hours printed directly beneath it.

     2. It works in the clinic's timezone, not the visitor's. Someone
        opening this from Vancouver at 5pm their time must be told the
        clinic is closed, because in Beamsville it is 8pm. Intl with an
        explicit timeZone is the only way to get that right; new Date()
        alone would answer for wherever the reader happens to be.

     Statutory holidays are not modelled, so this can be wrong on Christmas
     Day. The full week sits underneath it regardless, and the status pill
     stays hidden entirely if anything here fails.
  ----------------------------------------------------------------------- */

  var CLINIC_TZ = 'America/Toronto';

  function initHours() {
    var wrap = doc.querySelector('[data-hours]');
    var status = doc.querySelector('[data-hours-status]');
    if (!wrap) return;

    var rows = [].slice.call(wrap.querySelectorAll('.book__hours-row'));
    if (!rows.length) return;

    var statusText = status ? status.querySelector('.book__status-text') : null;

    // Day index -> its row, so the wrap-around search for the next open
    // day below is a lookup rather than a scan.
    var byDay = {};
    for (var i = 0; i < rows.length; i++) {
      var d = parseInt(rows[i].getAttribute('data-day'), 10);
      if (!isNaN(d)) byDay[d] = rows[i];
    }

    // Reads the wall clock in Beamsville. Returns null if Intl cannot do
    // timezones here, which is the signal to leave the pill hidden rather
    // than fall back to the visitor's own clock and state something false.
    function clinicNow() {
      try {
        var parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: CLINIC_TZ,
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).formatToParts(new Date());

        var got = {};
        for (var i = 0; i < parts.length; i++) got[parts[i].type] = parts[i].value;

        var days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        var day = days[got.weekday];
        var hour = parseInt(got.hour, 10);
        var minute = parseInt(got.minute, 10);

        // hour12:false yields 24 rather than 00 for midnight in some
        // engines, which would put "24:10" ten minutes into tomorrow.
        if (hour === 24) hour = 0;
        if (day === undefined || isNaN(hour) || isNaN(minute)) return null;

        return { day: day, minutes: hour * 60 + minute };
      } catch (e) {
        return null;
      }
    }

    function label(row) {
      var t = row.querySelector('.book__hours-time');
      return t ? t.textContent.trim() : '';
    }

    // "10:00 a.m. to 7:00 p.m." -> "7:00 p.m.". The times are only ever
    // written in that one shape, in this one block of markup.
    function closingTime(row) {
      var parts = label(row).split(' to ');
      return parts.length === 2 ? parts[1] : '';
    }

    function openingTime(row) {
      var parts = label(row).split(' to ');
      return parts.length === 2 ? parts[0] : '';
    }

    function dayName(row) {
      var d = row.querySelector('.book__hours-day');
      return d ? d.textContent.trim() : '';
    }

    // Walks forward from today to the next day that is actually open.
    function nextOpen(fromDay) {
      for (var step = 1; step <= 7; step++) {
        var row = byDay[(fromDay + step) % 7];
        if (row && !row.hasAttribute('data-closed')) {
          return { row: row, tomorrow: step === 1 };
        }
      }
      return null;
    }

    function update() {
      var now = clinicNow();
      if (!now) return;

      var today = byDay[now.day] || null;

      for (var i = 0; i < rows.length; i++) {
        rows[i].classList.toggle('is-today', rows[i] === today);
      }

      if (!status || !statusText) return;

      var open = null;
      var close = null;
      if (today && !today.hasAttribute('data-closed')) {
        open = parseInt(today.getAttribute('data-open'), 10);
        close = parseInt(today.getAttribute('data-close'), 10);
      }

      var isOpen = open !== null && !isNaN(open) && !isNaN(close) &&
                   now.minutes >= open && now.minutes < close;

      if (isOpen) {
        statusText.textContent = 'Open now, until ' + closingTime(today);
      } else if (open !== null && !isNaN(open) && now.minutes < open) {
        // Closed, but opening again later on the same day.
        statusText.textContent = 'Opens today at ' + openingTime(today);
      } else {
        var next = nextOpen(now.day);
        if (next) {
          statusText.textContent = 'Closed, opens ' +
            (next.tomorrow ? 'tomorrow' : dayName(next.row)) +
            ' at ' + openingTime(next.row);
        } else {
          statusText.textContent = 'Closed';
        }
      }

      status.classList.toggle('is-open', isOpen);
      status.hidden = false;
    }

    update();

    // Once a minute is enough to catch the opening and closing boundaries
    // while someone has the page open, and it rests with the tab. The
    // interval is never torn down because the page has no teardown; it is
    // one timer for the life of the document.
    var timer = null;

    function start() {
      if (timer === null) timer = window.setInterval(update, 60000);
    }

    function stop() {
      if (timer !== null) { window.clearInterval(timer); timer = null; }
    }

    pauseListeners.push(function (paused) {
      if (paused) stop();
      else { update(); start(); }
    });

    if (!tabPaused) start();
  }

  /* -----------------------------------------------------------------------
     MECHANISM 12. THE PARAGRAPH SPOTLIGHT, on [data-spotlight] children.

     As the reader arrives at each paragraph it comes forward and the others
     sit back. Driven by an IntersectionObserver with a narrow band across
     the middle of the viewport rather than by a scroll handler, so it costs
     nothing per frame: the band is a rootMargin that discards the top and
     bottom of the screen, leaving a strip about a fifth of the way up from
     centre.

     Exactly one paragraph is ever lit: the one nearest the band's own
     centre line, among whichever are currently intersecting it. This used
     to light every paragraph that was independently intersecting the band,
     which is unstable right at a band edge — a paragraph straddling that
     line toggles in and out with every few pixels of scroll, and lit vs
     unlit differ by up to a 46px translate (see styles.css), so each
     toggle was a visible jump. Picking a single winner removes the
     instability by construction: a boundary crossing now swaps which
     paragraph is lit rather than flickering one on and off. styles.css's
     own comments already assumed this ("site.js lights one paragraph at a
     time") even though the old implementation did not actually guarantee
     it.

     The IntersectionObserver callback only fires on a threshold crossing
     (an element entering or leaving the band), never per scroll frame, so
     it is cheap to call getBoundingClientRect() inside it for the couple
     of elements currently in the band — far cheaper than a scroll handler
     measuring every paragraph, and it keeps the centre-distance figure
     fresh rather than reusing a rect cached from whenever that element
     last crossed the boundary (which can be stale by however long it has
     been comfortably centred since).

     Only ever adds and removes one class. The movement itself is CSS, and
     is transform and opacity only, so nothing here can cause a layout.

     No IntersectionObserver, or reduced motion: every child is lit and
     stays lit, which is the correct resting state, not a degraded one.
  ----------------------------------------------------------------------- */

  function initSpotlight() {
    var groups = Array.prototype.slice.call(doc.querySelectorAll('[data-spotlight]'));
    if (!groups.length) return { pin: noop, unpin: noop };

    var all = [];
    for (var g = 0; g < groups.length; g++) {
      all = all.concat(Array.prototype.slice.call(groups[g].children));
    }
    if (!all.length) return { pin: noop, unpin: noop };

    function litAll(on) {
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-lit', on);
    }

    if (!('IntersectionObserver' in window) || reduced()) {
      litAll(true);
      return { pin: function () { litAll(true); }, unpin: function () { litAll(true); } };
    }

    // Parallel to `all`: whether each element is currently intersecting
    // the band, per the observer's own bookkeeping. currentIndex is which
    // one (if any) currently carries .is-lit.
    var intersecting = [];
    var currentIndex = -1;

    // The band's own centre line, not the viewport's: rootMargin below
    // insets 38% off the top and 42% off the bottom, so the band itself
    // sits slightly above true viewport centre (0.48 of the way down, not
    // 0.50). Kept as one named fraction so it can only drift from the
    // rootMargin string below by an explicit edit to both.
    var BAND_CENTER_FRAC = 0.48; // (38% + (100% - 42%)) / 2

    function chooseWinner() {
      var bandCenter = window.innerHeight * BAND_CENTER_FRAC;
      var winner = -1;
      var winnerDist = Infinity;
      for (var k = 0; k < all.length; k++) {
        if (!intersecting[k]) continue;
        var rect = all[k].getBoundingClientRect();
        var dist = Math.abs((rect.top + rect.height / 2) - bandCenter);
        if (dist < winnerDist) { winnerDist = dist; winner = k; }
      }
      return winner;
    }

    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var idx = all.indexOf(entries[i].target);
        if (idx !== -1) intersecting[idx] = entries[i].isIntersecting;
      }

      var winner = chooseWinner();
      if (winner === currentIndex) return; // delta gate: no visible change
      if (currentIndex !== -1) all[currentIndex].classList.remove('is-lit');
      if (winner !== -1) all[winner].classList.add('is-lit');
      currentIndex = winner;
    }, {
      // Keep only a band across the middle third, biased slightly above
      // centre, which is where the eye actually sits while reading.
      rootMargin: '-38% 0px -42% 0px',
      threshold: 0
    });

    for (var j = 0; j < all.length; j++) io.observe(all[j]);

    return {
      // Reduced motion pins every paragraph lit and stops the observer
      // deciding anything; unpin hands the decision back.
      pin: function () {
        for (var k = 0; k < all.length; k++) io.unobserve(all[k]);
        intersecting = [];
        currentIndex = -1;
        litAll(true);
      },
      unpin: function () {
        litAll(false);
        intersecting = [];
        currentIndex = -1;
        for (var m = 0; m < all.length; m++) io.observe(all[m]);
      }
    };
  }

  /* -----------------------------------------------------------------------
     MECHANISM 11. THE MEASURED HEADER HEIGHT.

     --header-h is what every section's scroll-margin-top is built from, so
     it decides where an anchor jump lands. It was two hardcoded guesses in
     styles.css, 78px and 84px at 880, and a guess goes stale the moment
     anything in the header changes size: a longer nav, different link
     padding, a larger type scale, or a visitor's own larger root font. When
     it is short, every nav link lands its heading tucked up under the fixed
     bar.

     So it is measured instead. The CSS values stay as the pre-JS fallback
     and are still correct for a visitor with scripting off; this simply
     replaces them with the truth once the header has actually been laid
     out. Re-measured on resize, and after fonts load, since a font swap
     changes the header's height by a pixel or two.
  ----------------------------------------------------------------------- */

  function initHeaderHeight() {
    var header = doc.querySelector('.site-header');
    if (!header) return;

    var last = -1;

    function measure() {
      var h = Math.round(header.getBoundingClientRect().height);
      if (h <= 0 || h === last) return;
      last = h;
      doc.documentElement.style.setProperty('--header-h', h + 'px');
    }

    measure();

    var t = null;
    window.addEventListener('resize', function () {
      if (t) clearTimeout(t);
      t = setTimeout(measure, 120);
    }, { passive: true });

    // The header's height moves when the display face swaps in for the
    // fallback, which lands after this first runs.
    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
      doc.fonts.ready.then(measure).catch(noop);
    }

    // The mobile nav panel opening changes the header's box on some
    // layouts, so re-measure once it settles rather than leaving a stale
    // value behind a closed menu.
    var toggle = doc.getElementById('navToggle');
    if (toggle) toggle.addEventListener('click', function () { setTimeout(measure, 260); });
  }

  /* -----------------------------------------------------------------------
     MECHANISM 13. THE SECTION JUMP ARROWS.

     One press a section, using landingY() above, so a press from an arrow
     and a press from a nav link put you in exactly the same place.

     Stops are measured on demand rather than cached: a cache goes stale
     behind every image that finishes loading, and this page lazy-loads
     nineteen of them.

     An arrow with nowhere left to go is hidden outright rather than dimmed.
     Never show a control that does nothing when pressed.

     The down arrow has one extra condition, which is the point of it here:
     it stays hidden until the hero film has finished playing its opening
     and come to rest. film-engine.js latches that and says so with a
     film:held event and a .film-held class on the stage. Offering a way
     past the hero while the hero is still making its one move would be the
     page arguing with itself. Every path that ends the hold signals it,
     including reduced motion, the static-hero gates, a first scroll, and a
     nine second timeout if the film never loads at all, so the arrow can
     never be stranded hidden.
  ----------------------------------------------------------------------- */

  function initJumpArrows() {
    var up = doc.getElementById('jump-up');
    var down = doc.getElementById('jump-down');
    if (!up || !down) return;

    var sections = Array.prototype.slice.call(doc.querySelectorAll('main > section'));
    if (!sections.length) return;

    var root = doc.scrollingElement || doc.documentElement;

    /* A landed section sits a pixel or so either side of its own stop, and a
       fractional device pixel ratio widens that. Anything inside this counts
       as already there, so the arrow offers the next stop along rather than
       nudging back onto the section already being read. */
    var EPS = 8;

    /* clientHeight, not innerHeight: the latter counts the scrollbar gutter,
       and the difference is enough that a stop clamped with it lands past
       the real foot of the page, leaving the down arrow lit over a press
       that cannot move anything. */
    function maxScroll() {
      return Math.max(0, root.scrollHeight - root.clientHeight);
    }

    function stops() {
      var out = [];
      var max = maxScroll();
      for (var i = 0; i < sections.length; i++) {
        out.push(Math.min(landingY(sections[i]), max));
      }
      return out;
    }

    // The nearest stop past y in the given direction, or null for none.
    function beyond(list, y, dir) {
      var found = null;
      for (var i = 0; i < list.length; i++) {
        if (dir > 0) {
          if (list[i] > y + EPS) { found = list[i]; break; }
        } else if (list[i] < y - EPS) {
          found = list[i];
        }
      }
      return found;
    }

    function step(dir) {
      var to = beyond(stops(), window.scrollY || 0, dir);
      if (to === null) return;
      scrollToY(to);
    }

    up.addEventListener('click', function () { step(-1); });
    down.addEventListener('click', function () { step(1); });

    function filmHeld() {
      if (doc.querySelector('.hero__stage.film-held')) return true;
      return !!(window.filmEngine && typeof window.filmEngine.isHeld === 'function' &&
                window.filmEngine.isHeld());
    }

    // Only written on the change: setting hidden to what it already is
    // still costs a style invalidation, and this runs on every scroll tick.
    function reveal(el, gone) { if (el.hidden !== gone) el.hidden = gone; }

    var rafId = null;

    function sync() {
      rafId = null;
      var list = stops();
      var y = window.scrollY || 0;
      var atBottom = y >= maxScroll() - EPS;

      reveal(up, beyond(list, y, -1) === null);
      reveal(down, !filmHeld() || atBottom || beyond(list, y, 1) === null);

      // The nudge is only an invitation while the reader has not moved yet.
      var inviting = !down.hidden && y < 40;
      if (down.classList.contains('is-inviting') !== inviting) {
        down.classList.toggle('is-inviting', inviting);
      }
    }

    function kick() { if (rafId === null) rafId = requestAnimationFrame(sync); }

    window.addEventListener('scroll', kick, { passive: true });
    window.addEventListener('resize', kick, { passive: true });
    window.addEventListener('load', kick);
    doc.addEventListener('film:held', kick);
    if (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === 'function') {
      doc.fonts.ready.then(kick).catch(noop);
    }
    reduceMotionMQ.addEventListener('change', kick);

    sync();
  }

  /* -----------------------------------------------------------------------
     BOOT AND REDUCED-MOTION GOVERNANCE, LIVE AND IN BOTH DIRECTIONS.
  ----------------------------------------------------------------------- */

  function boot() {
    initVisibility();
    initHeaderHeight();

    var spine = initSpine();
    initNav();
    var reveal = initReveal();
    var wordSplit = initWordSplit();
    var carousels = initCarousels();
    var magnetic = initMagnetic();
    var progress = initProgress();
    var heat = initHeat();
    var steam = initSteam();
    initFaqAccordion();
    initHours();
    var spotlight = initSpotlight();
    initJumpArrows();

    var pinnable = [spine, reveal, wordSplit, carousels, magnetic, progress, heat, steam, spotlight];

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
    Practitioners (cream)-> mechanism 5, the floating portrait bubbles, big
                             moment two (.practitioners__grid data-reveal
                             data-stagger, each .practitioner-card gets .in
                             in turn; the iris reveal keys off that, while
                             the float itself is a standing CSS animation
                             owing nothing to scroll position)
    Treatments (espresso) -> mechanism 3's accent-bar variant on each
                             .treatment-row, plus mechanism 8, the
                             press-and-hold heat stone, big moment three
    Fees (cream)          -> mechanism 3's scale-and-fade variant, per panel
    Visit (tan)           -> no distinct mechanism of its own any more.
                             The photo (data-parallax) used to carry
                             mechanism 4, scroll-linked parallax; that has
                             been retired and the image is now a static
                             CSS-only crop, so all that is left here is
                             mechanism 3's plain staggered entrance on
                             .visit__hours, shared with About/Fees/FAQ
    Reviews (espresso)    -> mechanism 6, the self-driving depth-drift
                             carousel
    FAQ (cream)           -> mechanism 3, plain per-child staggered
                             entrance, plus the bonus measured accordion
    Book (espresso)       -> mechanism 10, the live hours panel, plus
                             mechanism 7, the magnetic CTA on the primary
                             button

  Mechanisms 1 (word-mask headings) and 2 (the section label rule draw) are
  connective tissue riding the reveal system across every section rather
  than one section's own identity, the same way the spine (mechanism 9) and
  the ambient steam are continuous systems rather than single-section
  moments. That is deliberate: the brief asks for nine distinct mechanisms
  with no two neighbours sharing one AND a shared, recognisable rhythm
  across the whole page. A different primary mechanism every section gives
  the first; the shared heading and label treatment gives the second.
*/
