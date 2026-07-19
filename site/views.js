/* LSE GALLERY — Flow (3D card deck), Index (collage grid), About.
   Flow: sine-bobbing deck with a rotateY tilt. Index: smooth-scrolled 12-column grid
   whose rows tilt with the scroll velocity. About: curtain page with line reveals. */
(() => {
'use strict';

const LERP = 0.12;                                              // chase, per frame
const WHEEL_MULT = /Win/.test(navigator.platform) ? 1 : 0.45;   // wheel feels lighter on mac

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function thumb(src, w) {
  const f = String(src || '').split('/').pop();
  return f ? window.LSEData.asset('/thumbs/' + w + '/' + encodeURIComponent(f)) : '';
}

/* every framed painting fades in when it loads, and keeps that .ok wherever it flies to */
function gateLoad(img) {
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
}

/* The page has two drawings, a phone's and a desktop's, and it used to switch between their
   numbers at a single pixel of window: seven paintings abreast became sixteen, a card 20rem wide
   became 28.1rem, a drag that travelled 3.6x became 2.2x. Nothing about a 701px window is twice
   as wide as a 699px one, so nothing about it should be drawn twice as loosely.
   `span` is where the window stands between the two drawings, 0 at the phone's width and 1 at the
   desktop's, and every number that differed between them is read off it. Counts land on whole
   numbers, so they step one at a time, at the width where one more actually fits. */
function span() {
  return Math.max(0, Math.min(1, (innerWidth - 390) / (1500 - 390)));
}
function tween(small, large) {
  return small + (large - small) * span();
}

const { MONTHS, month, category } = window.LSEData;   // date first — see site/data.js

/* month name -> year, exactly as the timeline ruler resolves it: take it from any slide
   dated in that month, and fall back to 2026 for the months nobody dated */
function yearsByMonth(slides) {
  const byNum = {};
  for (const s of slides || []) {
    const m = /^(\d{4})-(\d{2})/.exec(String(s.date || ''));
    if (m) byNum[+m[2]] = m[1];
  }
  const out = {};
  MONTHS.forEach((name, i) => { out[name] = byNum[i + 1] || '2026'; });
  return out;
}

/* ---------------- FLOW: floating card deck ---------------- */
function mountFlow(view, slides, aspects, onOpen, opts) {
  const wrap = el('div', 'flow');
  const inner = el('div', 'flow__inner');
  const deck = el('div', 'flow__deck');
  inner.appendChild(deck);
  wrap.appendChild(inner);
  const hoverLbl = el('div', 'flow__label label');
  wrap.appendChild(hoverLbl);
  view.appendChild(wrap);

  /* the same timeline the carousel carries. The deck runs the same works in the same order,
     so the question the ruler asks — which work is under the centre line — has an answer here
     too; it simply had no one to ask it. */
  const ruler = window.LSERuler.create(view, slides, Object.assign({ monthOf: month }, opts || {}));
  requestAnimationFrame(() => ruler.el.classList.add('is-on'));

  const items = slides.map((s, i) => {
    const it = el('article', 'flow-item lse-card');
    const media = el('div', 'flow-item__media');
    const box = el('div', 'flow-item__box lse-slot');
    box.dataset.id = s.id || '';
    const name = String(s.image || '').split('/').pop();
    box.style.aspectRatio = String(aspects[name] || 1);
    const frame = el('div', 'lse-frame');
    frame.dataset.id = s.id || '';
    const img = el('img');
    img.src = thumb(s.image, 600);
    img.draggable = false;
    img.loading = 'eager';   // the deck moves cards by transform; lazy never fires (see carousel)
    gateLoad(img);
    frame.appendChild(img);
    box.appendChild(frame);
    media.appendChild(box);
    it.appendChild(media);
    /* the painting slides 75% aside on hover — out from under the cursor. This layer stays
       put over the card's spot, so the hover (and the click) has something stable
       to land on instead of flickering onto whichever neighbour moves in underneath. */
    it.appendChild(el('div', 'flow-item__hit'));
    it.addEventListener('mouseenter', () => {
      hoverLbl.textContent = '(' + (i + 1) + ') ' + [category(s), month(s)].filter(Boolean).join(' / ');
      hoverLbl.classList.add('is-on');
      hoverIdx = i;      // the deck sorts by 3D depth, so the lifted card is pulled forward:
    });                  // z-index cannot raise it inside a preserve-3d parent
    it.addEventListener('mouseleave', () => {
      hoverLbl.classList.remove('is-on');
      if (hoverIdx === i) hoverIdx = -1;
    });
    it.addEventListener('click', () => { if (!moved) onOpen(s, box); });
    deck.appendChild(it);
    return { el: it, s };
  });

  /* the deck: cards are spread across the viewport width, bob on a sine wave as they pass,
     and stand at an angle that eases open when the view arrives */
  let bounds = [], total = 0, rest = 0, time = 0;
  let cardGap = 0, lapWorks = 0;         // px between cards, and works in one lap of the deck
  let target = 0, cur = 0, vel = 0, deckK = 0;
  let dragging = false, moved = false, sx = 0, sy = 0, st = 0, raf = 0, lastTs = 0;
  let hoverIdx = -1;              // the card the cursor is lifting (see mouseenter above)

  function measure() {
    /* the deck keeps its own 20rem card — the timeline and the index are matched DOWN to it (not the deck
       widened up to them), so a painting flying between views keeps its size and the flip never resizes it.
       Set before the bounds are read so they measure the real card. */
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
    deck.style.setProperty('--flow-w', (20 * rem) + 'px');
    const P = Math.round(tween(7, 16));   // cards abreast across the viewport
    const spread = innerWidth / P;
    rest = (innerHeight / (P * 1.5)) * 0.4;   // bob amplitude
    bounds = items.map((it, i) => {
      it.el.style.transform = 'translate3d(0,0,0)';
      const x = spread * i;
      it.el.style.transform = 'translate3d(' + x + 'px,0,0)';
      const r = it.el.getBoundingClientRect();
      const w = r.width;
      return { start: r.left - w - innerWidth, end: r.right + w, left: r.left, width: w };
    });
    const last = bounds[bounds.length - 1];
    total = Math.max(0, last ? last.end - bounds[0].width : 0);
    /* The deck loops every `total` px, and that is not exactly one work per card-width: the
       first card's offset and its own width ride along in it. Measured in works, a lap is
       `lapWorks`, which is a little more than the archive holds. The ruler is given the lap as
       a fraction and stretched over the archive, so the timeline comes round exactly when the
       deck does — feed it the raw count instead and the ruler would jump back a work or so
       every time the deck crossed its seam. */
    cardGap = bounds.length > 1 ? bounds[1].left - bounds[0].left : innerWidth;
    lapWorks = cardGap > 0 ? total / cardGap : slides.length;
    ruler.resize();
  }

  function place(i, wrapped) {
    const b = bounds[i];
    const inside = wrapped > b.start && wrapped < b.end;
    let prog = 0;
    if (inside) prog = 1 - Math.max(0, Math.min(1, 1 + (wrapped - b.left - b.width) / (innerWidth + b.width)));
    const p = 1 - prog;
    const xo = p - 0.5;
    const bob = Math.sin(time + xo * Math.PI * 2) * rest * (1 + vel * 0.01);
    const y = innerHeight * 0.5 * xo + bob;
    /* all tilted the one way, but least at the centre and most at the edges: 60deg on the centre
       line (the most open), closing to 83deg toward either edge — a symmetric close, no sign flip */
    const rotY = -(60 + 23 * Math.abs(p - 0.5) * 2) * deckK;
    /* the hovered card slides 75% sideways — pull it forward in the deck's 3D space so it
       passes OVER its neighbours instead of under them */
    const z = i === hoverIdx ? 60 : 0;
    /* the deck angle and place right now — read on the way out: into a view with slots the flip
       carries them there (app.js), into About it turns them flat and slides them out (exit) */
    items[i].el._roty = rotY;
    items[i].el._pos = [b.left - wrapped, y, z];
    items[i].el.style.transform =
      'translate3d(' + (b.left - wrapped) + 'px,' + y + 'px,' + z + 'px) rotateY(' + rotY + 'deg)';
  }

  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    cur += (target - cur) * LERP * ratio;
    cur = Math.round(cur * 100) / 100;
    vel = Math.round((cur - target) * 1000) / 1000;
    time += 0.022 * ratio;
    if (total > 0) {
      for (let i = 0; i < items.length; i++) {
        const b = bounds[i];
        let w = (cur - (b.end - total)) % total;
        if (w < 0) w += total;
        w += b.end - total;
        place(i, w);
      }
      /* the centre line marks the card that is MOST open (p=0.5 in place()), whose box is centred on
         the screen — not the one whose left edge the line has just reached. Offset the reference by
         half a card so the live work is the one the eye reads as centred. */
      const f = (cur + innerWidth * 0.5 - bounds[0].left - bounds[0].width * 0.5) / cardGap;   // work under the line
      let lap = f % lapWorks;
      if (lap < 0) lap += lapWorks;
      /* name the work the deck actually centres. `lap` IS that work's index; feed it straight so the
         ruler's month/year stay locked to the centred painting. (Stretching it by slides.length/lapWorks
         made the ruler's sweep finish exactly as the deck looped, but squeezed every mid-lap work a
         fraction early — the drift grew the deeper you scrolled and the month fell off the painting
         around, e.g., May 2024. The ruler wraps at the archive length on its own, so the only cost of
         the straight feed is a work-or-so hop as the deck crosses its loop seam, once a lap.) */
      ruler.update(lap, ratio);
    }
    raf = requestAnimationFrame(frame);
  }

  function onDown(e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; st = target; }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 10) moved = true;
    target = st - dx * tween(3.6, 2.2);   // drag travel
  }
  function onUp() { dragging = false; }
  function onWheel(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target += raw * WHEEL_MULT;
  }
  function onKey(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const lefts = bounds.map((b) => b.left);
    const near = lefts.reduce((a, v, i2) => Math.abs(v - target) < Math.abs(lefts[a] - target) ? i2 : a, 0);
    const nx = e.key === 'ArrowRight' ? Math.min(near + 4, items.length - 1) : Math.max(near - 4, 0);
    target = lefts[nx];
  }
  wrap.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);   // if a device still steals the gesture, end the drag cleanly
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('resize', measure);

  /* : measure, jump to the work the last view was on, then report "page-done" */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    measure();                      // after insertion — detached rects are all zero
    const idx = parseInt(document.body.dataset.index, 10);
    /* land the handed work under the centre line — the exact inverse of what the frame loop reads as the
       live work: f = (cur + innerWidth/2 - bounds[0].left - bounds[0].width/2) / cardGap. So one work is
       cardGap px of cur, and centring work idx means f === idx. (It used to feed the ruler a stretched
       index and centre with total/slides.length to match; the ruler now takes the work straight, so the
       centring must use cardGap too — the old formula left liveWork reading idx+1-ish, and a flow<->timeline
       round-trip drifted the centred work up by one each time.) */
    if (idx >= 0 && bounds[idx]) { target = cur = idx * cardGap - innerWidth * 0.5 + bounds[0].left + bounds[0].width * 0.5; }
    markReady();
  });
  raf = requestAnimationFrame(frame);

  /* : the deck angle only eases in once the transition says so (flow-unfreeze) */
  let unfrozen = false;
  function unfreeze() {
    if (unfrozen) return;
    unfrozen = true;
    const k0 = performance.now();
    (function step() {
      const t = Math.min(1, (performance.now() - k0) / 1000);
      deckK = 1 - Math.pow(1 - t, 4);
      if (t < 1) requestAnimationFrame(step);
    })();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    removeEventListener('wheel', onWheel);
    removeEventListener('keydown', onKey);
    removeEventListener('resize', measure);
    ruler.destroy();          // it listens for resize of its own
  }

  function stopInput() {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onUp);
    removeEventListener('wheel', onWheel);
    removeEventListener('keydown', onKey);
    removeEventListener('resize', measure);
  }

  return {
    ready,
    unfreeze,
    destroy,
    /* re-tap the active tab: glide the deck (target only, cur lerps) back to the first work —
       the same landing spot the hand-over uses for idx 0 */
    reset() { if (bounds[0]) target = bounds[0].left + bounds[0].width * 0.5 - innerWidth * 0.5; },
    /* Hand over the work actually centred on screen — the deck card whose box sits under the middle —
       NOT the ruler's index. The ruler reads a lap fraction (f % lapWorks), and the deck loops every
       lapWorks works, which is a hair more than the archive holds; across that seam (around work 0) a
       sub-pixel wobble in f can wrap the lap and pull the ruler's answer a work or two off the card the
       eye reads as centred. On the desktop f lands clean and the two agree, but a phone's rounding does
       not, and a flow<->view round-trip then drifts the centred work by that gap each pass. The visual
       centre is seam-free by construction — it is a card index, 0..N-1, never wrapped — so handing it
       over makes the next view open on the very painting flow was showing, and the round-trip holds.
       (The ruler still takes the lap fraction for its own month label, which wants the smooth read.) */
    activeIndex() {
      const cx = innerWidth * 0.5;
      let best = 0, bd = Infinity;
      for (let i = 0; i < items.length; i++) {
        const p = items[i].el._pos;
        if (!p) continue;
        const mid = p[0] + bounds[i].width * 0.5;
        const dd = Math.abs(mid - cx);
        if (dd < bd) { bd = dd; best = i; }
      }
      return best;
    },
    /* Leaving, the deck holds still to be measured, then hands its paintings to the next view. It
       does NOT fold first: each painting carries its deck angle into the flight and unwinds to flat
       as it travels (app.js bakes _roty into the flip) — the reverse of arriving, where they flew in
       flat and the deck fanned open. Folding first, then flying, read as two moves; this is one. */
    freeze() {
      stopInput();
      cancelAnimationFrame(raf);   // stop the deck's motion so the measured rects do not drift
      target = cur;
    },
    /* leaving for About, whose curtain has no slots to receive the paintings. The same move as
       leaving for the timeline or the index — each painting turns flat as it travels — only with
       nowhere to land, so it slides out below instead: the reverse of arriving into flow, where the
       slots with no painting of their own rise up from under the fold. Turn and travel as one. */
    exit(done) {
      stopInput();
      cancelAnimationFrame(raf);   // our per-card transition owns the transforms now, not place()
      target = cur;
      view.style.zIndex = '30';
      const H = innerHeight * 1.1;
      let n = 0;
      for (const it of items) {
        const p = it.el._pos;
        if (!p) continue;
        const r = it.el.getBoundingClientRect();
        if (r.bottom < -60 || r.top > innerHeight + 60 || r.right < -60 || r.left > innerWidth + 60) continue;
        const delay = n++ * 40;
        it.el.style.transition =
          'transform 900ms var(--ease-travel) ' + delay + 'ms, opacity 600ms ease ' + (delay + 260) + 'ms';
        it.el.style.transform =
          'translate3d(' + p[0] + 'px,' + (p[1] + H) + 'px,' + p[2] + 'px) rotateY(0deg)';
        it.el.style.opacity = '0';
      }
      ruler.el.style.transition = 'opacity 300ms ease 500ms';   // let the chrome go with them
      ruler.el.style.opacity = '0';
      setTimeout(() => { destroy(); done(); }, 1000);
    },
  };
}

