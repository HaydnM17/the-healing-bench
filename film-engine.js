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
    visitor scrolls, through the same lerp and draw path scroll itself
    drives, so the hero is alive on arrival. It stops for good on the
    first real scroll.
  - The five-band hero narration is gone. The hero is now a single
    composed crest plus caption block, owned by Agent M's markup and
    Agent S's CSS. This engine's only remaining DOM writes are the poster,
    the canvas, the loading ring, and one custom property, --heroOut, that
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

  // The two films. Exactly one variant's frames are ever fetched, chosen
  // by FILM_Q below. Portrait: shot at 720x1280, 21.041667s at 24fps (505
  // frames), confirmed by Agent A, then trimmed and resampled down to the
  // 193-frame WebP sequence described below. Wide: landscape, encoded
  // separately at its own frame count and timing.
  // Both films are trimmed to end just after the camera reaches the table.
  // What came after that was a slow push further and further into the bed,
  // which is not a shot anyone wants to arrive at and sit on, and which the
  // scrub can no longer reach anyway (see endMax below).
  //
  // They ship as WebP frame sequences rather than as mp4s. Scrubbing a
  // <video> means assigning currentTime every frame, and every assignment
  // is a seek: the decoder flushes and decodes forward from the nearest
  // keyframe, and on a phone that round trip is 30 to 100ms. Only one seek
  // can be in flight at a time without making it worse, so the scrub is
  // capped at 1000/latency frames a second, which is 10 to 30fps on a
  // phone however the file is encoded. Smaller resolutions, denser
  // keyframes and dropping the CSS filter all reduced the cost of a seek
  // and none of them removed the round trip, because the round trip is the
  // architecture. Drawing an already decoded image has no round trip at
  // all, so a frame sequence runs at whatever rate the device can
  // composite, which is 60fps on anything current.
  //
  // The cost is a wash. The portrait film was 584,570 bytes as an mp4 at
  // 540x960; it is 985,000 as 193 WebP frames at a full 720x1280. Dark,
  // soft, grainy footage compresses to about 5KB a frame.
  //
  //   driftMax  how far in the idle auto-play runs before it stops and waits
  //             for a scroll. Measured by extracting frames: the descent
  //             begins about 5.0s into the portrait film and about 4.3s into
  //             the wide one, and everything before that is the stones
  //             holding while steam builds, which is exactly what should
  //             auto-play.
  //   endMax    where scroll stops the film. The camera arrives at the table
  //             at about 9.0s (portrait) and 7.0s (wide). Past that it only
  //             creeps closer, so the scrub ends on the arrival frame and the
  //             last sliver of each sequence is headroom, never shown.
  //   seconds   the film's real running time, which the idle drift needs so
  //             it can advance at DRIFT_RATE relative to real playback. A
  //             video would have supplied this itself, via video.duration;
  //             a frame sequence has no such property, so each variant has
  //             to be told its own.
  //
  //   portrait  193 frames, 20fps, 9.65s   drift 5.0 -> 0.52   arrive 9.0 -> 0.935
  //   wide      153 frames, 20fps, 7.65s   drift 4.3 -> 0.56   arrive 7.0 -> 0.918
  var VIDEO_PORTRAIT = {
    dir: 'assets/frames/p/', count: 193, seconds: 9.65,
    driftMax: 0.52, endMax: 0.935
  };
  var VIDEO_WIDE = {
    dir: 'assets/frames/w/', count: 153, seconds: 7.65,
    driftMax: 0.56, endMax: 0.918
  };

  // Matching posters, one per film, so the still image painted first
  // during the bandwidth race is already framed for the right aspect
  // ratio and never flashes a mismatched crop while the frames load in.
  // Not part of the mandated two-film constants above; an Agent F
  // addition that closes the same "wrong asset" gap for the still frame.
  var POSTER_PORTRAIT = 'assets/hero-poster.jpg?v=3';
  var POSTER_WIDE = 'assets/hero-wide-poster.jpg?v=3';

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
  var POSTER_SAFETY_MS = 4000;    // start the frame fetch even if the poster hangs
  var RING_THROTTLE_MS = 100;     // ring redraw throttle
  // Idle auto-play speed, relative to real-time playback. 1 is the film's own
  // speed, which is what it is graded and paced for. It was 0.12 at one point,
  // which took 13 real seconds to cross the opening and read as a still frame,
  // then 0.75, which still read as slightly slowed. There is no reason for the
  // hold to play at anything other than the speed it was shot at.
  var DRIFT_RATE = 1;
  // The cap now lives on each film variant as driftMax, because the two films
  // are paced differently. See the VIDEO_PORTRAIT and VIDEO_WIDE definitions.
  function driftMax() {
    var v = currentVariant();
    return (v && typeof v.driftMax === 'number') ? v.driftMax : 0.52;
  }

  function endMax() {
    var v = currentVariant();
    return (v && typeof v.endMax === 'number') ? v.endMax : 1;
  }

  // Scroll finishes the film well before it finishes the hero. Past this
  // point the frame is pinned on the arrival and the remaining scroll is
  // spent bringing the reveal panel in and then simply holding it there.
  // Without that hold the panel completed and the section immediately
  // started leaving, so the text was never on screen at rest.
  var SCRUB_END = 0.55;
  var HERO_OUT_VH = 0.66;         // --heroOut reaches 1 over this many viewport heights

  /* ---------------------------------------------------------------------
     Guard. If the hero film canvas is not on this page, do nothing but
     still hand Agent J's site.js a safe, inert copy of the public API.
  --------------------------------------------------------------------- */

  var canvas = document.getElementById('heroFilm');

  if (!canvas || !canvas.getContext) {
    window.filmEngine = {
      heroProgress: function () { return 0; },
      pinToFinalStates: function () {},
      unpinFinalStates: function () {},
      isScrubOn: function () { return false; },
      isHeld: function () { return true; }
    };
    return;
  }

  // alpha:false lets the compositor skip per-pixel blending. The film is
  // full-bleed and opaque, so there is never anything behind it to show
  // through, and the scrim that grades it is a separate layer above.
  var ctx = canvas.getContext('2d', { alpha: false });

  var stage = document.getElementById('heroStage');
  var posterEl = document.getElementById('heroPoster');
  var ring = document.getElementById('heroRing');
  var hero = document.getElementById('hero') ||
    (canvas.closest && canvas.closest('.hero')) ||
    stage || canvas;

  /* ---------------------------------------------------------------------
     Small helpers.
  --------------------------------------------------------------------- */

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ---------------------------------------------------------------------
     measureHero: the hero's offsetHeight and getBoundingClientRect, taken
     together as one snapshot. tick() takes this reading exactly once per
     frame, at the top, and threads the result through heroProgress,
     computeHeroOut, computeHeroLate and computeHeroFade below, so a frame
     that needs all four never re-queries layout for each one. Every call
     site outside tick() (site.js's heroProgress() with no arguments,
     onScroll, enableScrub, the IntersectionObserver callback) still wants
     a fresh read, so the measurement parameter on each function below is
     optional: omit it and the function measures for itself, exactly as
     it always did.
  --------------------------------------------------------------------- */

  function measureHero() {
    return { offsetHeight: hero.offsetHeight, rect: hero.getBoundingClientRect() };
  }

  /* ---------------------------------------------------------------------
     heroProgress: 0 to 1 through the pinned hero's scroll range. Part of
     the public API (window.filmEngine.heroProgress), called from site.js
     with no arguments, so `m` must stay optional and default to a fresh
     measurement.
  --------------------------------------------------------------------- */

  function heroProgress(m) {
    if (!m) m = measureHero();
    var total = m.offsetHeight - window.innerHeight;
    if (total <= 0) return 1;
    return clamp(-m.rect.top / total, 0, 1);
  }

  /* ---------------------------------------------------------------------
     --heroOut: 0 to 1 over HERO_OUT_VH viewport heights of real scroll,
     independent of the film's own progress mapping. Agent S reads it on
     #heroStage to translate and fade #heroCrest and #heroCaption. Pure
     function of live scroll geometry, so it is fully reversible: scroll
     back up and the crest returns. Written delta-gated, every tick.
  --------------------------------------------------------------------- */

  var lastHeroOut = -1;

  function computeHeroOut(m) {
    var rect = m ? m.rect : hero.getBoundingClientRect();
    var scrolled = Math.max(0, -rect.top);
    var span = window.innerHeight * HERO_OUT_VH;
    if (span <= 0) return 1;
    return clamp(scrolled / span, 0, 1);
  }

  function writeHeroOut(m) {
    if (!stage) return;
    var out = computeHeroOut(m);
    if (Math.abs(out - lastHeroOut) >= DELTA_GATE) {
      stage.style.setProperty('--heroOut', String(out));
      lastHeroOut = out;
    }
  }

  /* ---------------------------------------------------------------------
     --heroLate: 0 to 1 across the tail of the film, after the camera has
     finished its descent and settled on the table. Agent S reads it on
     #heroStage to bring .hero__reveal in over the settled frame.

     Deliberately NOT --heroOut inverted. --heroOut is a function of raw
     scrolled pixels over two thirds of a viewport, which is how the crest
     and caption leave: quickly, near the top, regardless of how long the
     film is. This one is a function of the film's own progress, because
     it has to land on a particular moment in the footage rather than at a
     particular scroll depth. With the hero at 280vh, --heroOut is spent
     by about heroProgress 0.37, so the caption is long gone before this
     starts at 0.52 and the two never share the screen.

     .is-late rides along because pointer-events cannot be driven from a
     custom property, and an invisible button at opacity 0 is still a
     button you can click.
  --------------------------------------------------------------------- */

  // The panel starts rising while the camera is still coming down (SCRUB_END
  // is 0.55) and is fully in by 0.66, just after it lands. That leaves a third
  // of the hero as pure hold: the frame pinned on the table, the text at
  // rest, nothing moving. That hold is the point. At the original 0.88 the
  // button landed and the section began scrolling away in the same gesture.
  var LATE_IN = 0.34;             // hero progress where the panel starts arriving
  var LATE_FULL = 0.66;           // ...and where it is fully in
  var lastHeroLate = -1;

  // The closing blackout. Starts only after the panel has been sitting at
  // rest for a stretch, and reaches full black right at the section's end,
  // so the film dims away before the About band's warm tan arrives rather
  // than cutting straight from a lit room to a flat colour. Written from
  // the same tick as --heroLate so the blackout costs no extra frame work.
  var FADE_IN = 0.82;
  var lastHeroFade = -1;

  function computeHeroLate(m) {
    var span = LATE_FULL - LATE_IN;
    if (span <= 0) return 1;
    return clamp((heroProgress(m) - LATE_IN) / span, 0, 1);
  }

  function computeHeroFade(m) {
    var span = 1 - FADE_IN;
    if (span <= 0) return 0;
    return clamp((heroProgress(m) - FADE_IN) / span, 0, 1);
  }

  function writeHeroLate(m) {
    if (!stage) return;

    var late = computeHeroLate(m);
    if (Math.abs(late - lastHeroLate) >= DELTA_GATE) {
      stage.style.setProperty('--heroLate', String(late));
      stage.classList.toggle('is-late', late > 0.02);
      lastHeroLate = late;
    }

    var fade = computeHeroFade(m);
    if (Math.abs(fade - lastHeroFade) >= DELTA_GATE) {
      stage.style.setProperty('--heroFade', String(fade));
      lastHeroFade = fade;
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
    lastHeroLate = -1;
    lastHeroFade = -1;
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
     and the same drawFrame() below, never by playing anything.

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
      !prefersReducedMotion() && filmReady;
  }

  /* ---------------------------------------------------------------------
     "The film has come to rest." Latched once, never cleared.

     The opening plays itself for five or six seconds and then stops on the
     frame before the camera descends, waiting for a scroll. That stop is
     the moment the page is finished introducing itself, and site.js's jump
     arrows wait for it before offering the down arrow: an arrow inviting
     you past the hero while the hero is still playing its one move is an
     arrow arguing with the page.

     Signalled by a class on the stage and by a one-shot event, so a
     listener that arrives late can still ask via isHeld().

     Every path that ends the hold signals it, not just the happy one: the
     drift finishing, a visitor scrolling before it does, reduced motion,
     a gate falling back to the static poster, and a timeout in case the
     film never loads at all. Nothing should be able to leave the arrow
     hidden forever.
  --------------------------------------------------------------------- */

  var held = false;

  function signalHeld() {
    if (held) return;
    held = true;
    if (stage) stage.classList.add('film-held');
    try {
      document.dispatchEvent(new CustomEvent('film:held'));
    } catch (e) {
      // No CustomEvent constructor: the class above is the fallback path.
    }
  }

  function isHeld() { return held; }

  // The film is a courtesy, not a gate. If it never loads, never decodes,
  // or the browser refuses it outright, the arrow still arrives.
  setTimeout(signalHeld, 9000);

  function tick(now) {
    // Single read per frame: the hero's rect and offsetHeight are measured
    // exactly once here, at the top, before anything below writes any
    // style. That one measurement is threaded through writeHeroOut() and
    // writeHeroLate() (which hand it on to computeHeroOut, computeHeroLate
    // and computeHeroFade) instead of each of those re-reading layout on
    // its own, and the read happens before the --heroOut/--heroLate/
    // --heroFade writes further down, so nothing in this frame can force a
    // synchronous layout against a style this same frame already wrote.
    var heroMeasurement = measureHero();

    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;

    var drifting = driftEligible();
    if (drifting) {
      target = clamp(target + (DRIFT_RATE * dt / 1000) / filmSeconds, 0, driftMax());
    }

    shown += (target - shown) * (1 - Math.pow(1 - LERP_K, dt / 16.667));
    var converged = Math.abs(target - shown) < CONVERGE_EPS;
    if (converged) shown = target;

    drawFrame(shown);
    writeHeroOut(heroMeasurement);
    writeHeroLate(heroMeasurement);

    if (!converged || drifting) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      lastTick = 0;
      // Converged and no longer drifting: the opening has played itself out
      // and the film is sitting still, waiting for a scroll.
      signalHeld();
    }
  }

  // The real scroll handler. Fires only from a genuine 'scroll' event, so
  // it is the one and only place hasScrolled ever flips true. It never
  // resets false again: the idle drift is a once-per-pageview courtesy.
  function onScroll() {
    hasScrolled = true;
    // A scroll ends the hold whether or not it had finished on its own.
    signalHeld();
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
    // Scroll drives the film from driftMax() to endMax() across the FIRST
    // SCRUB_END of the hero, not across all of it. The rest of the hero is
    // the frame held on the arrival while the reveal panel arrives and sits.
    var dm = driftMax();
    var sp = clamp(p / SCRUB_END, 0, 1);
    target = dm + sp * (endMax() - dm);
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
     The draw layer, which replaces the gated-seek machinery a <video>
     needed.

     There is no gate here and nothing to deadlock, because there is no
     asynchronous round trip to wait on: the frames are already decoded
     Image objects and drawImage is synchronous. The only gate left is the
     one that matters, which is not redrawing a frame already on screen.
  --------------------------------------------------------------------- */

  var frames = [];          // Image objects for the loaded variant, in order
  var frameCount = 0;
  var filmReady = false;
  var filmFailed = false;
  var lastDrawn = -1;
  var filmSeconds = 10;     // replaced by the variant's own value on load

  // The canvas backing store, sized to the stage in device pixels. Capped
  // at 2x: a 3x phone would ask for a 1170x2532 surface to show footage
  // that is 720x1280, which is a lot of fill rate for pixels the source
  // cannot supply anyway.
  function sizeCanvas() {
    if (!stage) return;
    var rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(rect.width * dpr);
    var h = Math.round(rect.height * dpr);
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    lastDrawn = -1; // the surface was cleared, so the current frame must be redrawn
  }

  // object-fit: cover, done by hand. The film's aspect ratio rarely
  // matches the viewport's, and letterboxing a full-bleed hero would show
  // the stage's flat ground down the sides.
  function paint(img) {
    var cw = canvas.width;
    var ch = canvas.height;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!cw || !ch || !iw || !ih) return;
    var scale = Math.max(cw / iw, ch / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  // p is 0 to 1 through the film. Rounding to the nearest frame and
  // skipping a redraw of the frame already on screen is what keeps this
  // cheap: at 193 frames across the whole hero, most scroll ticks do not
  // change which frame is current, and those cost nothing at all.
  function drawFrame(p) {
    if (!filmReady || frameCount === 0) return;
    var idx = clamp(Math.round(p * (frameCount - 1)), 0, frameCount - 1);
    if (idx === lastDrawn) return;
    var img = frames[idx];
    if (!img || !img.complete || !img.naturalWidth) return;
    lastDrawn = idx;
    paint(img);
  }

  function redraw() {
    var idx = lastDrawn;
    lastDrawn = -1;
    if (idx >= 0 && frames[idx]) {
      lastDrawn = idx;
      paint(frames[idx]);
    }
  }

  window.addEventListener('resize', function () {
    sizeCanvas();
    redraw();
  }, { passive: true });

  /* ---------------------------------------------------------------------
     Failure fallback. If the frame sequence cannot be trusted (too many
     frames errored, see settle() below), failFilm() drops the hero back
     to the plain poster and swaps the loading ring for a static chevron,
     since a ring promises progress that is never going to arrive.
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

  function failFilm() {
    if (filmFailed) return;
    filmFailed = true;
    filmReady = false;
    if (ring && ring.parentNode) {
      ring.parentNode.replaceChild(makeScrollChevron(), ring);
    }
    canvas.style.display = 'none';
    if (stage) stage.classList.add('film-failed');
    // The hero is the poster now, and a poster has no opening to play
    // through, so the jump arrows should not keep waiting on one.
    signalHeld();
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
     The frame loader, swappable: a load generation counter guards against
     a superseded sequence's images landing after a newer swap has already
     started. Only ever one sequence is in flight at a time. There is no
     blob and no object URL to revoke, so no teardown is needed either.
  --------------------------------------------------------------------- */

  var heroInitialized = false;
  var firstFetchStarted = false;
  var loadedVariant = null;
  var loadGen = 0;

  function initHeroOnce() {
    if (heroInitialized) return;
    heroInitialized = true;

    // Size the backing store as soon as the engine engages, not only once
    // the first variant's frames finish loading. The canvas stays at
    // opacity 0 under the poster until film-ready (see styles.css), so
    // this has no visible effect on its own; it just means settle()'s own
    // sizeCanvas() call below has nothing to do on the common path where
    // the stage hasn't resized in between, instead of doing the first
    // layout read right as the film is trying to appear.
    sizeCanvas();

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
  // frame fetch on first load) and a no-op while scrub is gated off.
  function maybeSwapVariant() {
    if (!firstFetchStarted || !scrubOn) return;
    swapToVariant(currentVariant());
  }

  function swapToVariant(variant) {
    if (filmFailed) return;
    if (variant === loadedVariant) return;

    if (posterEl) posterEl.style.backgroundImage = "url('" + posterUrlFor(variant) + "')";
    if (stage) stage.classList.remove('film-ready');

    filmReady = false;
    lastDrawn = -1;
    loadedVariant = variant;
    loadVariantFrames(variant, ++loadGen);
  }

  /* ---------------------------------------------------------------------
     Loading a frame sequence.

     Every frame is fetched as an ordinary <img>, which means the browser's
     own image pipeline does the work: parallel connections, its own
     priority queue, its own cache, and decoding off the main thread where
     the platform supports it. There is no streaming reader and no blob,
     because there is nothing to assemble; frame 12 is useful the moment it
     lands whether or not frame 80 has.

     The ring shows frames decoded rather than bytes received, which is the
     honest measure here: a frame that has arrived but not decoded cannot
     be drawn.

     The film is only declared ready once every frame is in. A scrub can
     jump to any position at any time, so a partially loaded sequence would
     mean the film silently sticking on whichever frame happened to be the
     last one loaded before the gap. The poster covers the wait.

     decode() is awaited where available so the first draw of each frame is
     not a decode stall on the main thread. Its rejection is not a failure:
     some browsers reject decode() for an image that is perfectly usable,
     so the onload path is what actually counts a frame in.
  --------------------------------------------------------------------- */

  function frameUrl(variant, i) {
    var n = String(i + 1);
    while (n.length < 3) n = '0' + n;
    return variant.dir + 'f' + n + '.webp';
  }

  function loadVariantFrames(variant, gen) {
    var imgs = new Array(variant.count);
    var decoded = 0;
    var errored = 0;
    var lastRing = 0;

    function tickRing() {
      if (!ring) return;
      var frac = Math.min(1, decoded / variant.count);
      var now = performance.now();
      if (now - lastRing > RING_THROTTLE_MS || frac === 1) {
        lastRing = now;
        ring.style.setProperty('--ld', String(Math.round(126 * (1 - frac))));
      }
    }

    function settle() {
      if (gen !== loadGen) return; // a newer swap took over while this was loading
      if (decoded + errored < variant.count) return;

      // A handful of missing frames is survivable: the draw layer skips an
      // image that never loaded and holds the previous one, which reads as
      // a momentary stutter rather than a broken hero. Losing most of them
      // is not, and falls back to the poster.
      if (errored > variant.count * 0.1) {
        failFilm();
        return;
      }

      frames = imgs;
      frameCount = variant.count;
      filmSeconds = variant.seconds || 10;
      filmReady = true;
      if (ring) ring.style.setProperty('--ld', '0');
      if (stage) stage.classList.add('film-ready');

      sizeCanvas();
      lastDrawn = -1;
      // shown, not heroProgress(): the lerp owns the current position and
      // already reflects the scroll-to-film mapping, which heroProgress
      // alone does not.
      drawFrame(shown);
      maybeStartDrift();
    }

    for (var i = 0; i < variant.count; i++) {
      (function (index) {
        var img = new Image();
        img.decoding = 'async';
        imgs[index] = img;

        img.onload = function () {
          if (gen !== loadGen) return;
          // The frame counts as loaded here, on onload, not inside decode()'s
          // own callbacks: decode()'s promise is a best-effort pre-warm so the
          // first drawImage() of this frame is not itself a decode stall, but
          // it is not guaranteed to settle at all in every browser, and gating
          // the count on it would mean one hung decode() silently wedges the
          // whole sequence below variant.count forever, with the poster never
          // handing off. onload has already proven the frame is real and
          // paintable, which is what settle() needs.
          decoded++; tickRing(); settle();
          if (typeof img.decode === 'function') {
            img.decode().catch(function () {
              // Some browsers reject decode() for an image that is perfectly
              // usable; the frame was already counted above, so there is
              // nothing left to do here.
            });
          }
        };

        img.onerror = function () {
          if (gen !== loadGen) return;
          errored++; tickRing(); settle();
        };

        img.src = frameUrl(variant, index);
      })(i);
    }
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
    // .hero__reveal only exists while the film is actually being scrubbed.
    // Every gate that falls back to the static hero leaves the crest and
    // caption pinned in the middle of the frame, which is exactly where the
    // reveal panel sits, so the two would land on top of each other. A
    // scroll-driven reveal is also the wrong thing to hand someone who has
    // asked for reduced motion.
    if (stage) stage.classList.add('is-scrubbing');
    window.addEventListener('scroll', onScroll, { passive: true });
    unpinFinalStates(); // resets the cached --heroOut so a stale pinned value gets rewritten
    writeHeroOut();
    writeHeroLate();
    syncTarget(); // re-seek to the current scroll position; not a visitor scroll, so drift stays live
    maybeSwapVariant(); // picks up an orientation change that happened while scrub was off
  }

  function disableScrub() {
    if (!scrubOn) return;
    scrubOn = false;
    if (stage) stage.classList.remove('is-scrubbing');
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
      // A static hero has no opening to wait through.
      signalHeld();
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
    isScrubOn: isScrubOn,
    isHeld: isHeld
  };
})();
