/*
  film-engine.js
  Agent F, the scroll-scrubbed hero engine for The Healing Bench, v2.

  Vanilla JS, no libraries, no build step. Drives one of two hero films
  (portrait or landscape, chosen by orientation) from scroll position
  through a pinned hero. Implements references/scrub-pipeline.md and
  binds to the DOM contract in BUILD-CONTRACT-V2.md.

  What changed from v1:
  - Two source films instead of one. The right one is chosen by a media
    query and only that one is ever fetched, so a desktop never over-zooms
    a portrait-shot clip and a phone never downloads a landscape one.
  - An idle drift plays the film forward slowly on its own before the
    visitor scrolls, through the same lerp and gated-seek path scroll
    itself drives, so the hero is alive on arrival. It stops for good on
    the first real scroll.
  - The five-band hero narration is gone. The hero is now a single
    composed crest plus caption block, owned by Agent M's markup and
    Agent S's CSS. This engine's only remaining DOM writes are the poster,
    the video, the loading ring, and one custom property, --heroOut, that
    Agent S reads to move the crest and caption out of the way as the
    visitor leaves the hero.
  - Only one rAF chain exists in this file: tick(). The v1 file had a
    second one (the band-one load ramp) that is no longer needed now that
    there is no band-one to assemble on its own.
*/
(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     Constants the integrator tunes after real measurements.
  --------------------------------------------------------------------- */

  // The two films. Exactly one is ever fetched, chosen by FILM_Q below.
  // Portrait: 720x1280, 21.041667s at 24fps, 505 frames, h264. Confirmed
  // by Agent A. Wide: landscape, encoded separately; the integrator
  // patches the byte size in once the encode reports it. The loader
  // tolerates 0 here by falling back to the response's Content-Length,
  // so leave it at 0 rather than guessing.
  // driftMax is how far into each film the idle auto-play is allowed to run
  // before it stops and waits for a scroll. The two films are different
  // lengths and paced differently, so a single shared fraction lands in the
  // wrong place on one of them. Both values were measured by extracting frames
  // and finding the last moment before the camera starts its descent:
  //   portrait 21.04s, descent begins about 5.0s  ->  0.23
  //   wide     11.25s, descent begins about 4.3s  ->  0.37
  // Everything before that point is the stones holding while steam builds and
  // the camera drifts gently, which is exactly what should auto-play.
  var VIDEO_PORTRAIT = { src:'assets/hero-scrub.mp4', bytes:1907459, driftMax:0.23 };
  var VIDEO_WIDE     = { src:'assets/hero-scrub-wide.mp4', bytes:1030986, driftMax:0.37 };

  // Matching posters, one per film, so the still image painted first
  // during the bandwidth race is already framed for the right aspect
  // ratio and never flashes a mismatched crop while the video streams in.
  // Not part of the mandated two-film constants above; an Agent F
  // addition that closes the same "wrong asset" gap for the still frame.
  var POSTER_PORTRAIT = 'assets/hero-poster.jpg';
  var POSTER_WIDE = 'assets/hero-wide-poster.jpg';

  // The footage is natively portrait, 720x1280, so a phone gets a no-crop
  // frame straight from the portrait file. True keeps the scrub on for
  // phones and the two portrait gates instead of falling back to the
  // static hero, now backed by a real portrait shoot rather than a phone
  // being asked to letterbox a landscape composition. The landscape phone
  // gate and reduced motion always fall back, regardless of this flag.
  var MOBILE_SCRUB = true;

  var LERP_K = 0.16;              // smoothing per 60fps frame, tune by feel
  var CONVERGE_EPS = 0.0005;      // lerp counts as settled below this distance
  var DELTA_GATE = 0.008;         // minimum change before any DOM write
  var WATCHDOG_MS = 20000;        // stream stall abort, re-armed on every chunk
  var POSTER_SAFETY_MS = 4000;    // start the blob fetch even if the poster hangs
  var RING_THROTTLE_MS = 100;     // ring redraw throttle
  // Idle auto-play speed, relative to real-time playback. At 0.12 the opening
  // took 13 real seconds to cross and read as a still frame. 0.75 plays it
  // clearly, covering the whole opening beat in five or six seconds.
  var DRIFT_RATE = 0.75;
  // The cap now lives on each film variant as driftMax, because the two films
  // are paced differently. See the VIDEO_PORTRAIT and VIDEO_WIDE definitions.
  function driftMax() {
    var v = currentVariant();
    return (v && typeof v.driftMax === 'number') ? v.driftMax : 0.23;
  }
  var HERO_OUT_VH = 0.66;         // --heroOut reaches 1 over this many viewport heights

  /* ---------------------------------------------------------------------
     Guard. If the hero video is not on this page, do nothing but still
     hand Agent J's site.js a safe, inert copy of the public API.
  --------------------------------------------------------------------- */

  var video = document.getElementById('heroVideo');

  if (!video) {
    window.filmEngine = {
      heroProgress: function () { return 0; },
      pinToFinalStates: function () {},
      unpinFinalStates: function () {},
      isScrubOn: function () { return false; }
    };
    return;
  }

  var stage = document.getElementById('heroStage');
  var posterEl = document.getElementById('heroPoster');
  var ring = document.getElementById('heroRing');
  var hero = document.getElementById('hero') ||
    (video.closest && video.closest('.hero')) ||
    stage || video;

  /* ---------------------------------------------------------------------
     Small helpers.
  --------------------------------------------------------------------- */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------------------------------------------------------------------
     heroProgress: 0 to 1 through the pinned hero's scroll range.
  --------------------------------------------------------------------- */

  function heroProgress() {
    var total = hero.offsetHeight - window.innerHeight;
    if (total <= 0) return 1;
    var rect = hero.getBoundingClientRect();
    return clamp(-rect.top / total, 0, 1);
  }

  /* ---------------------------------------------------------------------
     --heroOut: 0 to 1 over HERO_OUT_VH viewport heights of real scroll,
     independent of the video's own progress mapping. Agent S reads it on
     #heroStage to translate and fade #heroCrest and #heroCaption. Pure
     function of live scroll geometry, so it is fully reversible: scroll
     back up and the crest returns. Written delta-gated, every tick.
  --------------------------------------------------------------------- */

  var lastHeroOut = -1;

  function computeHeroOut() {
    var rect = hero.getBoundingClientRect();
    var scrolled = Math.max(0, -rect.top);
    var span = window.innerHeight * HERO_OUT_VH;
    if (span <= 0) return 1;
    return clamp(scrolled / span, 0, 1);
  }

  function writeHeroOut() {
    if (!stage) return;
    var out = computeHeroOut();
    if (Math.abs(out - lastHeroOut) >= DELTA_GATE) {
      stage.style.setProperty('--heroOut', String(out));
      lastHeroOut = out;
    }
  }

  function pinToFinalStates() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    lastTick = 0;
    if (stage) {
      stage.style.setProperty('--heroOut', '1');
      lastHeroOut = 1;
    }
  }

  function unpinFinalStates() {
    lastHeroOut = -1;
  }

  /* ---------------------------------------------------------------------
     IntersectionObserver: the rAF loop only runs while the hero is on
     screen.
  --------------------------------------------------------------------- */

  var heroOnScreen = false;
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      heroOnScreen = entries[0].isIntersecting;
      if (heroOnScreen && scrubOn && rafId === null) {
        target = heroProgress();
        rafId = requestAnimationFrame(tick);
      }
    }, { threshold: 0 });
    io.observe(hero);
  } else {
    heroOnScreen = true;
  }

  /* ---------------------------------------------------------------------
     The dt-normalized lerp, now also carrying the idle auto-pan drift.

     There is exactly one rAF chain in this file. Before the visitor has
     scrolled, tick() itself nudges `target` forward at DRIFT_RATE; once a
     real scroll happens, hasScrolled latches true forever and that nudge
     stops permanently, handing target over entirely to onScroll(). Either
     way the film's position is still only ever driven by the same lerp
     and the same gated requestSeek() below, never by video.play().

     Idle when converged and drift-ineligible; idle when the hero is off
     screen; never idle while drift is legitimately advancing.
  --------------------------------------------------------------------- */

  var target = 0;
  var shown = 0;
  var rafId = null;
  var lastTick = 0;
  var hasScrolled = false;

  function driftEligible() {
    // target < driftMax() matters: without it the loop keeps running forever at
    // the cap, burning frames to add nothing. With it, the drift finishes the
    // opening hold, converges, and the rAF chain goes idle until a real scroll.
    return !hasScrolled && target < driftMax() && heroOnScreen &&
      !prefersReducedMotion() && !!video.duration && isFinite(video.duration);
  }

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;

    var drifting = driftEligible();
    if (drifting) {
      target = clamp(target + (DRIFT_RATE * dt / 1000) / video.duration, 0, driftMax());
    }

    shown += (target - shown) * (1 - Math.pow(1 - LERP_K, dt / 16.667));
    var converged = Math.abs(target - shown) < CONVERGE_EPS;
    if (converged) shown = target;

    if (video.duration && isFinite(video.duration)) {
      requestSeek(shown * video.duration);
    }
    writeHeroOut();

    if (!converged || drifting) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      lastTick = 0;
    }
  }

  // The real scroll handler. Fires only from a genuine 'scroll' event, so
  // it is the one and only place hasScrolled ever flips true. It never
  // resets false again: the idle drift is a once-per-pageview courtesy.
  function onScroll() {
    hasScrolled = true;
    syncTarget();
  }

  // Re-seeks target to the live scroll position without touching
  // hasScrolled. Used by the real scroll handler above and by
  // enableScrub()'s own re-arm step, which must not be mistaken for a
  // visitor scroll or it would kill the auto-pan before it ever ran.
  function syncTarget() {
    // Scroll drives the film from driftMax() to 1, not from 0 to 1. The idle
    // drift owns the opening hold and has already played it, so mapping scroll
    // to 0 here would throw that away and snap the film backwards on the very
    // first wheel tick. Starting at driftMax() means scroll picks up exactly
    // where the drift stopped, at the moment the descent begins.
    var p = heroProgress();
    // enableScrub() calls this at load and on every gate flip. At the very top
    // with no scroll yet, leave target alone so the drift still owns the
    // opening hold: writing driftMax() here would jump straight to the end of
    // the hold and there would be nothing left to auto-play.
    if (!hasScrolled && p <= 0) {
      if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
      return;
    }
    var dm = driftMax();
    target = dm + p * (1 - dm);
    if (rafId === null && heroOnScreen) rafId = requestAnimationFrame(tick);
  }

  // Called once the current film can play. Starts the loop if idle and
  // drift still qualifies; a no-op otherwise, including when the loop is
  // already running, since tick() re-evaluates driftEligible() itself
  // every frame regardless of how it got started.
  function maybeStartDrift() {
    if (rafId !== null) return;
    if (!driftEligible()) return;
    lastTick = 0;
    rafId = requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------------------
     Gated seeks, the deadlock-safe pattern. Coalesce to the newest
     target, exactly one follow-up on seeked, reset on error.

     Two belts against the gate sticking open forever: some browsers do
     not fire seeked when the assigned value is not actually different
     from currentTime (the common case is the very first seek on a fresh
     pageview, requestSeek(0) against a freshly loaded video that already
     reports currentTime 0). First, skip the assignment entirely when the
     target is already within a tenth of a frame at 24fps. Second, a
     short recovery timer force-clears the gate if neither seeked nor
     error shows up at all, so the gate can never be opened only by an
     event that might not arrive.
  --------------------------------------------------------------------- */

  var seekBusy = false;
  var pendingTime = null;
  var seekTimeoutId = null;
  var SEEK_EPS = 0.004;
  var SEEK_RECOVERY_MS = 400;

  function clearSeekTimeout() {
    if (seekTimeoutId !== null) {
      clearTimeout(seekTimeoutId);
      seekTimeoutId = null;
    }
  }

  function seekRecover() {
    seekTimeoutId = null;
    seekBusy = false;
    if (pendingTime !== null) {
      var t = pendingTime;
      pendingTime = null;
      requestSeek(t);
    }
  }

  function requestSeek(t) {
    if (!video.duration || !isFinite(video.duration)) return;
    if (seekBusy) { pendingTime = t; return; }
    if (Math.abs(video.currentTime - t) < SEEK_EPS) {
      // Already there. No seeked event is coming, so do not open the
      // gate for one, but still drain anything that was queued.
      if (pendingTime !== null) {
        var next = pendingTime;
        pendingTime = null;
        requestSeek(next);
      }
      return;
    }
    seekBusy = true;
    seekTimeoutId = setTimeout(seekRecover, SEEK_RECOVERY_MS);
    try {
      video.currentTime = t;
    } catch (e) {
      clearSeekTimeout();
      seekBusy = false;
    }
  }

  video.addEventListener('seeked', function () {
    clearSeekTimeout();
    seekBusy = false;
    if (pendingTime !== null) {
      var t = pendingTime;
      pendingTime = null;
      requestSeek(t);
    }
  });

  var videoFailed = false;
  video.addEventListener('error', function () {
    clearSeekTimeout();
    seekBusy = false;
    pendingTime = null;
    failVideo();
  });

  /* ---------------------------------------------------------------------
     Complete without the video.
  --------------------------------------------------------------------- */

  function makeScrollChevron() {
    var el = document.createElement('div');
    el.className = 'hero__chevron';
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.bottom = '8%';
    el.style.width = '30px';
    el.style.height = '30px';
    el.style.transform = 'translateX(-50%)';
    el.style.opacity = '0.85';
    el.style.pointerEvents = 'none';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" ' +
      'stroke="var(--bone, #E7DFD8)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M6 9l6 6 6-6"/></svg>';
    if (!prefersReducedMotion() && el.animate) {
      try {
        el.animate(
          [
            { transform: 'translateX(-50%) translateY(0px)' },
            { transform: 'translateX(-50%) translateY(8px)' },
            { transform: 'translateX(-50%) translateY(0px)' }
          ],
          { duration: 1600, iterations: Infinity, easing: 'ease-in-out' }
        );
      } catch (e) { /* animate unsupported, chevron just stays still */ }
    }
    return el;
  }

  function failVideo() {
    if (videoFailed) return;
    videoFailed = true;
    if (ring && ring.parentNode) {
      ring.parentNode.replaceChild(makeScrollChevron(), ring);
    }
    video.style.display = 'none';
    if (stage) stage.classList.add('video-failed');
  }

  /* ---------------------------------------------------------------------
     Which film. Chosen live, re-evaluated on the query's own change
     event so rotating a tablet swaps to the right film instead of
     keeping a badly cropped one. Deliberately its own matchMedia call,
     not indexed off the five static-hero gates below, even though gate
     1 happens to share this exact string: this is an asset choice, not a
     scrub on/off decision, and the two must stay free to diverge.
  --------------------------------------------------------------------- */

  var FILM_Q = window.matchMedia('(orientation: portrait) and (max-width: 1024px)');

  function currentVariant() {
    return FILM_Q.matches ? VIDEO_PORTRAIT : VIDEO_WIDE;
  }

  function posterUrlFor(variant) {
    return variant === VIDEO_PORTRAIT ? POSTER_PORTRAIT : POSTER_WIDE;
  }

  /* ---------------------------------------------------------------------
     The streamed Blob loader with the loading ring, now swappable: a
     load generation counter and an AbortController guard against a
     superseded fetch's chunks, or a stale canplay, landing after a newer
     swap has already started. Only ever one film is in flight at a time.
  --------------------------------------------------------------------- */

  var heroInitialized = false;
  var firstFetchStarted = false;
  var loadedVariant = null;
  var loadGen = 0;
  var currentCtrl = null;
  var blobUrl = null;

  // The blob URL for whichever film is currently loaded is only revoked
  // on teardown or the moment a swap actually replaces it, never left
  // dangling mid-session.
  window.addEventListener('pagehide', function () {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
  });

  function initHeroOnce() {
    if (heroInitialized) return;
    heroInitialized = true;

    var posterUrl = posterUrlFor(currentVariant());
    if (posterEl) posterEl.style.backgroundImage = "url('" + posterUrl + "')";

    var posterImg = new Image();
    posterImg.onload = startInitialFetch;
    posterImg.onerror = startInitialFetch;
    posterImg.src = posterUrl;
    setTimeout(startInitialFetch, POSTER_SAFETY_MS);
  }

  function startInitialFetch() {
    if (firstFetchStarted) return;
    firstFetchStarted = true;
    swapToVariant(currentVariant());
  }

  // Re-checks the live query and swaps the loaded film if it disagrees
  // with what is currently loaded. A no-op before the initial poster
  // race has even started (so it never jumps the poster ahead of the
  // blob fetch on first load) and a no-op while scrub is gated off.
  function maybeSwapVariant() {
    if (!firstFetchStarted || !scrubOn) return;
    swapToVariant(currentVariant());
  }

  function swapToVariant(variant) {
    if (videoFailed) return;
    if (variant === loadedVariant) return;

    if (currentCtrl) { try { currentCtrl.abort(); } catch (e) {} currentCtrl = null; }
    clearSeekTimeout();
    seekBusy = false;
    pendingTime = null;

    if (posterEl) posterEl.style.backgroundImage = "url('" + posterUrlFor(variant) + "')";
    if (stage) stage.classList.remove('video-ready');

    loadedVariant = variant;
    var myGen = ++loadGen;
    loadVariantBlob(variant, myGen).catch(function () {
      if (myGen !== loadGen) return; // superseded by a later swap, not a real failure
      failVideo();
    });
  }

  async function loadVariantBlob(variant, gen) {
    var ctrl = new AbortController();
    currentCtrl = ctrl;
    var watchdog = setTimeout(function () { ctrl.abort(); }, WATCHDOG_MS);

    var res = await fetch(variant.src, { priority: 'low', signal: ctrl.signal });
    if (gen !== loadGen) { clearTimeout(watchdog); return; }
    if (!res.ok || !res.body) { clearTimeout(watchdog); throw new Error('hero video fetch failed'); }

    // Content-Length, when present, is the live source of truth. The
    // hardcoded byte size is only a fallback, and tolerates 0 (the wide
    // film before the integrator patches its real size): with neither
    // available the ring simply cannot show a fraction and waits for the
    // stream to finish instead of dividing by zero.
    var contentLength = Number(res.headers.get('Content-Length'));
    var total = contentLength > 0 ? contentLength : (variant.bytes > 0 ? variant.bytes : 0);

    var reader = res.body.getReader();
    var chunks = [];
    var got = 0;
    var lastRing = 0;

    for (;;) {
      var result = await reader.read();
      if (gen !== loadGen) {
        clearTimeout(watchdog);
        try { ctrl.abort(); } catch (e) {}
        return;
      }
      if (result.done) break;
      clearTimeout(watchdog);
      watchdog = setTimeout(function () { ctrl.abort(); }, WATCHDOG_MS); // re-armed on every chunk
      chunks.push(result.value);
      got += result.value.length;
      if (ring && total > 0) {
        var frac = Math.min(1, got / total);
        var now = performance.now();
        if (now - lastRing > RING_THROTTLE_MS || frac === 1) {
          lastRing = now;
          ring.style.setProperty('--ld', String(Math.round(126 * (1 - frac))));
        }
      }
    }

    clearTimeout(watchdog);
    if (gen !== loadGen) return;
    if (ring) ring.style.setProperty('--ld', '0');

    var newBlobUrl = URL.createObjectURL(new Blob(chunks));
    if (gen !== loadGen) { URL.revokeObjectURL(newBlobUrl); return; }

    if (blobUrl) URL.revokeObjectURL(blobUrl); // the previous film, safe to drop now the new one is ready
    blobUrl = newBlobUrl;
    video.src = blobUrl;
    video.load();
    video.addEventListener('canplay', function () {
      if (gen !== loadGen) return; // a newer swap already took over
      // Only reseek the video to the current position. Leave shown and
      // target alone so the lerp keeps owning them; forcing them here
      // would discard whatever eased value the rAF loop had already
      // reached and snap the crest/caption if the visitor scrolled
      // during load.
      requestSeek(heroProgress() * video.duration);
      if (stage) stage.classList.add('video-ready');
      maybeStartDrift();
    }, { once: true });
  }

  /* ---------------------------------------------------------------------
     The five static-hero gates. Strings identical, character for
     character, to BUILD-CONTRACT.md and styles.css. Decided live with
     change listeners, never once at load.
  --------------------------------------------------------------------- */

  var GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  var MQLS = GATES.map(function (q) { return window.matchMedia(q); });

  var scrubOn = false;

  function enableScrub() {
    if (scrubOn) return;
    scrubOn = true;
    initHeroOnce();
    window.addEventListener('scroll', onScroll, { passive: true });
    unpinFinalStates(); // resets the cached --heroOut so a stale pinned value gets rewritten
    writeHeroOut();
    syncTarget(); // re-seek to the current scroll position; not a visitor scroll, so drift stays live
    maybeSwapVariant(); // picks up an orientation change that happened while scrub was off
  }

  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    window.removeEventListener('scroll', onScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function applyHeroMode() {
    // Gate order matches GATES: 0 phones, 1 and 2 portrait, 3 landscape
    // phone, 4 reduced motion. Landscape phone and reduced motion always
    // fall back to the static hero. Phones and the two portrait gates
    // only fall back when MOBILE_SCRUB is false.
    var alwaysOff = MQLS[3].matches || MQLS[4].matches;
    var off = MOBILE_SCRUB ? alwaysOff : MQLS.some(function (m) { return m.matches; });

    if (off) {
      if (MQLS[4].matches) pinToFinalStates();
      disableScrub();
    } else {
      enableScrub();
    }
  }

  MQLS.forEach(function (m) { m.addEventListener('change', applyHeroMode); });
  FILM_Q.addEventListener('change', maybeSwapVariant);
  applyHeroMode();

  /* ---------------------------------------------------------------------
     Public API. Agent J's site.js reads and calls into this.
  --------------------------------------------------------------------- */

  function isScrubOn() { return scrubOn; }

  window.filmEngine = {
    heroProgress: heroProgress,
    pinToFinalStates: pinToFinalStates,
    unpinFinalStates: unpinFinalStates,
    isScrubOn: isScrubOn
  };
})();