/* -------- smooth scroll: same machinery as the detail panel, so the pages share one feel.
   It used to move the content with a transform and hand-roll the drag and the fling, which
   on a phone meant a scroll that neither carried the system's momentum nor bounced at the
   ends — beside the detail's native scroll it read as a different page. The container scrolls
   natively now: the finger gets the OS's own physics, and the wheel gets the same lerp the
   detail uses. (The rows used to tilt with the scroll; that is gone — the grid sits flat.) -------- */
function smoothTilt(outer, content) {
  let over = 0, lastTs = 0, raf = 0;
  const OVER_MAX = 60;   // the give at an end, px
  const limit = () => Math.max(0, outer.scrollHeight - outer.clientHeight);

  /* the browser scrolls the page — native, instant, with the OS's own momentum (no lerp, no lag). We
     only take the wheel AT an end, where a desktop's native scroll would stop dead: the extra push
     stretches the content and springs back. (A phone overscrolls natively, so touch is left alone.) */
  function onWheel(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;   // + = down
    const max = limit();
    const past = (raw < 0 && outer.scrollTop <= 0) || (raw > 0 && outer.scrollTop >= max - 1);
    if (!past) return;                        // in range: let the browser scroll
    over -= raw * 0.2 * (1 - Math.abs(over) / OVER_MAX);   // progressive resistance
    over = Math.max(-OVER_MAX, Math.min(OVER_MAX, over));
    e.preventDefault();
  }

  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    /* the end stretch springs back to the edge, riding the content's own transform */
    if (over !== 0) {
      over += (0 - over) * 0.14 * ratio;
      if (Math.abs(over) < 0.3) over = 0;
      content.style.transform = over ? 'translateY(' + over.toFixed(1) + 'px)' : '';
    }
    raf = requestAnimationFrame(frame);
  }

  outer.addEventListener('wheel', onWheel, { passive: false });
  raf = requestAnimationFrame(frame);
  return {
    scrollTo(y) { outer.scrollTop = Math.max(0, Math.min(limit(), y)); },
    glideTo(y) {
      const t = Math.max(0, Math.min(limit(), y));
      try { outer.scrollTo({ top: t, behavior: 'smooth' }); } catch (_) { outer.scrollTop = t; }
    },
    measure() {},
    destroy() {
      cancelAnimationFrame(raf);
      outer.removeEventListener('wheel', onWheel);
    },
  };
}

