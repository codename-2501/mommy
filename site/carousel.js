/* THE LOOKBACK — home carousel + timeline ruler.
   Physics, ruler geometry and effects ported 1:1 from the original component
   (drag ×2 / ×3.5 mobile, lerp .1, rotateY skew, 9 ticks per slide at 11px,
   centre cursor tick, hover boost, tick sound). */
(() => {
'use strict';

const LERP = 0.1;               // display position -> target, per 60fps frame
const CLICK_SLOP = 10;          // px: below this a pointerup is a click
const KEY_STEP = 120;           // ArrowUp/Down scroll amount (original: ±120)
const TICKS_PER_SLIDE = 9;      // ruler resolution (original: images*9)
const TICK_GAP = 11;            // lw 1 + gap 10
const TICK_MH = 12, TICK_MJH = 22, TICK_ALPHA = 0.25;
const HOVER_NEAR = 10 * TICK_GAP, HOVER_BOOST = 18, HOVER_FALL = 0.55;
const WHEEL_MULT = /Win/.test(navigator.platform) ? 0.9 : 0.4;

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

function slideMonth(s) {
  const m = /\(([^)]+)\)\s*$/.exec(String(s.bottom || ''));
  return m ? m[1].trim() : '';
}

function buildItem(s, i, ratio) {
  const art = el('article', 'car-item');
  const content = el('div', 'car-content');
  const num = el('div', 'car-label car-label--top');
  num.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: String(i + 1) }));
  const box = el('div', 'car-media');
  box.style.aspectRatio = String(ratio || 1);
  const img = el('img');
  img.src = s.image || '';
  img.alt = s.title || s.bottom || '';
  img.loading = i < 8 ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
  box.appendChild(img);
  const cap = el('div', 'car-label car-label--bottom');
  cap.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: s.bottom || '' }));
  content.appendChild(num);
  content.appendChild(box);
  content.appendChild(cap);
  art.appendChild(content);
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

  const audio = window.TLB_AUDIO || { on: false };
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

  let moved = false;
  const contents = [];            // .car-content per child, for the visible-only skew
  for (let copy = 0; copy < 2; copy++) {
    slides.forEach((s, i) => {
      const item = buildItem(s, i, ratios[i]);
      item.addEventListener('click', () => { if (!moved) onOpen(s); });
      track.appendChild(item);
      contents.push(item.firstChild);
    });
  }

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

  /* ---------- sticks canvas (ported from the original) ---------- */
  let ctx = null, cw = 0, ch = 0, dpr = 1;
  let heights = new Float32Array(0);
  let baseIdx = null;
  let centerPrev = null;
  const fxPool = [];
  let fxIdx = 0;
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

  function fall(t) {                       // original falloff: pow(1-t, 1/fall)
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

  function tickSound(idx) {
    if (centerPrev !== null && idx !== centerPrev && audio.on && !isSmall() && fxPool.length) {
      const a = fxPool[fxIdx++ % fxPool.length];
      a.currentTime = 0;
      a.play().catch(() => {});
    }
    centerPrev = idx;
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
    const centerIdx = Math.round((U + center) / TICK_GAP);
    shiftHeights(q);
    tickSound(centerIdx);
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

  /* ---------- motion (original: target/display lerp, no fling, no snap) ---------- */
  let target = 0, cur = 0, diff = 0;
  let dragging = false, startX = 0, startY = 0, startTarget = 0, raf = 0;
  let lastTs = 0;

  function mult() { return isSmall() ? 3.5 : 2; }

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
    const off = ((cur % half) + half) % half;
    track.style.transform = 'translate3d(' + (-off) + 'px,0,0)';
    if (!isSmall() && step) {
      /* original: content rotateY(velocity * .05deg) — visible items only */
      const ry = 'rotateY(' + (diff * 0.05) + 'deg)';
      const from = Math.max(0, Math.floor(off / step) - 1);
      const to = Math.min(contents.length - 1, Math.ceil((off + innerWidth) / step) + 1);
      for (let k = from; k <= to; k++) contents[k].style.transform = ry;
    }
    const rOff = cur * scale;
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
    target = startTarget - dx * mult();     // original: drag distance × multiplier
  }
  function onUp() {
    dragging = false;
    wrap.classList.remove('is-active');
  }
  function onWheel(e) {
    // original: i = wheelDeltaY || deltaY*-1; i *= 0.9(win)/0.4; x -= i
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target += raw * WHEEL_MULT;
  }
  function nearestIdx() {
    return Math.round(target / step);
  }
  function onKey(e) {
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
  requestAnimationFrame(resize);   // measure after the view is in the document

  for (let i = 0; i < 4; i++) fxPool.push(new Audio('/site/assets/fx.mp3'));

  /* entrance offsets — original: each item enters from y = viewportBottom - itemTop */
  requestAnimationFrame(() => {
    const base = track.getBoundingClientRect().top;
    for (const item of track.children) {
      item.style.setProperty('--ey', Math.max(0, innerHeight - (base + item.offsetTop) + 40) + 'px');
    }
  });

  return {
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

window.TLBCarousel = { mount };
})();
