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
const LIVE_ALPHA = 0.62;        // the ticks of the month you are standing in
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
const TRACK_W = TICKS_PER_SLIDE * TICK_GAP;   // the room a painting gets on the ruler: 96px
/* The dots were given a third of that, and the months came round three times as fast — the
   names crowded, spilled onto a second line and still touched. A dot is one work and so is a
   tick: give them the same ground and the names fall exactly where the ruler puts them. The
   colours want to sit close enough to be read as a run, so those keep a narrower stride. */
const WORK_W = { ticks: TRACK_W, colors: 34, bars: 44, dots: TRACK_W };
const MODES = Object.keys(WORK_W);

function rootPx() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 10;
}

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
  /* which month each work belongs to — the ruler needs to know not just where a month begins
     but everything that is inside it */
  const groupOf = new Int32Array(slides.length);
  groups.forEach((g, gi) => {
    for (let i = g.startSlide; i < g.startSlide + g.slides; i++) groupOf[i] = gi;
  });
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
  /* A month is written where it begins, and a month is as wide as the number of paintings in
     it: June 2026 holds one, so its name and March's start 96px apart while the words themselves
     want 110. Short months collide — that is not a bug in the layout, it is what the archive is.

     How wide a word actually is depends on the screen: the labels are set in rem, so the same
     name is 110px on a 1500px display and nearly 190px on a 2560px one. A constant threshold
     would be right at one width and wrong at every other. Nothing is assumed: the names are
     laid out, measured as the browser actually drew them, and given a second line above when
     they will not fit beside the one before. Re-measured whenever the page is resized, since
     that is when the type changes size. */
  const LABEL_PAD = 10;              // breathing room between two names, in the drawn scale

  function buildLabels() {
    labelTrack.replaceChildren();
    labelTrack.style.width = (rulerHalf * 2) + 'px';
    const made = [];
    for (let copy = 0; copy < 2; copy++) {
      for (const g of groups) {
        if (!g.text) continue;
        const at = copy * rulerHalf + g.startSlide * workW;
        const l = el('span', 'ruler__label label');
        l.textContent = g.text;
        const d = String(slides[g.startSlide].date || '');
        const y = /^(\d{4})/.exec(d);
        l.dataset.year = (y && y[1]) || years[g.text] || '2026';
        l.style.left = at + 'px';
        l.dataset.g = String(groups.indexOf(g));
        labelTrack.appendChild(l);
        made.push({ el: l, at });
      }
    }
    /* one read of the layout for all of them, after they are all in the document */
    const pad = LABEL_PAD * (rootPx() / 10);
    const rowEnd = [-Infinity, -Infinity];
    for (const m of made) {
      const w = m.el.offsetWidth;                 // as the browser drew it, at this size
      const row = m.at >= rowEnd[0] + pad ? 0 : (m.at >= rowEnd[1] + pad ? 1 : 0);
      rowEnd[row] = m.at + w;
      m.el.classList.toggle('is-up', row === 1);  // a line of its own, above the row
    }
  }

  /* ---------- the ticks, drawn on a canvas ---------- */
  let litGroup = -1;             // the month whose name is lit
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
    litGroup = -1;         // the labels are new: whatever was lit is gone with them
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

  const n = slides.length;
  const workOfTick = (t) => {
    const w = Math.floor(t / TICKS_PER_SLIDE);
    return ((w % n) + n) % n;
  };

  /* The ruler's shape, worked out once and drawn twice.

     The ticks and the string are not two shapes: the string is what you get if you join the
     ends of the ticks. Its dip was invented separately before, with a reach and a falloff of
     its own, and it hung like a slack rope because it was never the ruler's shape to begin
     with — it was a curve I had made up next to one. There is one shape now. The ticks draw it
     as marks and the string draws it as a line through their tips, and the swell at the centre,
     the wave under the cursor and the taller marks where a month turns are the same events in
     both. */
  function tickShape(U, ratio) {
    let v = U % TICK_GAP;
    if (v < 0) v += TICK_GAP;
    const q = Math.floor((U - v) / TICK_GAP);
    const centerIdx = Math.round((U + cw * 0.5) / TICK_GAP);   // the tick under the centre line
    const liveGroup = groupOf[workOfTick(centerIdx)];
    markLive(liveGroup);
    shiftHeights(q);
    const ease = 0.12 * ratio, easeC = 0.2 * ratio;
    const out = [];
    for (let ox = -v, e = 0; ox <= cw + TICK_GAP; ox += TICK_GAP, e++) {
      const t = q + e;
      const idx = ((t % tickLen) + tickLen) % tickLen;
      const mj = majors[idx] === 1;
      const base = mj ? TICK_MJH : TICK_MH;
      let boost = 0;
      if (t === centerIdx) boost = CENTER_H - base;
      else if (hover && hoverX >= 0) {
        const dx = Math.abs(ox - hoverX);
        if (dx < HOVER_NEAR) boost = HOVER_BOOST * fall(dx / HOVER_NEAR);
      }
      heights[e] += (boost - heights[e]) * (t === centerIdx ? easeC : ease);
      out.push({
        x: ox,
        h: base + heights[e],
        base,
        major: mj,                                   // a month begins here
        work: idx % TICKS_PER_SLIDE === 0,           // a painting begins here
        live: groupOf[workOfTick(t)] === liveGroup,
        centre: t === centerIdx,
      });
    }
    return out;
  }

  function drawSticks(U, ratio) {
    if (!ctx || cw <= 0) return;
    ctx.clearRect(0, 0, cw, ch);
    for (const p of tickShape(U, ratio)) {
      let alpha = p.live ? LIVE_ALPHA : TICK_ALPHA;
      if (p.centre) {
        const g = Math.max(0, Math.min(1, (p.h - p.base) / Math.max(1, CENTER_H - p.base)));
        alpha = alpha + g * (1 - alpha);
      }
      drawTick(p.x, p.h, alpha);
    }
    ctx.globalAlpha = 1;
  }

  const DOT_INK = '#111';        // one ink: the line and the beads on it are the same material
  const DOT_REST = 0.3;          // …and at rest they are the same weight of it

  /* the string: the ruler's ticks with their ends joined. A bead sits at the end of every tick
     — a big one where a painting begins, a small one on the ticks between — so the line is not
     a curve with dots near it but a thing the beads are strung on. Nothing here is invented:
     the dip at the centre, the wave under the cursor and the deeper beads where a month turns
     are the ticks' own heights, read as a line. */
  function drawDots(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    const pts = tickShape(U, ratio);
    if (pts.length < 2) return;

    ctx.strokeStyle = DOT_INK;
    ctx.lineWidth = 1.6;          // a disc fills its pixels and a hairline half-covers two rows:
    ctx.globalAlpha = DOT_REST;   // this is the width at which the two read as the same ink
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].h);
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      ctx.quadraticCurveTo(a.x, a.h, (a.x + b.x) / 2, (a.h + b.h) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.h);
    ctx.stroke();

    /* how far a tick has been lifted above its resting height, 0..1 — the swell, recovered from
       the shape rather than computed a second time */
    const rise = (p) => Math.max(0, Math.min(1, (p.h - p.base) / (CENTER_H - TICK_MH)));
    const radius = (p) => (p.work ? 2.2 + rise(p) * 3.6 : 1 + rise(p) * 1.4);

    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.h, radius(p) + 1.4, 0, Math.PI * 2);   // no bead is painted over the string
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = DOT_INK;
    for (const p of pts) {
      const base = p.work ? DOT_REST : DOT_REST * 0.62;     // the small ones sit quieter
      ctx.globalAlpha = p.live ? (p.work ? 1 : 0.55) : base + (1 - base) * rise(p);
      ctx.beginPath();
      ctx.arc(p.x, p.h, radius(p), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#000';     // the ruler's own ink and weight, for whoever draws next
    ctx.lineWidth = 1;
  }

  /* the name of the month you are in is lit with whatever marks it below — ticks or beads.
     The two are one statement, so they are turned on together. */
  function markLive(gi) {
    if (gi === litGroup) return;
    litGroup = gi;
    labelTrack.querySelectorAll('.ruler__label').forEach((l) => {
      l.classList.toggle('is-live', +l.dataset.g === gi);
    });
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
