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

const TICKS_PER_SLIDE = 12;     // ruler resolution: ticks between one painting and the next — 12 keeps
                               // the original 12px grain (only the month boundaries spread) and gives a
                               // painting 144px, clear of the widest month name ("September 2026", ~121px)
const TICK_GAP = 12;           // px between ruler ticks
const TICK_MH = 11, TICK_MJH = 24, TICK_ALPHA = 0.22;   // minor / month tick, resting opacity
const LIVE_ALPHA = 0.62;        // the ticks of the month you are standing in
const HOVER_NEAR = 9 * TICK_GAP, HOVER_BOOST = 20, HOVER_FALL = 0.5;   // cursor swells the ruler
const CENTER_H = 50;            // how tall the tick under the centre line stands
const PULL_TICKS = TICKS_PER_SLIDE * 1.5;   // how far along the string a pull is felt (dots)
const BAR_FILL = 0.35;          // how much of a painting's room its bar fills
/* how much of a bar's length is the painting's own brightness, and how much is simply the bar
   being a bar. At 1 the row is all information and no rhythm — a reader cannot tell why the
   third mark is short, so it reads as noise. At 0 it is all rhythm and says nothing. */
const BAR_VAR = 1;

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
const WORK_W = { ticks: TRACK_W, colors: 34, bars: TRACK_W, dots: TRACK_W };
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

  /* What the bars are for.

     They were the fullness of each month, and the archive will not have it: of 28 months, 21
     hold between 7 and 9 paintings. The row came out a flat run of near-equal blocks, and no
     amount of drawing puts a shape into a number that does not move. Aggregating by month
     flattens anything, in fact — the monthly mean brightness only travels between 104 and 125.

     A painting is 62 to 166. A bar is one painting and stands for how light it is, so the row
     draws a rhythm the archive actually has: the stretches she worked bright, and the ones where
     the paintings go dark and low. */
  const lumOf = (hex) => {
    const v = String(hex || '').replace('#', '');
    if (v.length !== 6) return 0.5;
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const light = slides.map((sl) => lumOf(colors[String(sl.image || '').split('/').pop()]));
  const loL = Math.min.apply(null, light), hiL = Math.max.apply(null, light);
  /* stretched over the range the archive occupies: in absolute terms the whole row sits in the
     middle of the scale and a dark painting stands a few pixels shorter than a bright one */
  const bright = light.map((v) => (v - loL) / Math.max(0.001, hiL - loL));
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
        made.push({ el: l, at, end: at + g.slides * workW, w: 0, extra: 0 });
      }
    }
    /* one read of the layout for all of them, after they are all in the document — the width is what
       the sticky pin centres, and its region (at..end) is how long it stays pinned */
    for (const m of made) m.w = m.el.offsetWidth;   // as the browser drew it, at this size
    madeLabels = made;
  }

  /* ---------- the ticks, drawn on a canvas ---------- */
  let madeLabels = [];           // the label spans, with their region, for the sticky pin
  let litGroup = -1;             // the month whose name is lit
  let liveW = 0;                 // the lit label's width AS A CAPSULE — wider than its resting m.w (the pill
                                 // adds side padding), and it is this width the centre must be figured from
  let liveWorkIdx = 0;           // the exact work under the centre line — handed over so a view that
                                 // leaves for another lands it on the same work the ruler is showing

  /* Sticky, sideways: the name of the month you are in is held at the centre while its stretch of
     ruler runs under it, then the next month's name slides in and pushes it off — a section header,
     laid on its side. Each label is centred on the middle line for as long as its region (at..end)
     spans it, but never dragged ahead of where it has naturally scrolled to, and never past its own
     region's end, so the hand-off is one continuous move with no jump. */
  const STICKY_GAP = 8;
  function stickyPin(lOff) {
    const centre = cw * 0.5;
    for (const m of madeLabels) {
      /* the lit label rides as a capsule and is wider than the m.w measured at rest; centre it by that
         wider width or the pill's padding pushes its text off the middle line */
      const w = (m.el.classList.contains('is-live') && liveW) ? liveW : m.w;
      const left = m.at - lOff;                       // where it has naturally scrolled to
      const target = centre - w * 0.5;                // centred on the middle line
      let x = Math.min(target, (m.end - lOff) - w - STICKY_GAP);   // centred, then pushed by its end
      if (x < left) x = left;                         // but never ahead of its natural scroll
      const extra = x - left;
      if (Math.abs(extra - m.extra) > 0.5) {
        m.el.style.transform = extra ? 'translateX(' + extra + 'px)' : 'translateX(0)';
        m.extra = extra;
      }
    }
  }
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
    let centerIdx = Math.round((U + cw * 0.5) / TICK_GAP);     // the tick under the centre line
    /* The ruler pulls whichever tick happens to lie under the line, and between two paintings
       that is one of the small ones. Drawn as marks it makes no odds — a tick is a tick. Drawn
       as a string it does: the line was hauled all the way down to a speck of grain, and what
       you are standing on is not a speck, it is a painting. For the string the pull is taken by
       the nearest painting's bead, so the bottom of the dip is always the work you are on. */
    if (mode === 'dots') {
      centerIdx = Math.round(centerIdx / TICKS_PER_SLIDE) * TICKS_PER_SLIDE;
    }
    liveWorkIdx = workOfTick(centerIdx);
    const liveGroup = groupOf[liveWorkIdx];
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
      if (t === centerIdx) {
        boost = CENTER_H - base;
      } else if (mode === 'dots' && Math.abs(t - centerIdx) < PULL_TICKS) {
        /* The ruler lifts one tick and leaves its neighbours where they were. As marks that is
           right — a tick stands up, the ones beside it do not. As a string it is wrong: pull a
           thread at one point and the beads either side come with it. They stayed put, so the
           line fell to the bead you were on and climbed straight back, and the grain around it
           hung in the air as if the thread had been cut. The pull carries along the string now,
           strongest at the finger and easing out over a work and a half. */
        const d = Math.abs(t - centerIdx) / PULL_TICKS;
        boost = (CENTER_H - base) * Math.pow(1 - d, 2.4);
      } else if (hover && hoverX >= 0) {
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

  /* The machinery the ruler moves with, for the shapes that are not made of ticks.

     What makes the ruler feel like something rather than a chart is not that it has ticks: every
     tick keeps its own height between frames and eases towards where it should be, the swell
     falls away with distance instead of switching on, and the cursor drags a wave through it.
     A row of coloured bands or of bars gets the same, or it is a bar chart with a highlight. */
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

  const REACH = 5;              // works either side of the line that still feel the swell
  const FALL_POW = 2.2;

  function eachWork(U, ratio, draw) {
    const first = Math.floor(U / workW) - 1;
    const count = Math.ceil(cw / workW) + 3;
    const centre = (U + cw * 0.5) / workW - 0.5;
    if (swell.length < count) swell = new Float32Array(count + 8);
    shiftSwell(first);
    const ease = 0.14 * ratio;
    for (let k = 0; k < count; k++) {
      const at = first + k;
      const i = ((at % n) + n) % n;
      const x = at * workW - U;
      /* smooth, not a switch: the work on the line is fully lifted and its neighbours a little
         less, so passing over them is a wave and not a row of light switches */
      const d = Math.abs(at - centre);
      let lift = d >= REACH ? 0 : Math.pow(1 - d / REACH, FALL_POW);
      if (hover && hoverX >= 0) {
        const hx = Math.abs(x + workW * 0.5 - hoverX);
        if (hx < HOVER_NEAR) lift = Math.max(lift, 0.55 * fall(hx / HOVER_NEAR));
      }
      swell[k] += (lift - swell[k]) * ease;
      draw(i, x, swell[k]);
    }
  }

  function centreLine() {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(cw * 0.5) + 0.5, 0);
    ctx.lineTo(Math.round(cw * 0.5) + 0.5, ch);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* which month the middle of the screen is standing in — the colours and the bars mark it the
     way the ticks do, and the month's name above is lit with it */
  let liveHere = -1;
  function liveAt(U) {
    const centreWork = ((Math.round((U + cw * 0.5) / workW - 0.5) % n) + n) % n;
    liveWorkIdx = centreWork;
    liveHere = groupOf[centreWork];
    markLive(liveHere);
  }

  /* the colours hang from the top edge as the ticks do, and swell into the room below them: at
     rest a quiet seam of colour, and where you are standing, the painting's colour at full */
  function drawColors(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    liveAt(U);
    const rest = ch * 0.24, reach = ch - rest;
    const gap = workW > 26 ? 2 : 1;
    eachWork(U, ratio, (i, x, s) => {
      /* the colour is the point of this one, so it is not faded to make room for the swell: a
         band held at a third of its opacity is not the painting's colour any more, it is that
         colour mixed with the paper. Height carries the emphasis; the colour stays true. */
      ctx.globalAlpha = 0.78 + 0.22 * s;
      ctx.fillStyle = tone[i];
      ctx.fillRect(Math.round(x), 0, Math.ceil(workW) - gap, rest + reach * s);
    });
    ctx.globalAlpha = 1;
    centreLine();
  }

  /* one bar, one painting, as long as that painting is light. The month you are standing in is
     inked and the rest is quiet, so the row says both what the archive looked like and where in
     it you are. */
  function drawBars(U, ratio) {
    ctx.clearRect(0, 0, cw, ch);
    liveAt(U);
    /* the bar stands in the middle of the room a painting is given, and that room is the ruler's
       own: a painting has to sit at the same place on the timeline whichever way it is drawn, or
       the months come round at one speed under the ticks and three times as fast under the bars,
       and the same name lands somewhere else. The bar itself is narrow — it is a mark, not a
       block, and its neighbours have to be told apart at a glance. */
    const w = Math.max(3, Math.round(workW * BAR_FILL));
    const inset = (workW - w) / 2;
    ctx.fillStyle = '#111';
    eachWork(U, ratio, (i, x, s) => {
      const live = groupOf[i] === liveHere;
      const base = live ? LIVE_ALPHA : TICK_ALPHA;
      ctx.globalAlpha = base + (1 - base) * s;
      const lit = (1 - BAR_VAR) + BAR_VAR * bright[i];
      ctx.fillRect(Math.round(x + inset), 0, w, Math.max(2, (0.12 + 0.88 * lit) * ch));
    });
    ctx.globalAlpha = 1;
    centreLine();
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

    /* The curve has to pass through the beads, not near them. Drawn as quadratics with the
       points as control handles it went through the midpoints between them instead — it took the
       beads as suggestions and cut the corners, so wherever the shape turned sharply (which is
       exactly where you are standing) the bead was left sitting off the line.

       A Catmull-Rom does land on every point, but it overshoots them: before a tick dropped, the
       line rose above the ones either side of it and drew a little hill that is not in the ruler
       — an invention of the curve, not a fact of the archive. The tangents are the monotone ones
       (Fritsch–Carlson): where three beads descend, the curve between them only descends. It
       lands on every bead and adds nothing between them. */
    const m = [];                                  // the slope the curve leaves each bead with
    for (let k = 0; k < pts.length; k++) {
      const prev = pts[k - 1], cur = pts[k], next = pts[k + 1];
      const dl = prev ? (cur.h - prev.h) / (cur.x - prev.x) : 0;
      const dr = next ? (next.h - cur.h) / (next.x - cur.x) : 0;
      /* a bead that is a turning point is flat: that is what stops the line sailing past it */
      m.push(dl * dr <= 0 ? 0 : (Math.abs(dl) < Math.abs(dr) ? dl : dr));
    }
    ctx.strokeStyle = DOT_INK;
    ctx.lineWidth = 1.8;          // a disc fills its pixels and a hairline half-covers two rows:
    ctx.globalAlpha = DOT_REST;   // this is the width at which the two read as the same ink
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].h);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = (b.x - a.x) / 3;
      ctx.bezierCurveTo(a.x + dx, a.h + m[k] * dx, b.x - dx, b.h - m[k + 1] * dx, b.x, b.h);
    }
    ctx.stroke();

    /* how far a tick has been lifted above its resting height, 0..1 — the swell, recovered from
       the shape rather than computed a second time */
    const rise = (p) => Math.max(0, Math.min(1, (p.h - p.base) / (CENTER_H - TICK_MH)));
    /* A painting's bead grows where you stand on it, but not by much: swollen to nearly three
       times its resting size it stopped being a bead on a string and became a blob the string
       ran into. It is the deepest point of the dip that says where you are — the size only has
       to agree with it.

       The small beads are the thread's own grain, and grain must be even. Sized by the swell
       they bulged and shrank along the line and the string looked lumpy, as if it had been
       badly spun. They hold their size and answer in weight instead: they darken as the dip
       reaches them and fade back out of it, so the string tells you where you are by how deeply
       it is inked, not by being fatter in places. */
    const radius = (p) => (p.work ? 3.1 + rise(p) * 1.9 : 1.6 + rise(p) * 0.4);

    /* the string is cleared only where the bead will cover it — exactly, not with room to
       spare. A margin here rings every bead in white and the string appears to stop short of
       the very thing it is carrying. */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 1;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.h, radius(p), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = DOT_INK;
    for (const p of pts) {
      let a;
      if (p.work) {
        a = p.live ? 1 : DOT_REST + (1 - DOT_REST) * rise(p);
      } else {
        /* the grain: quiet at rest, drawn up as the dip reaches it, and never as loud as the
           painting it sits beside — it is the thread, not what hangs from it */
        const quiet = DOT_REST * 0.55;
        a = Math.min(0.72, (p.live ? 0.46 : quiet) + (0.72 - quiet) * rise(p));
      }
      ctx.globalAlpha = a;
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
    let liveEl = null;
    labelTrack.querySelectorAll('.ruler__label').forEach((l) => {
      const on = +l.dataset.g === gi;
      l.classList.toggle('is-live', on);
      if (on) liveEl = l;
    });
    /* read the capsule's width once, now that it is lit — not every frame in stickyPin */
    liveW = liveEl ? liveEl.offsetWidth : 0;
  }

  function onEnter() { hover = true; }
  function onLeave() { hover = false; hoverX = -1; }
  function onMove(e) { hoverX = e.offsetX; }
  ruler.addEventListener('mouseenter', onEnter);
  ruler.addEventListener('mouseleave', onLeave);
  ruler.addEventListener('mousemove', onMove);
  /* The sticky month capsule centres on cw = ruler.clientWidth, read only in resize(). A window
     'resize' from an orientation change can fire before the browser has laid the new width out, so
     cw would freeze at the old (landscape) width and the capsule's centre — cw*0.5 — would land off
     the right edge of the now-narrower portrait screen. A ResizeObserver on the ruler fires after
     layout with the box's true size, so cw is always the width actually drawn, with no timing race. */
  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => resize());
    ro.observe(ruler);
  } else {
    addEventListener('resize', resize);
  }

  return {
    el: ruler,
    resize,
    liveWork: () => liveWorkIdx,   // the work under the centre line, for a hand-over that must match
    /* called once a frame with the work under the centre line, and how long that frame was
       against a 60Hz one, so the swell eases at the same speed on any display */
    update(centerSlide, ratio) {
      if (!ctx || cw <= 0) return;
      const off = centerSlide * workW - ruler.clientWidth * 0.5;
      let lOff = off % rulerHalf;
      if (lOff < 0) lOff += rulerHalf;
      labelTrack.style.transform = 'translate3d(' + (-lOff) + 'px,0,0)';
      stickyPin(lOff);   // hold the live month's name at the centre as its region runs under it
      const r = ratio || 1;
      if (mode === 'ticks') drawSticks(off, r);
      else if (mode === 'colors') drawColors(off, r);
      else if (mode === 'bars') drawBars(off, r);
      else drawDots(off, r);
    },
    destroy() {
      if (ro) ro.disconnect(); else removeEventListener('resize', resize);
      ruler.remove();
    },
  };
}

window.LSERuler = { create, TICKS_PER_SLIDE, TICK_GAP };
})();