/* ---------------- INDEX: collage grid, 12 per row ---------------- */

/* the sort the viewer last chose, kept for the session so it survives leaving the index and
   coming back. date-desc (newest first) is the archive's own order — the default. */
let indexSort = 'date-desc';
let indexColor = null;   // a chosen colour in Color mode (a bucket key), or null for the whole spectrum
let indexSizeDir = 'desc';   // Size: 'desc' large first, 'asc' small first — clicking Size again flips it
const INDEX_SORTS = [
  ['date-desc', 'Latest'],
  ['date-asc', 'Oldest'],
  ['color', 'Color'],
  ['size', 'Size'],
];

/* the colour wheel cut into named wedges, each with a swatch colour to stand for it and the hue
   span it covers. Red wraps the 360/0 seam. A near-grey painting carries no hue and is its own
   bucket (neutral). Order here is the order the swatches show — the same walk round the wheel the
   sort takes. */
const COLOR_BUCKETS = [
  ['red', '#cf4a3c', 342, 15],
  ['orange', '#d9843a', 15, 45],
  ['yellow', '#d8bf46', 45, 70],
  ['green', '#5a9e55', 70, 165],
  ['blue', '#4676ac', 165, 255],
  ['purple', '#8a5aa8', 255, 300],
  ['pink', '#cc6a9c', 300, 342],
  ['neutral', '#b9b3ab', -1, -1],
];
function colorBucket(hsl) {
  if (hsl.s < 0.12) return 'neutral';
  const h = hsl.h;
  for (const [key, , lo, hi] of COLOR_BUCKETS) {
    if (lo < 0) continue;
    if (lo > hi ? (h >= lo || h < hi) : (h >= lo && h < hi)) return key;   // lo>hi = the red wrap
  }
  return 'neutral';
}

