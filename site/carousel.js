/* THE LOOKBACK — home carousel + top timeline ruler.
   Infinite loop (track duplicated 2x), pointer drag with inertia, snap,
   ruler labels move in sync (original behaviour, rebuilt from scratch). */
(() => {
'use strict';

const FRICTION = 0.94;          // inertia decay per frame
const SNAP_EASE = 0.12;         // approach factor toward target
const CLICK_SLOP = 6;           // px of movement that still counts as a click

function rootPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function slideMonth(s) {
  const m = /\(([^)]+)\)\s*$/.exec(String(s.bottom || ''));
  return m ? m[1].trim() : '';
}

/* one <article> cell */
function buildItem(s, i, ratio) {
  const art = el('article', 'car-item');
  const num = el('div', 'car-label car-label--top');
  num.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: s.top || String(i + 1) }));
  const box = el('div', 'car-media');
  box.style.aspectRatio = String(ratio || 1);
  const img = el('img');
  img.src = s.image || '';
  img.alt = s.title || s.bottom || '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  box.appendChild(img);
  const cap = el('div', 'car-label car-label--bottom');
  cap.appendChild(Object.assign(el('div', 'car-label__in'), { textContent: s.bottom || '' }));
  art.appendChild(num);
  art.appendChild(box);
  art.appendChild(cap);
  return art;
}

/* month labels: one per consecutive month run, at the run's start offset */
function monthMarks(slides, step, years) {
  const marks = [];
  let cur = null;
  slides.forEach((s, i) => {
    const mo = slideMonth(s);
    if (!mo || mo === cur) return;
    cur = mo;
    const d = String(s.date || '');
    const y = /^(\d{4})/.exec(d);
    marks.push({ x: i * step, text: mo, year: (y && y[1]) || years[mo] || '2026' });
  });
  return marks;
}

function mount(view, slides, aspects, years, onOpen) {
  if (!slides.length) return null;

  const wrap = el('div', 'carousel');
  const track = el('div', 'carousel__track');
  wrap.appendChild(track);
  const ruler = el('div', 'ruler');
  const canvas = el('canvas', 'ruler__canvas');
  const labels = el('div', 'ruler__labels');
  ruler.appendChild(canvas);
  ruler.appendChild(labels);
  view.appendChild(wrap);
  view.appendChild(ruler);

  let rem = rootPx();
  let slideW = 28.1 * rem, gap = 2 * rem, step = slideW + gap;
  let half = slides.length * step;

  const ratios = slides.map((s) => {
    const name = String(s.image || '').split('/').pop();
    return aspects[name] || 1;
  });

  /* two copies of every slide for the seamless loop */
  for (let copy = 0; copy < 2; copy++) {
    slides.forEach((s, i) => {
      const item = buildItem(s, i, ratios[i]);
      item.addEventListener('click', () => { if (!moved) onOpen(s); });
      track.appendChild(item);
    });
  }

  /* month labels, duplicated like the track */
  function buildLabels() {
    labels.replaceChildren();
    const marks = monthMarks(slides, step, years);
    for (let copy = 0; copy < 2; copy++) {
      for (const m of marks) {
        const l = el('span', 'ruler__label label');
        l.textContent = m.text;
        l.dataset.year = m.year;
        l.style.left = (copy * half + m.x) + 'px';
        labels.appendChild(l);
      }
    }
  }
  buildLabels();

  /* ---------- motion state ---------- */
  let x = 0, target = 0, vel = 0;
  let dragging = false, moved = false, lastPX = 0, dragTotal = 0, raf = 0;
  let snapped = false;

  function resize() {
    rem = rootPx();
    slideW = 28.1 * rem; gap = 2 * rem;
    const prevStep = step;
    step = slideW + gap;
    half = slides.length * step;
    if (prevStep) { x = x / prevStep * step; target = target / prevStep * step; }
    canvas.width = innerWidth;
    canvas.height = 60;
    buildLabels();
  }
  addEventListener('resize', resize);
  resize();

  function drawTicks(off) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    const minor = step / 8;
    const start = -((off % minor) + minor) % minor;
    for (let px = start; px < canvas.width; px += minor) {
      const abs = px + off;
      const atMajor = Math.abs(((abs % step) + step) % step) < 1;
      ctx.fillRect(Math.round(px), 0, 1, atMajor ? 22 : 10);
    }
  }

  function frame() {
    if (!dragging) {
      if (Math.abs(vel) > 0.15) {
        target += vel;
        vel *= FRICTION;
      } else if (!snapped) {
        target = Math.round(target / step) * step;   // snap to a slide boundary
        snapped = true;
      }
    }
    x += (target - x) * SNAP_EASE;
    const off = ((x % half) + half) % half;
    track.style.transform = 'translate3d(' + (-off) + 'px,0,0)';
    labels.style.transform = 'translate3d(' + (-off) + 'px,0,0)';
    drawTicks(off);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  /* ---------- input ---------- */
  wrap.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; snapped = false;
    lastPX = e.clientX; vel = 0; dragTotal = 0;
    wrap.classList.add('is-drag');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    lastPX = e.clientX;
    if (Math.abs(dx)) {
      target -= dx;
      vel = -dx;
      dragTotal += Math.abs(dx);
      if (dragTotal > CLICK_SLOP && !moved) {
        moved = true;
        // capture only once it IS a drag — capturing on pointerdown would
        // retarget the click away from the slide (clicks would never open)
        wrap.setPointerCapture(e.pointerId);
      }
    }
  });
  function release() {
    dragging = false;
    wrap.classList.remove('is-drag');
  }
  wrap.addEventListener('pointerup', release);
  wrap.addEventListener('pointercancel', release);
  addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    target += d; vel = 0; snapped = false;
    clearTimeout(mount._wt);
    mount._wt = setTimeout(() => { target = Math.round(target / step) * step; }, 180);
  }, { passive: true });

  return { destroy() { cancelAnimationFrame(raf); removeEventListener('resize', resize); } };
}

window.TLBCarousel = { mount };
})();
