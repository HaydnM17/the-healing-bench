# CSS handoff, booking pass

Everything below is new markup added to `index.html` in the booking-links-and-attribution pass. None of it has rules in `styles.css` yet. I do not own `styles.css`, so this file is the request rather than a direct edit. Grouped by section, in the order they appear in the document.

---

## 1. Treatments: `.treatment-row__with` and `.treatment-row__cta`

Two new lines added to every one of the ten `.treatment-row` / `.treatment-row--media` blocks in `#treatments`.

- `.treatment-row__with` — a one-line practitioner attribution ("With Deborah", "With Naira"), sitting between `.treatment-row__price` and `.treatment-row__desc`. Nine of ten rows carry it; Indian Head Massage deliberately does not (no practitioner card claims it). Needs a quiet, secondary treatment, smaller and lower-contrast than the name/price line so it doesn't compete with them, something in the register of `.treatment-row__price.is-enquiry` (quiet uppercase, no colour accent) or `.treatments__group-count`. Suggest:

```css
.treatment-row__with {
  font-family: var(--font-body);
  font-size: .8125rem;
  letter-spacing: .04em;
  color: var(--bone-soft); /* espresso band: #treatments is tone-espresso */
}
```

- `.treatment-row__cta` — wraps a `.btn.btn--ghost.btn--sm` at the end of every row's body, right after `.treatment-row__desc`. Currently unstyled, so it just inherits block spacing from being a `<p>`. Needs a bit of top margin to separate it from the description paragraph above, and on the `--media` rows (which are a two-column grid on desktop) it should stay left-aligned under the description rather than stretching full width. Suggest:

```css
.treatment-row__cta {
  margin-top: var(--space-sm);
}

.treatment-row__cta .btn {
  display: inline-flex;
}
```

Both classes appear inside plain `.treatment-row` blocks and inside `.treatment-row--media .treatment-row__body` blocks identically, so one rule set should cover both contexts; `#treatments` is `tone-espresso` throughout, so `.btn--ghost` will already pick up the correct light-on-dark colours via `--ground-ink` / `--ground-ghost-border`, no new colour logic needed there.

## 2. Treatments: five new row images at 1920x1080 (landscape) in the portrait media slot

`.treatment-row__media img` already sets `object-fit: cover` and the container is a fixed `aspect-ratio` (4/5 phone, 3/4 desktop), so the four new facial rows using `tex-steam.jpg`, `tex-contour.jpg` and `tex-linen.jpg` (all 1920x1080, previously only used as full-bleed section-ground textures) and the Indian Head Massage row using `still-falling.jpg` (1080x1920, previously only a decorative ambient layer inside the stone interaction) should already crop correctly with no new CSS. Flagging only so you can eyeball the crop once real assets render, since these four are being asked to do double duty in a much smaller, portrait-cropped frame for the first time. No action needed unless the crop looks wrong in review.

## 3. Reviews: second call to action, `.reviews__cta`

New block after `.reviews__carousel`, inside `#reviews .container` (tone-espresso). Two children: `.reviews__cta-lede` (a `<p>`) and a `.btn.btn--ghost.btn--sm` link, both currently plain block elements. Wants centred text, matching the section's existing centred rhythm (`.reviews__rating` above the carousel is the closest sibling to copy the spacing from). Suggest:

```css
.reviews__cta {
  margin-top: var(--space-xl);
  text-align: center;
}

.reviews__cta-lede {
  margin-bottom: var(--space-sm);
  color: var(--bone-soft);
}
```

## 4. FAQ: second call to action, `.faq__cta`

Same shape as `.reviews__cta` above, after `.faq__list`, inside `#faq .container` (tone-cream), using a `.btn.btn--primary.btn--sm` instead of ghost. Suggest the identical rule set with `.faq__cta-lede` colour swapped to `var(--ink-soft)` since this band is light:

```css
.faq__cta {
  margin-top: var(--space-xl);
  text-align: center;
}

.faq__cta-lede {
  margin-bottom: var(--space-sm);
  color: var(--ink-soft);
}
```

## 5. Book: the whole `.book__details` block

This is the real work. `#book` was rebuilt from a single centred column (heading, lede, one button, contact links) into a real closing section that also carries hours, address, "what to expect" and the cancellation policy. New markup, all currently unstyled:

```html
<div class="book__details">
  <div class="book__details-col">
    <h3 class="book__details-head">Hours</h3>
    <div class="book__hours">
      <div class="book__hours-row"><span>Monday</span><span>10:00 a.m. to 7:00 p.m.</span></div>
      <!-- ...seven rows total, Sunday last -->
    </div>
  </div>
  <div class="book__details-col">
    <h3 class="book__details-head">Find us</h3>
    <address class="book__address">4460 Ontario Street, Unit 2<br>Beamsville, ON L3J 0A9</address>
  </div>
  <div class="book__details-col">
    <h3 class="book__details-head">What to expect</h3>
    <p class="book__details-text">[ANSWER TO CONFIRM.]</p>
  </div>
  <div class="book__details-col">
    <h3 class="book__details-head">Cancellation policy</h3>
    <p class="book__details-text">We need 24 hours notice...</p>
  </div>
</div>
```

It sits inside `.book__frame`, between `.book__lede` and `.book__actions`. `.book__frame` is currently `max-width: 640px` and `display: flex; flex-direction: column; align-items: center;` (see `styles.css` around the BOOK section, roughly line 2531), which will stack `.book__details` as one more centred flex child unless you give it its own layout. That's almost certainly wrong for four columns of detail text, so two things need deciding:

1. **Whether `.book__frame` should widen for this section only** (it's currently sized for a single line of heading/lede/button, not a four-column detail grid) — likely wants a wider `max-width` specifically when `.book__details` is present, or `.book__details` needs to break out of the 640px cap with a negative margin / its own wider wrapper.
2. **The grid itself** — two across on phone, four across (or two rows of two) on desktop, similar to `.visit__grid`'s pattern but with four items instead of two. Something like:

```css
.book__details {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-lg);
  margin-block: var(--space-lg);
  text-align: left;
}

@media (min-width: 640px) {
  .book__details {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (min-width: 980px) {
  .book__details {
    grid-template-columns: repeat(4, 1fr);
  }
}

.book__details-head {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: .8125rem;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--bone);
  margin-bottom: var(--space-xs);
}

.book__details-text,
.book__address {
  font-style: normal;
  font-size: var(--fs-sm);
  line-height: var(--lh-body);
  color: var(--bone-soft);
}

.book__hours-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
  padding-block: .35em;
  border-bottom: 1px solid var(--line-dark);
  font-size: var(--fs-sm);
  color: var(--bone-soft);
}
```

Colour tokens matter here specifically because `#book` sits on a dark, full-bleed photograph (`room-2.jpg` under a scrim) — everything needs the `--bone` / `--bone-soft` pairing `.book__lede` and `.book__contact` already use, not the `--ink` / `--ink-soft` pair `.visit__hours-row` uses (that one's on the tan band and would be close to invisible here). Please do not copy `.visit__hours-row`'s rule wholesale for `.book__hours-row` for that reason, even though the two are visually the same idea.

This is the section the brief called out as needing the most work: it went from a near-duplicate of the hero's single-column layout to the one section on the page carrying hours, address, "what to expect" and the cancellation policy together, so it's worth a proper look rather than a quick pass.