/* a colour's hue/saturation/lightness, for the colour sort */
function hslOf(hex) {
  const h6 = String(hex || '').replace('#', '');
  if (h6.length < 6) return { h: 0, s: 0, l: 0.5 };
  const r = parseInt(h6.slice(0, 2), 16) / 255;
  const g = parseInt(h6.slice(2, 4), 16) / 255;
  const b = parseInt(h6.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s, l };
}

function hoOf(s) {
  const m = /(\d+)\s*호/.exec(String(s.size || ''));
  return m ? parseInt(m[1], 10) : -1;
}

/* return the slides as {s, oi} pairs (oi = the work's place in the archive's own order, which the
   deck and the hand-over both count in — so it must ride along, sorted or not) in the chosen order */
function orderIndex(slides, colors, mode, sizeDir) {
  const pairs = slides.map((s, oi) => ({ s, oi }));
  if (mode === 'date-asc') {
    return pairs.sort((a, b) =>
      String(a.s.date || '').localeCompare(String(b.s.date || '')) || a.oi - b.oi);
  }
  if (mode === 'size') {
    return pairs.sort((a, b) => {
      const ha = hoOf(a.s), hb = hoOf(b.s);
      const am = ha < 0, bm = hb < 0;            // a work with no 호 sits at the end, either way
      if (am !== bm) return am ? 1 : -1;
      const cmp = sizeDir === 'asc' ? ha - hb : hb - ha;   // small first, or large first
      return cmp || a.oi - b.oi;
    });
  }
  if (mode === 'color') {
    const lit = pairs.map((p) => {
      const c = colors[String(p.s.image || '').split('/').pop()] || '#c9c9c9';
      return Object.assign(p, { c: hslOf(c) });
    });
    return lit.sort((a, b) => {
      const ag = a.c.s < 0.12, bg = b.c.s < 0.12;   // near-greys carry no hue — gather them at the end
      if (ag !== bg) return ag ? 1 : -1;
      if (ag) return a.c.l - b.c.l || a.oi - b.oi;
      return a.c.h - b.c.h || a.c.l - b.c.l || a.oi - b.oi;   // round the wheel, light within a hue
    });
  }
  return pairs;   // date-desc = the archive's own order
}

