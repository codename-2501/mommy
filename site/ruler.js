/* LSE GALLERY — the timeline ruler.

   A strip of ticks under the work: eight to a painting, a taller one where a month begins,
   and the month's name written above it. The tick under the centre line stands up and darkens
   — that is where you are in the archive's time.

   It lived inside the carousel, wired straight into that view's own scroll position, so only
   the home page could have one. It knows nothing about a carousel now. It is told, once a
   frame, which work sits under the centre line — a fractional index, because you are usually
   between two — and it draws itself from that. Any view that can answer that question can
   carry the same timeline: the home carousel does, and so does the flow deck, which runs the
   same paintings past you in the same order and had no clock at all. */
(() => {
'use strict';

const TICKS_PER_SLIDE = 8;      // ruler resolution: ticks between one painting and the next
const TICK_GAP = 12;            // px between ruler ticks
const TICK_MH = 11, TICK_MJH = 24, TICK_ALPHA = 0.22;   // minor / month tick, resting opacity
const HOVER_NEAR = 9 * TICK_GAP, HOVER_BOOST = 20, HOVER_FALL = 0.5;   // cursor swells the ruler
const CENTER_H = 50;            // how tall the tick under the centre line stands

/* Four ways to draw the same fact — where in the archive's time you are standing.

   ticks   the ruler: eight marks to a painting, a taller one where a month turns
   colors  one band a painting, in the colour that painting is of: the archive's palette,
           running. It is a record of what she painted, not of when
   bars    one bar a month, as tall as that month was full: the months she worked in a rush
           and the months she did not
   dots    one dot a painting. The plainest of them: you can count where you are

   They differ in how much room a painting is given, so each sets its own — a colour needs to
   sit beside its neighbours to say anything, and a tick needs room to be read as eight. */
const WORK_W = { ticks: TICKS_PER_SLIDE * TICK_GAP, colors: 34, bars: 44, dots: 30 };
const MODES = Object.keys(WORK_W);

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

/* one entry per run of works sharing a month — where it starts, and what to call it */
function monthGroups(slides, monthOf) {
  const groups = [];
  slides.forEach((s, i) => {
    const mo = monthOf(s);
    const last = groups[groups.length - 1];
    if (last && last.text === mo) { last.slides += 1; return; }
    groups.push({ text: mo, startSlide: i, slides: 1 });
  });
  return groups;
}

/* create(view, slides, opts) — opts: { monthOf, years }
   Returns { update(centerSlide, ratio), resize(), destroy() }.
   centerSlide is the work under the centre line, fractional and unwrapped: a deck that loops
   may hand back 197.4 on a 195-work archive, and the ruler takes that in its stride — the
   ticks are read modulo the archive, so the timeline comes round with it. */
function create(view, slides, opts) {
  const monthOf = (opts && opts.monthOf) || (() => '');
  const years = (opts && opts.years) || {};
  const colors = (opts && opts.colors) || {};
  const mode = MODES.includes(opts && opts.mode) ? opts.mode : 'ticks';
  const workW = WORK_W[mode];

  const ruler = el('div', 'ruler ruler--' + mode);
  const canvas = el('canvas', 'ruler__canvas');
  const labels = el('div', 'ruler__labels');
  const labelTrack = el('div', 'ruler__track');
  labels.appendChild(labelTrack);
  ruler.appendChild(canvas);
  ruler.appendChild(labels);
  view.appendChild(ruler);

  const tickLen = slides.length * TICKS_PER_SLIDE;          // total ruler ticks (one copy)
  const rulerHalf = slides.length * workW;                  // one copy of the archive, in px
  const majors = new Uint8Array(tickLen);
  const groups = monthGroups(slides, monthOf);
  for (const g of groups) majors[g.startSlide * TICKS_PER_SLIDE] = 1;
  const maxMonth = groups.reduce((m, g) => Math.max(m, g.slides), 1);
  /* the colour of a work, kept as it is looked up often and never changes */
  const tone = slides.map((s) => colors[String(s.image || '').split('/').pop()] || '#c9c9c9');
  /* how full the month each work belongs to was — the bars are drawn per work, so the work
     carries its month's weight rather than the ruler having to look the group up again */
  const weight = new Float32Array(slides.length);
  for (const g of groups) {
    for (let i = g.startSlide; i < g.startSlide + g.slides; i++) weight[i] = g.slides / maxMonth;
  }

  /* two copies of the labels, laid end to end: the track is shifted by the offset modulo one
     copy, so whichever way the archive is running there is always a copy under the viewport */
  /* A month is written where it begins. At the ruler's scale a month is 700px of track and
     the names sit clear of one another; at a colour band's scale a short month is 100px wide
     and the names collide into each other — FEBRUARY 2026 printed through JUNE 2026. Where a
     month has not earned the room to be named, it goes unnamed: the ticks below it still say
     it is there. */
  const MIN_LABEL_PX = 118;
  function buildLabels() {
    labelTrack.replaceChildren();
    labelTrack.style.width = (rulerHalf * 2) + 'px';
    let lastX = -Infinity;
    for (let copy = 0; copy < 2; copy++) {
      for (const g of groups) {
        if (!g.text) continue;
        const at = copy * rulerHalf + g.startSlide * workW;
        if (at - lastX < MIN_LABEL_PX) continue;
        lastX = at;
        const l = el('span', 'ruler__label label');
        l.textContent = g.text;
        const d = String(slides[g.startSlide].date || '');
        const y = /^(\d{4})/.exec(d);
        l.dataset.year = (y && y[1]) || years[g.text] || '2026';
        l.style.left = (copy * rulerHalf + g.startSlide * workW) + 'px';
        labelTrack.appendChild(l);
      }
    }
  }

  /* ---------- the ticks, drawn on a canvas ---------- */
  let ctx = null, cw = 0, ch = 0, dpr = 1;
  let heights = new Float32Array(0);
  let baseIdx = null;
  let hover = false, hoverX = -1;

  function resize() {
    cw = ruler.clientWidth; ch = ruler.clientHeight;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    heights = new Float32Array(Math.ceil(cw / TICK_GAP) + 4);
    buildLabels();
  }

  function fall(t) {                       // falloff: pow(1-t, 1/fall)
    const v = 1 - t;
    return v <= 0 ? 0 : Math.pow(v, 1 / HOVER_FALL);
  }

  /* the swell of each tick is remembered between frames, and the ticks move under the window:
     shift the memory by as many ticks as the window moved, so a tick keeps its own height */
  function shiftHeights(q) {
    if (baseIdx === null) { baseIdx = q; return; }
    if (q === baseIdx) return;
    const d = q - baseIdx, p = heights.length;
    if (Math.abs(d) >= p) heights.fill(0);
    else if (d > 0) { heights.copyWithin(0, d, p); heights.fill(0, p - d, p); }
    else { heights.copyWithin(-d, 0, p + d); heights.fill(0, 0, -d); }
    baseIdx = q;
  }

  function drawTick(x, h, alpha) {
    ctx.globalAlpha = alpha;
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);                     // flipped ruler: the line hangs from the top edge
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  function drawSticks(U, ratio) {
    if (!ctx || cw <= 0) return;
    ctx.clearRect(0, 0, cw, ch);
    let v = U % TICK_GAP;
    if (v < 0) v += TICK_GAP;
    const q = Math.floor((U - v) / TICK_GAP);
    const centerIdx = Math.round((U + cw * 0.5) / TICK_GAP);   // the tick under the centre line
    shiftHeights(q);
    const ease = 0.12 * ratio, easeC = 0.2 * ratio;
    for (let ox = -v, e = 0; ox <= cw + TICK_GAP; ox += TICK_GAP, e++) {
      const t = q + e;
      const mj = majors[((t % tickLen) + tickLen) % tickLen] === 1;
      const base = mj ? TICK_MJH : TICK_MH;
      let boost = 0;
      if (t === centerIdx) boost = CENTER_H - base;
      else if (hover && hoverX >= 0) {
        const dx = Math.abs(ox - hoverX);
        if (dx < HOVER_NEAR) boost = HOVER_BOOST * fall(dx / HOVER_NEAR);
      }
      heights[e] += (boost - heights[e]) * (t === centerIdx ? easeC : ease);
      const h = base + heights[e];
      let alpha = TICK_ALPHA;
      if (t === centerIdx) {
        const p = Math.max(0, Math.min(1, (h - base) / Math.max(1, CENTER_H - base)));
        alpha = TICK_ALPHA + p * (1 - TICK_ALPHA);
      }
      drawTick(ox, h, alpha);
    }
    ctx.globalAlpha = 1;
  }

  /* What makes the ruler feel like something rather than a chart is not the ticks: it is that
     every tick keeps its own height between frames and eases towards where it should be, that
     the swell falls off with distance instead of switching on, and that the cursor drags a
     wave through it. The other three had none of it — they stamped rectangles and turned the
     middle one on. They share the ruler's machinery now.

     `lift` is what each work is reaching for: 1 under the centre line, falling away over a few
     works, plus whatever the cursor is pulling up around it. `swell` is where it actually is —
     it chases `lift` a little each frame, so nothing snaps. */
  let swell = new Float32Array(0);
  let swellBase = null;

  function shiftSwell(first) {
    if (swellBase === null) { swellBase = first; return; }
    const d = first - swellBase, p = swell.length;
    if (d === 0) return;
    if (Math.abs(d) >= p) swell.fill(0);
    else if (d > 0) { swell.copyWithin(0, d, p); swell.fill(0, p - d, p); }
    else { swell.copyWithin(-d, 0, p + d); swell.fill(0, 0, -d); }
    swellBase = first;
  }

  const REACH = 5;                    // works either side of the line that still feel it

  function eachWork(U, ratio, draw) {
    const n = slides.length;
    const first = Math.floor(U / workW) - 1;
    const count = Math.ceil(cw / workW) + 3;
    const centre = (U + cw * 0.5) / workW - 0.5;    // the work under the line, fractional
    if (swell.length < count) swell = new Float32Array(count + 8);
    shiftSwell(first);
    const ease = 0.14 * ratio;
    for (let k = 0; k < count; k++) {
      const at = first + k;
      const i = ((at % n) + n) % n;
      const x = at * workW - U;
      /* smooth, not a switch: the work on the line is fully lifted and its neighbours are
         lifted a little less, so passing over them is a wave and not a row of light switches */
      const d = Math.abs(at - centre);
      let lift = d >= REACH ? 0 : Math.pow(1 - d / REACH, 2.2);
      if (hover && hoverX >= 0) {
        const hx = Math.abs(x + workW * 0.5 - hoverX);
        if (hx < HOVER_NEAR) lift = Math.max(lift, 0.55 * fall(hx / HOVER_NEAR));
      }
      swell[k] += (lift - swell[k]) * ease;
      draw(i, x, swell[k], d);
    }
  }

  function centreLine() {
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(Math.round(cw * 0.5) + 0.5, 0);
    ctx.lineTo(Math.round(cw * 0.5) + 0.5, ch);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* the colours hang from the top edge as the ticks do, and swell into the room below them:
     at rest a quiet seam of colour, and where you are standing, the painting's colour full */
  function drawColors(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    const rest = ch * 0.24, reach = ch - rest;
    const gap = workW > 26 ? 2 : 1;
    eachWork(U, ratio, (i, x, s) => {
      /* the colour is the point of this one, so it is not faded to make room for the swell:
         a band held at a third of its opacity is not the painting's colour any more, it is
         that colour mixed with the paper. Height carries the emphasis; the colour stays true. */
      ctx.globalAlpha = 0.78 + 0.22 * s;
      ctx.fillStyle = tone[i];
      ctx.fillRect(Math.round(x), 0, Math.ceil(workW) - gap, rest + reach * s);
    });
    ctx.globalAlpha = 1;
    centreLine();
  }

  /* the month's fullness is the bar's own height; the swell lifts it off the line and darkens
     it, so the shape of the archive stays readable while the place you are in stands out */
  function drawBars(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    const gap = 3;
    eachWork(U, ratio, (i, x, s) => {
      const h = (0.18 + 0.62 * weight[i]) * ch * (0.72 + 0.28 * s);
      ctx.globalAlpha = 0.16 + 0.74 * s;
      ctx.fillStyle = '#111';
      ctx.fillRect(Math.round(x), 0, Math.ceil(workW) - gap, Math.max(3, h));
    });
    ctx.globalAlpha = 1;
    centreLine();
  }

  /* a dot a painting, on a hairline. The dot grows and drops as it comes under the line —
     the row reads as one strand being plucked rather than a bulb switching on */
  function drawDots(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    const y0 = ch * 0.3;
    ctx.globalAlpha = 0.12;                        // the strand the dots sit on
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y0) + 0.5);
    ctx.lineTo(cw, Math.round(y0) + 0.5);
    ctx.stroke();
    eachWork(U, ratio, (i, x, s) => {
      ctx.globalAlpha = 0.22 + 0.78 * s;
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(Math.round(x + workW * 0.5), y0 + s * ch * 0.3, 2.2 + s * 3.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    centreLine();
  }

  function onEnter() { hover = true; }
  function onLeave() { hover = false; hoverX = -1; }
  function onMove(e) { hoverX = e.offsetX; }
  ruler.addEventListener('mouseenter', onEnter);
  ruler.addEventListener('mouseleave', onLeave);
  ruler.addEventListener('mousemove', onMove);
  addEventListener('resize', resize);

  return {
    el: ruler,
    resize,
    /* called once a frame with the work under the centre line, and how long that frame was
       against a 60Hz one, so the swell eases at the same speed on any display */
    update(centerSlide, ratio) {
      if (!ctx || cw <= 0) return;
      const off = centerSlide * workW - ruler.clientWidth * 0.5;
      let lOff = off % rulerHalf;
      if (lOff < 0) lOff += rulerHalf;
      labelTrack.style.transform = 'translate3d(' + (-lOff) + 'px,0,0)';
      const r = ratio || 1;
      if (mode === 'ticks') drawSticks(off, r);
      else if (mode === 'colors') drawColors(off, r);
      else if (mode === 'bars') drawBars(off, r);
      else drawDots(off, r);
    },
    destroy() {
      removeEventListener('resize', resize);
      ruler.remove();
    },
  };
}

window.LSERuler = { create, TICKS_PER_SLIDE, TICK_GAP };
})();
