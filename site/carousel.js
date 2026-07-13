/* LSE GALLERY — timeline carousel + ruler.
   Per-slide wrap (the track is never one huge moving layer), lerp-smoothed position,
   a canvas ruler of 8 ticks per painting, and a hover boost around the cursor. */
(() => {
'use strict';

/* Motion, tuned against this archive's own images and our own feel.
   The carousel never snaps: the drawn position chases the target every frame, so a flick
   glides to a stop instead of locking to a slide. */
const LERP = 0.12;              // how far the drawn position closes on the target, per frame
const CLICK_SLOP = 8;           // px: a pointerup that moved less than this is a click
const KEY_STEP = 140;           // ArrowUp/Down travel
const TICKS_PER_SLIDE = 8;      // ruler resolution: ticks between one painting and the next
const TICK_GAP = 12;            // px between ruler ticks
const TICK_MH = 11, TICK_MJH = 24, TICK_ALPHA = 0.22;   // minor / month tick, resting opacity
const HOVER_NEAR = 9 * TICK_GAP, HOVER_BOOST = 20, HOVER_FALL = 0.5;   // cursor swells the ruler
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
function monthGroups(slides) {
  const groups = [];
  slides.forEach((s, i) => {
    const mo = slideMonth(s);
    const last = groups[groups.length - 1];
    if (last && last.text === mo) { last.slides += 1; return; }
    groups.push({ text: mo, startSlide: i, slides: 1 });
  });
  return groups;
}

function mount(view, slides, aspects, years, onOpen) {
  if (!slides.length) return null;

  const wrap = el('div', 'carousel');
  const track = el('div', 'carousel__track');
  wrap.appendChild(track);
  const ruler = el('div', 'ruler');
  const canvas = el('canvas', 'ruler__canvas');
  const labels = el('div', 'ruler__labels');
  const labelTrack = el('div', 'ruler__track');
  labels.appendChild(labelTrack);
  ruler.appendChild(canvas);
  ruler.appendChild(labels);
  view.appendChild(wrap);
  view.appendChild(ruler);

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
  let step = 0, half = 0, scale = 1;
  const tickLen = slides.length * TICKS_PER_SLIDE;          // total ruler ticks (one copy)
  const rulerHalf = tickLen * TICK_GAP;
  const majors = new Uint8Array(tickLen);
  const groups = monthGroups(slides);
  for (const g of groups) majors[g.startSlide * TICKS_PER_SLIDE] = 1;

  function buildLabels() {
    labelTrack.replaceChildren();
    labelTrack.style.width = (rulerHalf * 2) + 'px';
    for (let copy = 0; copy < 2; copy++) {
      for (const g of groups) {
        if (!g.text) continue;
        const l = el('span', 'ruler__label label');
        l.textContent = g.text;
        const d = String(slides[g.startSlide].date || '');
        const y = /^(\d{4})/.exec(d);
        l.dataset.year = (y && y[1]) || years[g.text] || '2026';
        l.style.left = (copy * rulerHalf + g.startSlide * TICKS_PER_SLIDE * TICK_GAP) + 'px';
        labelTrack.appendChild(l);
      }
    }
  }

  /* ---------- the ruler's ticks, drawn on a canvas ---------- */
  let ctx = null, cw = 0, ch = 0, dpr = 1;
  let heights = new Float32Array(0);
  let baseIdx = null;
  let hover = false, hoverX = -1;

  function resizeCanvas() {
    cw = ruler.clientWidth; ch = ruler.clientHeight;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    heights = new Float32Array(Math.ceil(cw / TICK_GAP) + 4);
  }

  function fall(t) {                       // falloff: pow(1-t, 1/fall)
    const v = 1 - t;
    return v <= 0 ? 0 : Math.pow(v, 1 / HOVER_FALL);
  }

  function shiftHeights(q) {
    if (baseIdx === null) { baseIdx = q; return; }
    if (q === baseIdx) return;
    const d = q - baseIdx, p = heights.length;
    if (Math.abs(d) >= p) heights.fill(0);
    else if (d > 0) { heights.copyWithin(0, d, p); heights.fill(0, p - d, p); }
    else { heights.copyWithin(-d, 0, p + d); heights.fill(0, 0, -d); }
    baseIdx = q;
  }

  function drawTick(x, h, baseY, alpha) {
    ctx.globalAlpha = alpha;
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    /* flipped ruler (our layout): line hangs from the top edge */
    ctx.moveTo(px, baseY);
    ctx.lineTo(px, baseY + h);
    ctx.stroke();
  }

  function drawSticks(U, ratio) {
    if (!ctx || cw <= 0) return;
    ctx.clearRect(0, 0, cw, ch);
    let v = U % TICK_GAP;
    if (v < 0) v += TICK_GAP;
    const q = Math.floor((U - v) / TICK_GAP);
    const center = cw * 0.5;
    const centerIdx = Math.round((U + center) / TICK_GAP);   // the tick under the cursor line
    shiftHeights(q);
    const ease = LERP * ratio, easeC = 0.2 * ratio;
    for (let ox = -v, e = 0; ox <= cw + TICK_GAP; ox += TICK_GAP, e++) {
      const t = q + e;
      let mj = majors[((t % tickLen) + tickLen) % tickLen] === 1;
      const base = mj ? TICK_MJH : TICK_MH;
      let boost = 0;
      if (t === centerIdx) boost = 50 - base;
      else if (hover && hoverX >= 0) {
        const dx = Math.abs(ox - hoverX);
        if (dx < HOVER_NEAR) boost = HOVER_BOOST * fall(dx / HOVER_NEAR);
      }
      heights[e] += ((boost) - heights[e]) * (t === centerIdx ? easeC : ease);
      const h = base + heights[e];
      let alpha = TICK_ALPHA;
      if (t === centerIdx) {
        const p = Math.max(0, Math.min(1, (h - base) / Math.max(1, 50 - base)));
        alpha = TICK_ALPHA + p * (1 - TICK_ALPHA);
      }
      drawTick(ox, h, 0, alpha);
    }
    ctx.globalAlpha = 1;
  }

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
    scale = rulerHalf / half;               // ruler moves at ~1/3 carousel speed
    resizeCanvas();
    buildLabels();
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
      const ry = isSmall() ? null : 'rotateY(' + (diff * 0.045) + 'deg)';   // skew with velocity
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
       paintings were already off the screen. Anchor the ruler on the work the line is over. */
    const centerSlide = (cur + innerWidth * 0.5 - 2 * rem) / step;
    const rOff = centerSlide * TICKS_PER_SLIDE * TICK_GAP - ruler.clientWidth * 0.5;
    let lOff = rOff % rulerHalf;
    if (lOff < 0) lOff += rulerHalf;
    labelTrack.style.transform = 'translate3d(' + (-lOff) + 'px,0,0)';
    drawSticks(rOff, ratio);
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
  function onRulerEnter() { hover = true; }
  function onRulerLeave() { hover = false; hoverX = -1; }
  function onRulerMove(e) { hoverX = e.offsetX; }

  wrap.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);   // window-level: no dead zone over the ruler
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('resize', resize);
  ruler.addEventListener('mouseenter', onRulerEnter);
  ruler.addEventListener('mouseleave', onRulerLeave);
  ruler.addEventListener('mousemove', onRulerMove);
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