function mountIndex(view, slides, aspects, onOpen, opts) {
  const colors = (opts && opts.colors) || {};
  const outer = el('div', 'agrid');
  const content = el('div', 'agrid__in');
  outer.appendChild(content);
  view.appendChild(outer);
  let orderedIds = [];   // the ids in the order they are shown — handed to the detail for prev/next

  /* the desktop cell is the deck's own 20rem card width — fixed px — so there the flip never resizes. A phone
     holds four across for a denser overview. The four-column cell is smaller than the deck card's angled-and-
     foreshortened on-screen width, so the flip un-foreshortens (grows) as it also shrinks to the cell — a
     small mid-flight bump is the cost of the denser grid. (Two columns removed the bump, the cell being wider
     than the foreshortened card so the resize ran one way; the trade is fewer works in view.) */
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
  const mobile = innerWidth <= 699;
  const cardW = 20 * rem;
  const colGap = (mobile ? 1 : 2) * rem;
  const perRow = mobile ? 4 : Math.max(1, Math.floor((innerWidth - 4 * rem + colGap) / (cardW + colGap)));
  const gridCols = mobile ? 'repeat(4,1fr)' : 'repeat(' + perRow + ',' + Math.round(cardW) + 'px)';
  const years = yearsByMonth(slides);

  /* the grid is torn down and laid out again on every sort change; the month bands only mean
     anything when the works run in time, so they show for the date orders and not the others */
  function bucketOfPair(p) {
    const c = colors[String(p.s.image || '').split('/').pop()] || '#c9c9c9';
    return colorBucket(hslOf(c));
  }
  /* one delegated click for the whole grid — not a listener per cell (there are hundreds), which was
     part of what made a fresh grid stall the main thread as it arrived */
  content.addEventListener('click', (e) => {
    const cell = e.target.closest('.agrid__cell');
    if (!cell || !content.contains(cell)) return;
    const s = slides[parseInt(cell.dataset.index, 10)];
    const box = cell.querySelector('.lse-slot');
    if (s && box) onOpen(s, box);
  });

  let buildRAF = 0;
  function buildGrid() {
    if (buildRAF) { cancelAnimationFrame(buildRAF); buildRAF = 0; }
    let pairs = orderIndex(slides, colors, indexSort, indexSizeDir);
    if (indexSort === 'color' && indexColor) pairs = pairs.filter((p) => bucketOfPair(p) === indexColor);
    orderedIds = pairs.map((p) => p.s.id);   // the order (and colour filter) the detail pages through
    const dateMode = indexSort.slice(0, 4) === 'date';
    const withLabels = dateMode || indexSort === 'size';   // months in time, 호 by size, nothing by colour
    content.replaceChildren();
    let row = null, seenGroup = '';
    const buildCell = (p, pos) => {
      const s = p.s;
      if (pos % perRow === 0) {
        row = el('div', 'agrid__row lse-row');
        row.style.gridTemplateColumns = gridCols;   // fixed-width columns, matched to the timeline card
        content.appendChild(row);
      }
      const cell = el('article', 'agrid__cell lse-card');
      cell.dataset.index = String(p.oi);       // the archive-order index the hand-over reads
      const name = String(s.image || '').split('/').pop();
      const box = el('div', 'agrid__media lse-slot');
      box.dataset.id = s.id || '';
      box.style.aspectRatio = String(aspects[name] || 1);
      const frame = el('div', 'lse-frame');
      frame.dataset.id = s.id || '';
      const img = el('img');
      img.src = thumb(s.image, 300);
      img.loading = pos < perRow * 3 ? 'eager' : 'lazy';
      img.draggable = false;
      gateLoad(img);
      frame.appendChild(img);
      box.appendChild(frame);
      cell.appendChild(box);
      /* the band a work opens: its month (with a year under it) in the date orders, its canvas 호 in
         Size. One is written per run, at the first work of the run. */
      let groupKey = '', bandText = '', bandYear = '';
      if (dateMode) {
        const mo = month(s);
        if (mo) {
          groupKey = 'm:' + mo; bandText = mo;
          const own = /^(\d{4})/.exec(String(s.date || ''));
          bandYear = (own && own[1]) || years[mo] || '2026';   // this work's year, else the month's
        }
      } else if (indexSort === 'size') {
        const ho = hoOf(s);
        if (ho > 0) { groupKey = 'h:' + ho; bandText = ho + '호'; }
      }
      if (withLabels && groupKey && groupKey !== seenGroup) {
        seenGroup = groupKey;
        const lbl = el('div', 'agrid__month');
        const rev = el('div', 'dt-reveal');
        const txt = el('div', 'label', bandText);
        txt.dataset.year = bandYear;   // the ::after only shows when this is non-empty (date only)
        rev.appendChild(txt);
        lbl.appendChild(rev);
        cell.appendChild(lbl);
      }
      row.appendChild(cell);
    };
    /* build the fold's worth now — plus down to the work the deck handed over, so the scroll that
       lands on it has real layout — and hand the rest off to later frames, so arriving at the grid
       does not block the main thread through the flip that carries the paintings in */
    const N = pairs.length;
    const handoff = parseInt(document.body.dataset.index, 10) || 0;
    const targetPos = handoff > 0 ? pairs.findIndex((p) => p.oi === handoff) : 0;
    const first = Math.min(N, Math.max(perRow * 5, (targetPos < 0 ? 0 : targetPos) + perRow * 2));
    let pos = 0;
    for (; pos < first; pos++) buildCell(pairs[pos], pos);
    if (pos < N) {
      const step = () => {
        const end = Math.min(N, pos + perRow * 6);
        for (; pos < end; pos++) buildCell(pairs[pos], pos);
        buildRAF = pos < N ? requestAnimationFrame(step) : 0;
      };
      buildRAF = requestAnimationFrame(step);
    }
  }

  buildGrid();

  /* the sort control: a row of labels, the chosen one lit; and — in Color — a palette below it,
     one swatch per colour the archive actually holds, that filters the grid down to that colour */
  const bar = el('div', 'agrid-sort');
  const row1 = el('div', 'agrid-sort__row');
  /* a black capsule travels to whichever option is chosen — the same drop as the bottom menu,
     drawn thin as it crosses and round where it lands — and the option it sits on turns white */
  const drop = el('div', 'agrid-sort__drop');
  const blob = el('div', 'agrid-sort__blob');
  drop.appendChild(blob);
  row1.appendChild(drop);
  const btns = INDEX_SORTS.map(([mode, lbl]) => {
    const b = el('button', 'agrid-sort__btn label', lbl);
    b.type = 'button';
    b.dataset.mode = mode;
    b.addEventListener('click', () => setSort(mode));
    row1.appendChild(b);
    return b;
  });
  bar.appendChild(row1);

  /* the swatches: one per colour the archive actually holds, in wheel order. No All — none chosen
     already means the whole spectrum, and clicking the lit one clears it. */
  const present = new Set(slides.map((s) => {
    const c = colors[String(s.image || '').split('/').pop()] || '#c9c9c9';
    return colorBucket(hslOf(c));
  }));
  /* the palette is its own capsule, floated below the sort bar — stretching the sort bar to hold it
     read as cheap, so it stands apart */
  const pal = el('div', 'agrid-pal');
  const swBtns = COLOR_BUCKETS.filter(([key]) => present.has(key)).map(([key, hex]) => {
    const b = el('button', 'agrid-sw');
    b.type = 'button';
    b.dataset.bucket = key;
    b.style.background = hex;
    b.title = key;
    b.addEventListener('click', () => setColor(key));
    pal.appendChild(b);
    return b;
  });
  /* On a phone the touch fling scrolls on the compositor and starves the main thread, so moving the
     bar per-frame in script judders. There the bar rides INSIDE the scroller as position:sticky
     (compositor) — mobile Safari has no scroll-timeline here, so .agrid carries no perspective and
     sticky composites cleanly. On the desktop the bar stays fixed and script tracks the scroll. */
  const isMobile = matchMedia('(max-width:699px)').matches;
  let stick = null;
  if (isMobile) {
    stick = el('div', 'agrid__stick');
    stick.appendChild(bar);
    stick.appendChild(pal);
    outer.insertBefore(stick, content);
  } else {
    view.appendChild(pal);
    view.appendChild(bar);
  }

  /* the drop travels to the chosen option, drawing itself thin across the gap and rounding out
     where it lands — the bottom menu's move, scaled to a word. It resizes to each option, since
     Latest and Size are not the same width. */
  let blobAt = null, blobAnim = null;
  function placeBlob(animate) {
    const active = row1.querySelector('.agrid-sort__btn.is-on');
    if (!active) return;
    const rr = row1.getBoundingClientRect(), ar = active.getBoundingClientRect();
    if (!ar.width) return;
    const to = { x: ar.left - rr.left, y: ar.top - rr.top, w: ar.width, h: ar.height };
    const from = blobAt; blobAt = to;
    if (blobAnim) { blobAnim.cancel(); blobAnim = null; }
    blob.style.width = to.w + 'px';
    blob.style.height = to.h + 'px';
    const rest = 'translate3d(' + to.x + 'px,' + to.y + 'px,0) scale(1,1)';
    if (!animate || !from) { blob.style.transform = rest; return; }
    const dx = to.x - from.x, mid = from.x + dx * 0.5;
    const stretch = 1 + Math.min(Math.abs(dx) / 200, 0.5);
    blob.style.transform = rest;
    blobAnim = blob.animate([
      { transform: 'translate3d(' + from.x + 'px,' + from.y + 'px,0) scale(1,1)' },
      { transform: 'translate3d(' + mid + 'px,' + to.y + 'px,0) scale(' + stretch + ',.82)', offset: 0.42 },
      { transform: rest },
    ], { duration: 460, easing: 'cubic-bezier(.32,.9,.24,1)', fill: 'both' });
    blobAnim.onfinish = () => { if (blobAnim) { blobAnim.cancel(); blobAnim = null; } };
  }

  const sizeBtn = btns.find((b) => b.dataset.mode === 'size');
  function paintBar() {
    btns.forEach((b) => b.classList.toggle('is-on', b.dataset.mode === indexSort));
    /* Size shows its direction while it is the one in use — an arrow that flips on the repeat click */
    if (sizeBtn) sizeBtn.textContent = indexSort === 'size' ? ('Size ' + (indexSizeDir === 'asc' ? '↑' : '↓')) : 'Size';
    pal.classList.toggle('is-open', indexSort === 'color');   // the palette shows only in Color
    swBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.bucket === indexColor));
  }
  paintBar();

  const wm = document.querySelector('.wordmark');
  const STICKY_TOP = 18;   // where the desktop bar catches near the top — a gap, not flush against the edge

  /* DESKTOP: the title and bar move by `translate` each frame, tracking the wheel scroll and catching
     near the top. The grid scrolls on the compositor; moving them by `top` (a layout property, on the
     main thread) would stutter against it, so they move by `translate`, which the compositor draws.
     (A phone does none of this in script — the touch fling starves the main thread, so the bar is
     position:sticky in the scroller and the title fades on a scroll-threshold toggle; see .agrid__stick
     and body.index-scrolled. The bar's rest offset there is a CSS margin, not a measured one.) */
  let frameRAF = 0, lastS = -1, frame0 = null, wmFoot = null, barH = null, onScroll = null;
  function frameLoop(ts) {
    if (frame0 === null) frame0 = ts;
    const settling = ts - frame0 < 1700;   // the wordmark's rise lasts 1.5s
    const s = outer.scrollTop;
    if (s === lastS && !settling) { frameRAF = requestAnimationFrame(frameLoop); return; }
    lastS = s;
    if (wm) wm.style.translate = '0px ' + (-s) + 'px';   // the title slides up and out with the scroll
    if (settling) {   // the wordmark may still be riding in — keep reading its rest foot (undo the scroll)
      wmFoot = wm ? wm.getBoundingClientRect().bottom + s : 0;
      if (barH === null) { const h = bar.getBoundingClientRect().height; if (h) barH = h; }
    }
    const restTop = Math.round((wmFoot || 0) + 16);
    bar.style.top = restTop + 'px';
    const off = Math.max(STICKY_TOP - restTop, -s);      // follow the title, then catch at STICKY_TOP
    bar.style.translate = '0px ' + off + 'px';
    if (barH !== null) { pal.style.top = (restTop + barH + 10) + 'px'; pal.style.translate = '0px ' + off + 'px'; }
    frameRAF = requestAnimationFrame(frameLoop);
  }
  function onResize() {
    wmFoot = null; barH = null; frame0 = null; lastS = -1;
    placeBlob(false);
  }
  if (isMobile) {
    /* the title slides up and fades as the grid scrolls — a threshold toggle (CSS), not a per-frame
       position, so nothing tracks the fling on the starved main thread */
    onScroll = () => document.body.classList.toggle('index-scrolled', outer.scrollTop > 24);
    outer.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  } else {
    frameRAF = requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(() => placeBlob(false));
  addEventListener('resize', onResize);

  const sc = smoothTilt(outer, content);

  /* re-lay after a sort change: the whole archive reorders and the scroll returns to the top, so a
     painting's old place and its new one rarely share the screen — flying each from one to the other
     would read as chaos, not order. Instead the new arrangement settles in from the top, a short
     stagger down the fold, so the change reads as the grid composing itself rather than a hard cut.
     Only the fold's worth is touched; everything below is off screen and needs no motion. */
  function relay() {
    const cells = content.querySelectorAll('.agrid__cell');
    const n = Math.min(cells.length, perRow * 5);
    for (let i = 0; i < n; i++) {
      cells[i].style.transition = 'none';
      cells[i].style.transform = 'translateY(24px) scale(.96)';
      cells[i].style.opacity = '0';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (let i = 0; i < n; i++) {
        const delay = Math.min(i, perRow * 3) * 16;   // cap the stagger so it never drags
        cells[i].style.transition =
          'transform .52s var(--ease-rise) ' + delay + 'ms, opacity .42s ease ' + delay + 'ms';
        cells[i].style.transform = '';
        cells[i].style.opacity = '';
      }
    }));
    setTimeout(() => {
      for (let i = 0; i < n; i++) {
        cells[i].style.transition = ''; cells[i].style.transform = ''; cells[i].style.opacity = '';
      }
    }, 1100);       // hand the cells back clean once they have landed
  }

  function setSort(mode) {
    if (mode === 'size' && indexSort === 'size') {
      indexSizeDir = indexSizeDir === 'desc' ? 'asc' : 'desc';   // click Size again: large <-> small
    } else if (mode === indexSort) {
      return;
    } else {
      indexSort = mode;
      if (mode !== 'color') indexColor = null;   // the palette only lives inside Color
    }
    const w0 = bar.getBoundingClientRect().width;   // width before the label may gain/lose its arrow
    buildGrid();
    paintBar();
    const w1 = bar.getBoundingClientRect().width;
    if (Math.abs(w1 - w0) > 1) {
      /* the box opens faster than the drop travels (240ms vs the flip's 460ms), so the room is
         already there by the time the chip slides into it */
      bar.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }],
        { duration: 240, easing: 'cubic-bezier(.4,0,.2,1)' });
    }
    placeBlob(true);      // the drop travels to the new option (and reshapes if Size gained its arrow)
    sc.measure();
    sc.glideTo(0);        // a new order has no "where you were" — glide to the top rather than cut to it
    relay();
  }

  function setColor(bucket) {
    indexColor = bucket === indexColor ? null : bucket;   // click the lit swatch again to clear it
    buildGrid();
    paintBar();
    sc.measure();
    sc.glideTo(0);
    relay();
  }

  /* the month labels ride up out of their masks on .is-in — without it they stay clipped */
  requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('is-in')));

  /* : scroll straight to the handed-over work's row, then report "page-done" */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    sc.measure();
    const idx = parseInt(document.body.dataset.index, 10);
    /* land the handed work at the SAME reference the departure reads it from — the middle of the screen
       (handOverIndex takes the row nearest innerHeight/2). Landing it at the top instead, as before, left
       a gap between the two: on the desktop the tall top padding hid it, but on a phone the arrival top and
       the departure middle sat a row apart, so every flow<->index round-trip drifted the centred work down
       a row. Same reference both ways = no drift. */
    const cell = idx > 0 ? content.querySelector('[data-index="' + idx + '"]') : null;
    if (cell) {
      const r = cell.getBoundingClientRect();
      sc.scrollTo(r.top - innerHeight / 2);
    }
    markReady();
  });
  function destroy() {
    cancelAnimationFrame(frameRAF);
    cancelAnimationFrame(buildRAF);
    if (onScroll) outer.removeEventListener('scroll', onScroll);
    document.body.classList.remove('index-scrolled');
    if (wm) { wm.style.top = ''; wm.style.translate = ''; }   // hand the shared wordmark back clean
    removeEventListener('resize', onResize);
    sc.destroy();
  }
  /* hold the grid still while the paintings are still flying in: an early scroll would carry the grid
     out from under the frames mid-flight (they ride their own fixed-layer transforms, not the scroll),
     and they read as floating. Programmatic scrollTop still works under overflow:hidden, so the arrival
     hand-over that lands you on the work you left is unaffected. */
  return { ready, destroy, measure: sc.measure, scrollTo: sc.scrollTo, reset: () => sc.glideTo(0),
    order: () => orderedIds.slice(),
    lockScroll: () => { outer.style.overflowY = 'hidden'; },
    unlockScroll: () => { outer.style.overflowY = ''; } };
}

