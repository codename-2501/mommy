/* LSE GALLERY — timeline carousel.
   Per-slide wrap (the track is never one huge moving layer) and a lerp-smoothed position.
   The ruler beneath it is not this view's own any more: it is a piece of its own (ruler.js),
   told once a frame which work sits under the centre line. The flow deck carries the same one. */
(() => {
'use strict';

/* Motion, tuned against this archive's own images and our own feel.
   The carousel never snaps: the drawn position chases the target every frame, so a flick
   glides to a stop instead of locking to a slide. */
const LERP = 0.12;              // how far the drawn position closes on the target, per frame
const CLICK_SLOP = 8;           // px: a pointerup that moved less than this is a click
const KEY_STEP = 140;           // ArrowUp/Down travel
const WHEEL_MULT = /Win/.test(navigator.platform) ? 1 : 0.45;          // wheel feels lighter on mac

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function rootPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
}

function isSmall() {
  return matchMedia('(max-width:699px)').matches;
}

const slideMonth = (s) => window.LSEData.month(s);   // date first — see site/data.js

function buildItem(s, i, ratio) {
  const art = el('article', 'car-item lse-card');
  const entr = el('div', 'car-entr');     // entrance rise (CSS transition, Y only)
  const content = el('div', 'car-content');
  const num = el('div', 'car-label car-label--top');
  num.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: String(i + 1) }));
  /* Flip: an unclipped slot (.lse-slot) holding the clipping frame
     (.lse-frame) that travels between views — both keyed by the work's id */
  const box = el('div', 'car-media lse-slot');
  box.dataset.id = s.id || '';
  box.style.aspectRatio = String(ratio || 1);
  const frame = el('div', 'lse-frame');
  frame.dataset.id = s.id || '';
  const img = el('img');
  /* carousel-size webp */
  const file = String(s.image || '').split('/').pop();
  img.src = file ? '/thumbs/600/' + encodeURIComponent(file) : '';
  img.addEventListener('error', () => { img.src = s.image || ''; }, { once: true });
  img.alt = s.title || s.bottom || '';
  img.loading = i < 8 ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
  frame.appendChild(img);
  box.appendChild(frame);
  const cap = el('div', 'car-label car-label--bottom');
  cap.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: s.bottom || '' }));
  content.appendChild(num);
  content.appendChild(box);
  content.appendChild(cap);
  entr.appendChild(content);
  art.appendChild(entr);
  return art;
}