/* One CV entry, whichever shape the admin saved it in.

     v1  {date:'2025.03', text:'…'}                  date and text, no group
     v2  {text:'…', note:'2024.10, 루브르박물관'}      the year and the place, run together
     v3  {text:'…', date:'2024.10', place:'루브르박물관'}

   The year and the place were one field, so a date could not be read, sorted or set apart from
   the venue it happened to sit beside. They part here, and the old rows part with them: a note
   splits at its first comma — the half that reads as a date is the date. */
function cvItem(it) {
  const o = it || {};
  const text = String(o.text ?? '').trim();
  let date = String(o.date ?? '').trim();
  let place = String(o.place ?? '').trim();

  if (!date && !place && o.note) {
    const note = String(o.note).trim();
    const cut = note.indexOf(',');
    const head = (cut < 0 ? note : note.slice(0, cut)).trim();
    const tail = cut < 0 ? '' : note.slice(cut + 1).trim();
    if (/\d/.test(head)) { date = head; place = tail; }   // "2024.10, 루브르박물관"
    else { place = note; }                                //  no year in it: it is all a place
  }
  return { text, date, place, textEn: String(o.textEn ?? '').trim() };
}

/* ---------------- ABOUT: black page, big lines, credits ---------------- */
/* One About block -> one element. The page is whatever list the admin composed, in that
   order: copy and pictures interleave freely, so nothing here may assume a fixed shape. */