/* consecutive-month groups: [{text, startSlide, slides}] */
function mount(view, slides, aspects, opts, onOpen) {
  if (!slides.length) return null;

  const wrap = el('div', 'carousel');
  const track = el('div', 'carousel__track');
  wrap.appendChild(track);
  view.appendChild(wrap);
  const ruler = window.LSERuler.create(view, slides, Object.assign({ monthOf: slideMonth }, opts || {}));

  const ratios = slides.map((s) => {
    const name = String(s.image || '').split('/').pop();
    return aspects[name] || 1;
  });

  /* single set of slides — each one wraps around individually every frame
     (the track never becomes one huge moving layer, which would blow up the composite) */
  let moved = false;
  const items = [], contents = [];
  slides.forEach((s, i) => {
    const item = buildItem(s, i, ratios[i]);
    item.addEventListener('click', () => { if (!moved) onOpen(s, item); });
    track.appendChild(item);
    items.push(item);
    contents.push(item.firstChild.firstChild);   // .car-entr > .car-content
  });
  const onScreen = new Uint8Array(items.length);
  const placed = new Uint8Array(items.length);   // has this slide ever been given a transform?

  /* ---------- geometry ---------- */
  let rem = rootPx();
  let step = 0, half = 0;
  /* ---------- motion ---------- */
  let target = 0, cur = 0, diff = 0;
  let dragging = false, startX = 0, startY = 0, startTarget = 0, raf = 0;
  let lastTs = 0;
  let active = -1;                          // centred slide

  function mult() { return isSmall() ? 3.6 : 2.2; }   // drag travel per pixel dragged

  function wrapIdx(i) { const n = items.length; return ((i % n) + n) % n; }

  /* the centred slide keeps its flip hook even when it drifts off-screen) */
  function markActive() {
    if (!step) return;
    const a = wrapIdx(Math.round(cur / step));
    if (a === active) return;
    if (items[active]) items[active].classList.remove('lse-centred');
    items[a].classList.add('lse-centred');
    active = a;
  }

  function resize() {
    rem = rootPx();
    const slideW = (isSmall() ? 20 : 28.1) * rem;
    const gap = (isSmall() ? 1.2 : 2) * rem;
    const prevStep = step;
    step = slideW + gap;
    half = slides.length * step;
    if (prevStep) { const k = step / prevStep; target *= k; cur *= k; }
    ruler.resize();
  }

  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    cur += (target - cur) * LERP * ratio;
    cur = Math.round(cur * 100) / 100;
    diff = Math.round((cur - target) * 1000) / 1000;
    /* per-slide wrap: d = wrap(end - total, end, cur); x = -d */
    if (step) {
      const pad = 2 * rem;
      const slideW = step - ((isSmall() ? 1.2 : 2) * rem);
      /* skew with velocity. The phone used to be left out of it — but the carousel runs on its
         own lerp, not the system's scroll, so its frames keep coming there too. A phone's cards
         are smaller, so the same lean needs a little more angle to read. */
      const ry = 'rotateY(' + (diff * (isSmall() ? 0.07 : 0.045)) + 'deg)';
      for (let k = 0; k < items.length; k++) {
        const left = pad + k * step;
        const end = left + slideW;
        let d = (cur - (end - half)) % half;
        if (d < 0) d += half;
        d += end - half;                       // d in [end - half, end)
        const sx = left - d;                   // on-screen x of the slide
        const vis = sx > -step && sx < innerWidth + step;
        if (vis) {
          items[k].style.transform = 'translate3d(' + (-d) + 'px,0,0)';
          if (ry) contents[k].style.transform = ry;
          onScreen[k] = 1;
          placed[k] = 1;
        } else if (onScreen[k] || !placed[k]) {
          /* !placed: a slide that has never been positioned still sits at its natural flex
             spot — which is ON screen. Starting anywhere but slide 0 (the index handover)
             would leave it there, overlapping the slides that belong in that spot. */
          items[k].style.transform = 'translate3d(' + (-d) + 'px,0,0)';   // park just off-screen
          onScreen[k] = 0;
          placed[k] = 1;
        }
      }
    }
    markActive();
    /* The ruler and the paintings were drawn from different origins: the ruler placed its
       centre line at cur*scale + rulerWidth/2, while the painting under that line sits at
       cur + viewportWidth/2 — the same journey measured against two different rulers. The
       two drifted about five works apart, so the month over the line named a month whose
       paintings were already off the screen. The ruler is told the work the line is over. */
    ruler.update((cur + innerWidth * 0.5 - 2 * rem) / step, ratio);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* ---------- input ---------- */
  function onDown(e) {
    dragging = true; moved = false;
    startX = e.clientX; startY = e.clientY; startTarget = target;
    wrap.classList.add('is-active');
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > CLICK_SLOP) moved = true;
    target = startTarget - dx * mult();     // drag distance × travel multiplier
  }
  function onUp() {
    dragging = false;
    wrap.classList.remove('is-active');
  }
  function onWheel(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;   // detail owns the wheel
    // wheelDeltaY where the browser gives it (it is the smoother of the two signals)
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target += raw * WHEEL_MULT;
  }
  function nearestIdx() {
    return Math.round(target / step);
  }
  function onKey(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    if (document.activeElement && document.activeElement.nodeName === 'INPUT') return;
    if (e.key === 'ArrowUp') { target -= KEY_STEP; }
    else if (e.key === 'ArrowDown') { target += KEY_STEP; }
    else if (e.key === ' ') { e.preventDefault(); target += (innerHeight - 40) * (e.shiftKey ? -1 : 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); target = (nearestIdx() + 1) * step; }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); target = (nearestIdx() - 1) * step; }
  }
  wrap.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);   // window-level: no dead zone over the ruler
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('resize', resize);
  /* the incoming view jumps to the work the last one was on, THEN reports
     "page-done" — the transition only measures the flip once that jump has landed */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    resize();                                       // measure after the view is in the document
    const idx = parseInt(document.body.dataset.index, 10);
    if (idx > 0) { target = idx * step; cur = target; }
    markActive();
    /* entrance offsets — each item enters from y = viewportBottom - itemTop.
       item rects are safe to read: only children carry the entrance/wrap transforms */
    for (const item of items) {
      const top = item.getBoundingClientRect().top;
      item.firstChild.style.setProperty('--ey', Math.max(0, innerHeight - top + 40) + 'px');
    }
    markReady();
  });

  return {
    ready,
    activeIndex() { return step ? wrapIdx(Math.round(target / step)) : 0; },
    goTo(i) { target = i * step; cur = target; },   // instant jump (detail close sync)
    freeze() {                                      // halt drift + clear skew (flip measure)
      target = cur;
      for (let k = 0; k < contents.length; k++) contents[k].style.transform = '';
    },
    itemAt(i) { return items[i] || null; },
    destroy() {
      cancelAnimationFrame(raf);
      ruler.destroy();
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onUp);
      removeEventListener('wheel', onWheel);
      removeEventListener('keydown', onKey);
      removeEventListener('resize', resize);
    },
  };
}

window.LSECarousel = { mount };
})();