function aboutBlock(b) {
  const text = (b.text || '').trim();

  if (b.type === 'image') {
    if (!b.src) return null;
    /* size and placement are the admin's: half fills half the column (the picture keeps its
       own ratio either way), and the alignment decides which edge the spare room goes to */
    const size = b.size === 'half' ? 'half' : 'full';
    const align = ['left', 'right'].includes(b.align) ? b.align : 'center';
    const fig = el('figure', 'about__fig about__fade about__fig--' + size + ' about__fig--' + align);
    const img = el('img');
    img.src = window.LSEData.asset(b.src);
    img.alt = b.caption || '';
    img.loading = 'lazy';
    img.addEventListener('load', () => img.classList.add('ok'));
    fig.appendChild(img);
    if ((b.caption || '').trim()) fig.appendChild(el('figcaption', null, b.caption));
    return fig;
  }

  /* a CV block, the shape a painter's profile actually has: a group (초대 개인전, 수상, 現…)
     naming a column of entries, each entry a line of its own — the work, then the year and
     the place set quietly beside it. */
  if (b.type === 'list') {
    const items = (b.items || []).map(cvItem).filter((it) => it.text || it.date || it.place);
    const label = (b.label || '').trim();
    if (!items.length && !label) return null;

    const al = ['left', 'center', 'right'].includes(b.align) ? b.align : 'left';
    const group = el('div', 'about__cv about__fade about__al--' + al);
    /* each field carries its own size, set as a multiple so the page's scale still holds. The
       block's old single `size` becomes the entry's — that is what it used to move. */
    const F = { sm: 0.72, md: 1, lg: 1.4 };
    const pick = (v, fallback) => F[v] || F[fallback] || 1;
    group.style.setProperty('--sz-label', pick(b.sizeLabel, 'md'));
    group.style.setProperty('--sz-t', pick(b.sizeText, b.size || 'md'));
    group.style.setProperty('--sz-n', pick(b.sizeNote, 'md'));

    /* Korean and English stand together, the English quietly under its Korean — a profile is
       read by both, and a group with no English simply has none. */
    const labelEn = (b.labelEn || '').trim();
    const head = el('div', 'about__cv-label label');
    if (label) head.appendChild(el('div', 'about__cv-label-ko', label));
    if (labelEn) head.appendChild(el('div', 'about__cv-label-en', labelEn));
    group.appendChild(head);

    const list = el('div', 'about__cv-items');
    items.forEach((it) => {
      const row = el('div', 'about__cv-row');
      const main = el('div', 'about__cv-main');
      if (it.text) main.appendChild(el('span', 'about__cv-t', it.text));
      if (it.textEn) main.appendChild(el('span', 'about__cv-en', it.textEn));
      row.appendChild(main);
      /* the year and the place travel together: on a phone they drop to a line of their own
         rather than each wrapping where it happens to run out of room */
      if (it.date || it.place) {
        const meta = el('div', 'about__cv-meta');
        if (it.date) meta.appendChild(el('span', 'about__cv-d', it.date));
        if (it.place) meta.appendChild(el('span', 'about__cv-n', it.place));
        row.appendChild(meta);
      }
      list.appendChild(row);
    });
    group.appendChild(list);
    return group;
  }

  if (!text) return null;   // an empty block leaves no gap behind

  /* copy blocks can be set left, centre or right. Left unset they keep the page as it was
     drawn: the title centred over the page, the body and the sign-off ranged left. */
  const ALIGN_DEFAULT = { title: 'center', text: 'left', thanks: 'left' };
  const al = ['left', 'center', 'right'].includes(b.align) ? b.align : ALIGN_DEFAULT[b.type];
  /* Size and leading are multiples of what the block is already set at, so the page's own
     scale — which is what makes it responsive — still holds underneath them. Size used to be
     three steps (작게 / 보통 / 크게); a headline that wanted to be a shade smaller had to jump
     28% to get there. It is a number now, and the leading, which could not be set at all, is
     one too: a title set large with a phrase on each line needs its lines closer than a title
     of one line does, and nothing in the admin could say so. */
  const SZ_WORD = { sm: 0.72, md: 1, lg: 1.4 };   // the three steps it had, kept readable
  const scale = (v) => {
    if (SZ_WORD[v] != null) return SZ_WORD[v];
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return null;
    return n > 5 ? n / 100 : n;                   // 110 means 110%
  };
  const aligned = (node) => {
    node.classList.add('about__al--' + al);
    const s = scale(b.size);
    if (s != null) node.style.setProperty('--sz', String(s));
    const lh = parseFloat(b.lh);
    if (isFinite(lh) && lh > 0) node.style.setProperty('--lh', String(lh));
    return node;
  };

  if (b.type === 'title') {
    const h1 = el('h1', 'about__title');
    text.split(/\n/).forEach((line) => {
      const m = el('div', 'about__line');
      m.appendChild(el('div', 'about__line-in', line));
      h1.appendChild(m);
    });
    return aligned(h1);
  }

  if (b.type === 'thanks') {
    const t = el('div', 'about__thanks');
    text.split(/\n/).forEach((line) => {
      if (line.trim()) t.appendChild(el('div', null, line));
    });
    return aligned(t);
  }

  /* What was typed is what is shown. Splitting on /\n+/ made one newline and three mean the
     same thing — every break became a new paragraph, and paragraphs are set 6rem apart, so a
     line simply carried onto the next line opened a gap the width of an empty line. A blank
     line between paragraphs is a paragraph break; a single newline is a break within one. */
  const p = aligned(el('div', 'about__intro about__fade'));   // 'text'
  text.split(/\n\s*\n+/).forEach((para) => {
    const node = el('p');
    para.split('\n').forEach((line, i) => {
      if (i) node.appendChild(document.createElement('br'));
      node.appendChild(document.createTextNode(line));
    });
    p.appendChild(node);
  });
  return p;
}

function mountAbout(view, content) {
  const wm = (content && content.wordmark) || {};
  /* the page lives in content.json, composed in the admin — it is the only source */
  const blocks = (content && content.blocks && content.blocks['/about']) || [];

  const page = el('div', 'about');
  const maskOuter = el('div', 'about__mask');
  const maskInner = el('div', 'about__mask-in');
  const scroller = el('div', 'about__scroll');

  const head = el('div', 'about__head');
  const l1 = el('div', 'label dt-reveal');
  l1.appendChild(el('div', null, '(' + (wm.l2 || 'LSE') + ')'));
  const l2 = el('div', 'label dt-reveal');
  l2.appendChild(el('div', null, '(25-26)'));
  head.appendChild(l1);
  head.appendChild(l2);
  scroller.appendChild(head);

  blocks.forEach((b) => {
    const node = b && aboutBlock(b);
    if (!node) return;
    /* the space under a block belongs to every kind of block, not just the copy — set it here
       rather than in each branch, so a picture and a CV group answer to the same control */
    const gap = ['none', 'sm', 'md', 'lg', 'xl'].includes(b.gap) ? b.gap : 'md';
    node.classList.add('about__gap--' + gap);
    scroller.appendChild(node);
  });

  /* Noun Project attribution (CC BY 3.0 — the plan's only allowed credit) */
  const cred = el('div', 'about__credits label');
  [['timeline', 'Justin Blake', '3643975'], ['flow', 'Abdul Matic', '7813263'],
   ['collage', 'Mustofa Bayu', '6753741'], ['profile', 'Evan Shuster', '139147']]
    .forEach(([name, author, id]) => {
      cred.appendChild(el('div', null,
        '"' + name + '" by ' + author + ' — Noun Project (nounproject.com/icon/' + id + ') / CC BY 3.0'));
    });
  scroller.appendChild(cred);

  maskInner.appendChild(scroller);
  maskOuter.appendChild(maskInner);
  page.appendChild(maskOuter);
  view.appendChild(page);

  const sc = smoothTilt(maskInner, scroller);

  /* each block rises in as it scrolls into view — revealed once its top climbs past ~88% up the
     scroller. A sweep, not a one-shot observer: a fast throw or a jump to the bottom would let an
     observer miss a block it never saw cross, leaving it blank. Anything at or above the line
     counts as seen, so a skipped block is caught the moment the scroll settles. */
  const fades = [].slice.call(scroller.querySelectorAll('.about__fade'));
  const revealSeen = () => {
    const top0 = maskInner.getBoundingClientRect().top;
    const line = maskInner.clientHeight * 0.88;
    for (let k = 0; k < fades.length; k++) {
      const n = fades[k];
      if (n.classList.contains('is-seen')) continue;
      if (n.getBoundingClientRect().top - top0 < line) n.classList.add('is-seen');
    }
  };

  /* The wordmark is fixed and About scrolls its own type under it, so the two ran through each
     other. Hiding it outright left the top of the page bare — it belongs there while the page
     is at rest. It steps aside only once the copy starts climbing towards it. */
  const onScroll = () => {
    document.body.classList.toggle('about-scrolled', maskInner.scrollTop > 24);
    revealSeen();
  };
  maskInner.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const destroy = sc.destroy;
  sc.destroy = () => {
    maskInner.removeEventListener('scroll', onScroll);
    document.body.classList.remove('about-scrolled');
    destroy();
  };

  requestAnimationFrame(() => requestAnimationFrame(() => {
    view.classList.add('is-in');
    revealSeen();                    // curtain is opening: reveal whatever the first screen shows
    setTimeout(() => sc.measure(), 600);
  }));
  sc.reset = () => sc.glideTo(0);   // re-tap the active tab: glide back to the top
  return sc;
}

window.LSEViews = { mountFlow, mountIndex, mountAbout };
})();
