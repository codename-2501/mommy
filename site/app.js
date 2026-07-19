/* LSE GALLERY — painting archive frontend. Data: /api/content only. */
(() => {
'use strict';

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const app = document.getElementById('app');
let content = null;
const { asset, route, toHref, base: BASE } = window.LSEData;
let aspects = {};             // image filename -> width/height
let tones = {};               // image filename -> the colour that painting is of

/* which timeline to draw. Four are built; they are compared by hand before one is chosen, so
   the choice lives in the URL (?tl=colors) rather than in a setting nobody has decided yet. */
function timelineMode() {
  const m = new URLSearchParams(location.search).get('tl');
  return ['ticks', 'colors', 'bars', 'dots'].includes(m) ? m : 'ticks';
}
let icons = {};               // path -> inline svg markup
let entered = false;          // intro gate passed this page-load
let carousel = null;          // active carousel instance
let pendingFlip = null;       // clicked painting rect/src for the detail FLIP
let flipSources = [];         // home media hidden while their ghosts are in the detail
let activeView = null;        // flow/index/about instance (destroy on route change)
let lastViewPath = '/';       // where the detail Close returns to
let viewEl = null;            // the view that is CURRENT — never the one on its way out
let leaving = null;           // {el, inst, car, timers} still animating out
let navGen = 0;               // a newer navigation retires the transition in flight
let wmEl = null;              // persistent wordmark (survives route changes)
let menuEl = null;            // persistent menu

/* menu icons — Noun Project, CC BY 3.0 (credits inside each SVG file) */
const MENU = [
  { href: '/',         icon: '/icons/timeline.svg', key: 'timeline', title: 'Timeline' },
  { href: '/flow',     icon: '/icons/flow.svg',     key: 'flow',     title: 'Flow' },
  { href: '/articles', icon: '/icons/collage.svg',  key: 'collage',  title: 'Index' },
];
const ABOUT = { href: '/about', icon: '/icons/profile.svg', key: 'profile', title: 'About' };

/* ---------- helpers ---------- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* The timeline runs newest first, so the works are ordered by the date set in the admin.
   Slides sharing a date (or with none) keep the admin's own order — Array.sort is stable. */
function byDateDesc(slides) {
  return (slides || []).slice().sort((a, b) => {
    const da = String(a.date || ''), db = String(b.date || '');
    if (da === db) return 0;
    if (!da) return 1;            // undated works sit at the end rather than at the top
    if (!db) return -1;
    return da < db ? 1 : -1;
  });
}

async function loadContent() {
  try {
    const r = await fetch(asset('/api/content'));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const c = await r.json();
    /* Two ways to order the archive, and the admin picks which (meta.order):
         date   — newest first, and the date field is the only thing that moves a work
         manual — the order the admin dragged the slides into; the date is then just a label
       Sorting here regardless would have made the manual order a lie: the admin would show
       one sequence and the site another. */
    if ((c.meta || {}).order !== 'manual') c.slides = byDateDesc(c.slides);
    return c;
  } catch (err) {
    console.error('content load failed:', err);
    return { slides: [], wordmark: {}, texts: {} };
  }
}

async function loadColors() {
  try {
    const r = await fetch(asset('/api/colors'));
    const j = await r.json();
    return j.colors || {};
  } catch (err) {
    return {};                  // no colours: the strip falls back to a neutral grey
  }
}

async function loadAspects() {
  try {
    const r = await fetch(asset('/api/aspects'));
    const j = await r.json();
    return j.aspects || {};
  } catch (err) {
    console.error('aspects load failed:', err);
    return {};
  }
}

async function loadIcons() {
  const all = [...MENU, ABOUT];
  await Promise.all(all.map(async (m) => {
    try {
      const r = await fetch(asset(m.icon));
      const txt = await r.text();
      icons[m.icon] = txt.replace(/<svg\b/,
        '<svg class="ic ic--' + m.key + '" aria-hidden="true" fill="currentColor"');
    } catch (err) {
      console.error('icon load failed:', m.icon, err);
    }
  }));
}

function wordmark() {
  const w = (content && content.wordmark) || {};
  return {
    image: (w.image || '').trim(),      // a logo drawn as a picture, if the admin gave one
    l1: (w.l1 || 'LSE GALLERY').trim(),
    l2: (w.l2 || '').trim(),
    l3: (w.l3 || '').trim(),
  };
}

/* One row per month of the archive, newest first — the same grouping the ruler and the
   index use. Keyed by year+month, so three different Januaries stay three rows instead of
   collapsing into one row with a wrong year and a tripled count. */
function monthStats(slides) {
  const rows = [];
  const byKey = new Map();
  for (const s of slides || []) {
    const idx = window.LSEData.monthIndex(s);      // date first — see site/data.js
    if (idx < 0) continue;
    const y = window.LSEData.year(s) || '2026';
    const key = y + '-' + idx;
    let row = byKey.get(key);
    if (!row) {
      row = { month: MONTHS[idx], year: y, cat: '', count: 0 };
      byKey.set(key, row);
      rows.push(row);
    }
    row.cat = row.cat || window.LSEData.category(s);
    row.count += 1;
  }
  return rows;
}

/* month (1-12) -> year from slide dates; months without a dated work fall back to 2026 */
function yearByMonth(slides) {
  const map = {};
  for (const s of slides || []) {
    const d = String(s.date || '');
    const m = /^(\d{4})-(\d{2})/.exec(d);
    if (m) map[+m[2]] = m[1];
  }
  return map;
}

/* scramble-text reveal */
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randChars(n) {
  let s = '';
  while (n-- > 0) s += SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];
  return s;
}

function scrambleOut(node, dur) {
  const text = node.textContent;
  if (!text) return;
  let start = null;
  let scr = randChars(text.length);
  let last = 0;
  function tick(ts) {
    if (start === null) start = ts;
    const t = Math.min(1, (ts - start) / dur);
    const keep = Math.round((1 - t) * text.length);
    if (ts - last > 50) { scr = randChars(text.length); last = ts; }
    node.textContent = scr.slice(0, keep);
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = '';
  }
  requestAnimationFrame(tick);
}

function scrambleIn(node, text, delay, dur) {
  const interval = 50;                  // how often the scrambled letters re-roll
  let start = null;
  let scr = randChars(text.length);
  let last = 0;
  node.textContent = '';
  function tick(ts) {
    if (start === null) start = ts + delay;
    if (ts < start) { requestAnimationFrame(tick); return; }
    const t = Math.min(1, (ts - start) / dur);   // linear reveal
    const shown = Math.floor(t * text.length + 0.5);
    if (ts - last > interval) { scr = randChars(text.length); last = ts; }
    node.textContent = text.slice(0, shown) + scr.slice(shown, text.length);
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = text;
  }
  requestAnimationFrame(tick);
}

/* ---------- wordmark (persistent big logo) ---------- */

/* : lines rise with yPercent:105 + clip reveal, 1.5s "snappy", stagger .1 */
function buildWordmark(revealDelay) {
  const wm = wordmark();
  const node = el('div', 'wordmark');

  /* a picture logo takes the wordmark's place — same slot, same reveal, so the intro and the
     views that move it do not need to know which one they are carrying. The type stays as the
     fallback: an archive with no logo still has a name. */
  if (wm.image) {
    node.classList.add('wordmark--image');
    const line = el('div', 'line');
    const inner = el('div', 'line-in');
    const img = el('img');
    img.src = asset(wm.image);
    img.alt = [wm.l1, wm.l2].filter(Boolean).join(' ');
    inner.style.setProperty('--ld', revealDelay.toFixed(2) + 's');
    inner.appendChild(img);
    line.appendChild(inner);
    node.appendChild(line);
    return node;
  }

  [wm.l1, wm.l2, wm.l3].filter(Boolean).forEach((text, i) => {
    const line = el('div', 'line');
    const inner = el('div', 'line-in', text);
    inner.style.setProperty('--ld', (revealDelay + i * 0.1).toFixed(2) + 's');
    line.appendChild(inner);
    node.appendChild(line);
  });
  return node;
}

/* ---------- intro gate ---------- */

/* : every visual line of the month list scrambles in for .5s, stagger .075. An
   archive spanning several years has many more lines, so the step is compressed to keep
   the intro the same length. */
function introStep(lines) {
  return Math.min(75, 1800 / Math.max(1, lines - 1));
}

/* when the wordmark starts rising: as the month list finishes */
function introLogoStart(slides) {
  const lines = monthStats(slides).length;
  return Math.max(0, (lines - 1) * introStep(lines)) / 1000;
}

function renderIntro(logoStart) {
  const intro = el('div', 'intro');

  /* month list — three columns, filled newest first, so it fits between the wordmark
     and the enter button however many years the archive spans */
  const stats = monthStats(content.slides);
  const months = el('div', 'intro-months label');
  const COLS = 3;
  const cols = Array.from({ length: COLS }, () => el('div', 'col'));
  const perCol = Math.ceil(stats.length / COLS);
  const step = introStep(stats.length);
  const LIST_START = 0.9;   // the title reveals first; the month list follows it in
  const scrambles = [];
  /* one line per month — the stacked the category under the month name, but the
     list now sits between the wordmark and the button, where 27 two-line rows would not
     fit on a short screen. Same four fields, one row: MONTH year — category (n) */
  stats.forEach((s, si) => {
    const block = el('div', 'mo');
    const line = el('div', 'row');
    const inn = el('span', 'in m');
    const monthName = el('span', null, '');
    const yearEl = el('span', 'n', '');
    const cat = el('span', 'c', '');
    const n = el('span', 'n', '');
    inn.appendChild(monthName);
    inn.appendChild(yearEl);
    inn.appendChild(cat);
    inn.appendChild(n);
    line.appendChild(inn);
    block.appendChild(line);
    cols[Math.min(COLS - 1, Math.floor(si / perCol))].appendChild(block);
    const delay = Math.round(LIST_START * 1000 + si * step);
    scrambles.push(() => {
      scrambleIn(monthName, s.month.toUpperCase(), delay, 500);
      scrambleIn(yearEl, s.year, delay, 500);
      scrambleIn(cat, s.cat || '', delay, 500);
      scrambleIn(n, '(' + s.count + ')', delay, 500);
    });
  });
  for (const c of cols) months.appendChild(c);
  intro.appendChild(months);

  /* enter gate — one button. The second button existed only to opt out of the
     sound; there is no music here, so the choice was empty and the site enters silent. */
  const gate = el('div', 'intro-gate');
  gate.style.transitionDelay = (LIST_START + logoStart + 0.7).toFixed(2) + 's';   // after the list has settled
  /* the ten-second countdown to auto-enter is drawn as a bar filling the button left to right; when
     it reaches the far side it enters. A click enters at once and stops the fill. */
  const enter = el('button', 'btn');
  const grey = el('span', 'btn__wave');                              // the second wave, behind — depth
  enter.appendChild(grey);
  const baseLabel = el('span', 'btn__label', 'Enter →');             // black text, the resting state
  enter.appendChild(baseLabel);
  const reveal = el('span', 'btn__reveal');                          // black bar + white text, swept in
  const revealLabel = el('span', 'btn__label', 'Enter →');
  reveal.appendChild(revealLabel);
  enter.appendChild(reveal);
  let stopWave = null;
  enter.addEventListener('click', () => { if (stopWave) stopWave(); enterSite(intro); });
  /* the word scrambles in as the button arrives — the same reveal the title and the list use */
  scrambleIn(baseLabel, 'Enter →', Math.round((LIST_START + logoStart + 0.7) * 1000), 600);
  setTimeout(() => {
    stopWave = waveFill(reveal, grey, 10000, () => {
      /* the tide has covered the button — it is all black now. Turn the word to a welcome, hold a
         beat so it can be read, then enter. */
      scrambleIn(revealLabel, 'Welcome!', 0, 500);
      setTimeout(() => enterSite(intro), 1000);
    });
  }, Math.round((LIST_START + logoStart + 1.3) * 1000));   // once the button has arrived, the tide starts
  gate.appendChild(enter);
  intro.appendChild(gate);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    intro.classList.add('is-ready');
    const wm = document.querySelector('.wordmark');
    if (wm) {
      wm.classList.add('is-ready');
      /* the title scrambles in, line by line, exactly as the month list does — a text logo only;
         a picture logo keeps the rise (there is nothing to scramble) */
      if (!wm.classList.contains('wordmark--image')) {
        wm.classList.add('is-scramble');
        [...wm.querySelectorAll('.line-in')].forEach((ln, i) => {
          /* a one-glyph decorative line (the divider dash) has nothing to spell — scrambling it just
             flashes a stray letter, so leave it to show in place */
          if (ln.textContent.trim().length > 1) scrambleIn(ln, ln.textContent, i * 120, 600);
        });
      }
    }
    for (const run of scrambles) run();
  }));
  return intro;
}

/* the countdown fills the Enter button like a rising tide: two waves of different wavelength climb
   together — a grey one leading, the black one (which flips the word to white) as the main body —
   each a gentle sine curve down the button's height that shifts phase over time, advancing left to
   right (eased) over durMs. onDone fires when full; the returned stop() lets a click enter early. */
function waveFill(reveal, grey, durMs, onDone) {
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const poly = (level, amp, waves, phase) => {
    const N = 18, pts = ['0% 0%', '0% 100%'];
    for (let i = N; i >= 0; i--) {                   // the wavy leading edge, bottom to top
      const y = i / N;
      pts.push((level + amp * Math.sin(y * waves * Math.PI * 2 + phase)).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%');
    }
    return 'polygon(' + pts.join(',') + ')';
  };
  let t0 = null, raf = 0, done = false;
  function frame(ts) {
    if (t0 === null) t0 = ts;
    const lin = Math.min(1, (ts - t0) / durMs);
    const level = ease(lin) * 114 - 7;               // mean x, running well past both ends
    const t = (ts - t0) / 1000;
    /* same wavelength, but its ripple runs at its own rate and its lead breathes, so it drifts with
       the black rather than marching locked to it */
    if (grey) grey.style.clipPath = poly(level + 8 + 4 * Math.sin(t * 1.5), 5, 0.9, t * 3.1 + 1);
    reveal.style.clipPath = poly(level, 4, 0.9, t * 5);                    // the gentle main wave
    if (lin < 1) raf = requestAnimationFrame(frame);
    else if (!done) { done = true; onDone(); }
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

function enterSite(intro) {
  if (entered) return;
  entered = true;
  const gate = intro.querySelector('.intro-gate');
  if (gate) gate.style.transitionDelay = '0s';
  intro.classList.add('is-leaving');

  /* every list line scrambles out — : to(lines, {scrambleText:"", stagger:.035}).
     The step is compressed the same way the entrance is, so a long list does not stretch
     the exit; the site only starts arriving once that exit has actually finished. */
  const rows = [...intro.querySelectorAll('.intro-months .row')];
  const outStep = Math.min(35, 900 / Math.max(1, rows.length - 1));
  rows.forEach((row, k) => {
    row.querySelectorAll('.in > span').forEach((sp) => {
      setTimeout(() => scrambleOut(sp, 500), k * outStep);
    });
  });
  const exitMs = (rows.length - 1) * outStep + 500;   // the last line has finished scrambling

  const wm = document.querySelector('.wordmark');
  const menu = document.querySelector('.menu');
  const home = document.querySelector('.view--home');
  setTimeout(() => {
    intro.remove();                                   /* the exit has played out in full */
    if (wm) wm.classList.remove('at-intro');          // rides up 1.5s expo
    setTimeout(() => { if (home) home.classList.add('is-in'); }, 400);   // slides rise underneath
    setTimeout(() => { if (menu) menu.classList.add('is-in'); }, 600);
  }, exitMs);
}

/* ---------- views ---------- */

function menuLink(m) {
  const a = el('a', null);
  a.href = toHref(m.href);
  a.dataset.route = m.href;          // the route without the mount, for matching the active one
  a.title = m.title;
  a.setAttribute('data-nav', '');
  a.innerHTML = icons[m.icon] || '';
  a.appendChild(el('span', 'menu__txt', m.title));   // mobile: text buttons
  const cur = route();
  if (cur === m.href) a.classList.add('active');
  return a;
}

function buildMenu() {
  const menu = el('nav', 'menu');
  menu.setAttribute('aria-label', 'Main navigation');
  const capsule = el('div', 'menu__capsule');
  for (const m of MENU) capsule.appendChild(menuLink(m));
  menu.appendChild(capsule);
  const about = el('div', 'menu__about');
  about.appendChild(menuLink(ABOUT));
  menu.appendChild(about);

  /* The mark of where you are used to be a background colour: it switched on under the button
     you pressed and off under the one you left, so nothing ever travelled. It is a body now —
     one drop that leaves, draws itself thin as it crosses, and rounds out where it lands. */
  const layer = el('div', 'menu__drop');
  layer.setAttribute('aria-hidden', 'true');
  layer.appendChild(el('div', 'menu__blob'));
  menu.insertBefore(layer, menu.firstChild);
  return menu;
}

let blobAt = null;              // where the drop is now, so a move knows where it left from
let blobAnim = null;            // the journey it is on, if any

const stillMotion = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches;

/* put the drop under the button that is current — travelling there if it was somewhere else */
function placeBlob(animate) {
  if (!menuEl) return;
  const layer = menuEl.querySelector('.menu__drop');
  if (!layer) return;
  const a = menuEl.querySelector('a.active');
  if (!a) {                     // a detail view is open: no button is current, so no drop
    layer.classList.add('is-off');
    blobAt = null;
    return;
  }
  layer.classList.remove('is-off');

  const mr = menuEl.getBoundingClientRect();
  const ar = a.getBoundingClientRect();
  if (!ar.width) return;        // measured before the menu was laid out
  const to = { x: ar.left - mr.left, y: ar.top - mr.top, w: ar.width, h: ar.height };
  const from = blobAt;
  blobAt = to;

  const blob = layer.querySelector('.menu__blob');
  /* A finished animation with fill:'both' does not let go of what it animated: its last value
     outranks the element's own style for as long as it exists. So the drop landed, the window was
     resized, the buttons moved — and the drop stayed at the pixel it had landed on, because the
     transform being written here was being overruled by a journey that had ended seconds ago. The
     journey is dismissed once it is over, and before a new position is written. */
  if (blobAnim) { blobAnim.cancel(); blobAnim = null; }
  blob.style.width = to.w + 'px';
  blob.style.height = to.h + 'px';
  const rest = 'translate3d(' + to.x + 'px,' + to.y + 'px,0) scale(1,1)';

  if (!animate || !from || stillMotion()) {
    blob.style.transform = rest;
    return;
  }

  const dx = to.x - from.x;
  const mid = from.x + dx * 0.5;
  /* the farther it has to go, the thinner it draws itself out — a drop crossing a gap, not a
     disc sliding along a rail. It does not bounce at the end: it arrives and it is round. */
  const stretch = 1 + Math.min(Math.abs(dx) / 260, 0.55);

  blob.style.transform = rest;      // where it is going, held in the element's own style
  blobAnim = blob.animate(
    [
      { transform: 'translate3d(' + from.x + 'px,' + from.y + 'px,0) scale(1,1)' },
      { transform: 'translate3d(' + mid + 'px,' + to.y + 'px,0) scale(' + stretch + ',.8)',
        offset: 0.42 },
      { transform: rest },
    ],
    { duration: 500, easing: 'cubic-bezier(.32,.9,.24,1)', fill: 'both' }
  );
  /* it ends where the style already says it is, so letting go changes nothing on screen —
     except that the style is once more the thing that decides */
  blobAnim.onfinish = () => { if (blobAnim) { blobAnim.cancel(); blobAnim = null; } };
}

/* month name -> year, for the ruler labels */
function yearsByName() {
  const byNum = yearByMonth(content.slides);
  const out = {};
  MONTHS.forEach((m, i) => { if (byNum[i + 1]) out[m] = byNum[i + 1]; });
  return out;
}

function renderHome() {
  const frag = document.createDocumentFragment();

  const logoStart = introLogoStart(content.slides);

  const view = el('main', 'view view--home');
  frag.appendChild(view);

  if (carousel) { carousel.destroy(); carousel = null; }
  carousel = window.LSECarousel.mount(
    view, content.slides || [], aspects,
    { years: yearsByName(), colors: tones, mode: timelineMode() },
    (s, item) => {
      healView();   // a still-closing detail can leave slots blank — make the view whole before we
                    // grab and hide the next three, or those paintings stay gone
      carousel.freeze();   // stop the lerp drift so the flip source stays put
      const grab = (it) => {
        const slot = it && it.querySelector('.lse-slot');
        const img = slot && slot.querySelector('img');
        if (!slot || !img) return null;
        const r = slot.getBoundingClientRect();
        if (r.right < 0 || r.left > innerWidth) return null;   // only visible ones fly
        return { el: slot, src: img.currentSrc || img.src };
      };
      const track = item.parentElement;
      pendingFlip = {
        cur: grab(item),
        prev: grab(item.previousElementSibling || track.lastElementChild),
        next: grab(item.nextElementSibling || track.firstElementChild),
      };
      flipSources = [pendingFlip.cur, pendingFlip.prev, pendingFlip.next]
        .filter(Boolean).map((f) => ({ box: f.el, src: f.src }));
      navigate('/p/' + (s.id || ''));
    },
  );

  if (!entered) {
    wmEl.classList.add('at-intro');
    frag.appendChild(renderIntro(logoStart));
  } else {
    wmEl.classList.add('is-ready');
    menuEl.classList.add('is-in');
    requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('is-in')));
  }
  return frag;
}

function renderStub(name) {
  const view = el('main', 'view view-stub');
  view.appendChild(el('div', 'label', name));
  return view;
}

/* flow/index/about — the persistent wordmark + menu stay; only the view swaps */
function renderView(name, mount) {
  const frag = document.createDocumentFragment();
  const view = el('main', 'view view--' + name);
  frag.appendChild(view);
  /* the detail's strip shows prev/current/next — all three fly out of this view, exactly
     as they do from the timeline. Only what is actually on screen can travel. */
  const openFrom = (s, box) => {
    healView();   // make the view whole before hiding the next three (see the carousel handler)
    /* the neighbours that fly out — and the order the detail then pages through — follow THIS view's
       order (the index's sort/colour filter), not the archive's own; else the flight and the detail's
       next/prev would jump to works that are not beside the one on screen */
    const order = (activeView && activeView.order && activeView.order())
      || (content.slides || []).map((x) => x.id);
    const n = order.length;
    const i = order.indexOf(s.id);
    const pack = (slot) => {
      const img = slot && slot.querySelector('img');
      if (!slot || !img) return null;
      const r = slot.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return null;
      return { el: slot, src: img.currentSrc || img.src };
    };
    const slotFor = (k) => {
      const id = n && order[((k % n) + n) % n];
      return id ? view.querySelector('.lse-slot[data-id="' + id + '"]') : null;
    };
    pendingFlip = {
      cur: pack(box),
      prev: i < 0 ? null : pack(slotFor(i - 1)),
      next: i < 0 ? null : pack(slotFor(i + 1)),
      order: order,
    };
    flipSources = [pendingFlip.cur, pendingFlip.prev, pendingFlip.next]
      .filter(Boolean).map((f) => ({ box: f.el, src: f.src }));
    navigate('/p/' + (s.id || ''));
  };
  activeView = mount(view, openFrom);
  return frag;
}

function buildView(path) {
  const slides = content.slides || [];
  if (path === '/') return renderHome();
  if (path === '/flow') {
    return renderView('flow', (v, open) =>
      window.LSEViews.mountFlow(v, slides, aspects, open, {
        years: yearsByName(), colors: tones, mode: timelineMode(),
      }));
  }
  if (path === '/articles') {
    return renderView('articles', (v, open) => window.LSEViews.mountIndex(v, slides, aspects, open, { colors: tones }));
  }
  if (path === '/about') {
    return renderView('about', (v) => window.LSEViews.mountAbout(v, content));
  }
  return renderStub('not found');
}

/* ---------- page transition ---------- */

/* Our transition timings. A painting that travels between views is the slowest thing on
   screen (the eye follows it); slots that merely arrive rise faster, and the page it left
   fades out well before either lands. */
const FLIP = { dur: 900, stagger: 40 };                              // a painting in flight
const RISE = { dur: 1100, stagger: 40, start: 220, fromFlow: 540 };  // slots arriving
const FADE = 320;                                                    // the page leaving

function nextFrame() {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

/* the incoming view says when it has settled — but never hold the transition past 200ms */
function whenReady(inst) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    if (inst && inst.ready) inst.ready.then(fin);
    setTimeout(fin, 200);
  });
}

function inView(r) {
  return r.bottom >= 0 && r.right >= 0 && r.top <= innerHeight && r.left <= innerWidth;
}

/* hand the work the viewer was on over to the incoming view */
function handOverIndex(fromPath, toArticles, oldCar, oldEl, oldInst) {
  let idx = 0;
  if (fromPath === '/') {
    idx = (oldCar && oldCar.activeIndex()) || 0;   // to flow OR to index — both open on the work you were on
  } else if (fromPath === '/flow' && oldInst && oldInst.activeIndex) {
    idx = oldInst.activeIndex();          // the next view opens on the paintings flow was showing
  } else if (fromPath === '/articles' && oldEl) {
    const mid = innerHeight / 2;
    let best = null, bestD = Infinity;
    for (const row of oldEl.querySelectorAll('.lse-row')) {
      const d = Math.abs(row.getBoundingClientRect().top - mid);
      if (d < bestD) { bestD = d; best = row; }
    }
    const cell = best && best.querySelector('[data-index]');
    idx = cell ? parseInt(cell.dataset.index, 10) || 0 : 0;
  }
  document.body.dataset.index = String(idx);
}

/* pair the leaving paintings with the incoming slots by work id. Only what the viewer can
   actually see takes part — plus the centred carousel slide, which may sit off screen. */
function measureFlips(oldEl, newEl, fromFlow) {
  const bind = (node) => ({ el: node, bounds: node.getBoundingClientRect() });
  const targetEls = [...newEl.querySelectorAll('.lse-slot')];
  const flipEls = oldEl ? [...oldEl.querySelectorAll('.lse-frame')] : [];
  if (!flipEls.length) return { fromFlips: [], toFlips: [], targets: targetEls.map(bind) };

  const seen = [];
  for (const node of flipEls) {
    const b = node.getBoundingClientRect();
    if (inView(b) || node.closest('.lse-centred')) seen.push({ el: node, bounds: b });
  }
  let ids = new Set(seen.map((f) => f.el.dataset.id));
  const toFlips = [];
  for (const node of targetEls) {
    if (!ids.has(node.dataset.id)) continue;
    const b = node.getBoundingClientRect();
    if (inView(b)) toFlips.push({ el: node, bounds: b });
  }
  ids = new Set(toFlips.map((t) => t.el.dataset.id));
  const paired = new Set(toFlips.map((t) => t.el));
  /* a slot that receives a flown painting must not also rise — the rest are new to this view
     and rise in from below, whichever way the deck is going (in to flow, or out of it) */
  const rest = targetEls.filter((node) => !paired.has(node)).map(bind);
  return {
    fromFlips: fromFlow ? seen : seen.filter((f) => ids.has(f.el.dataset.id)),
    toFlips,
    targets: rest,
  };
}

/* A flight tidies its inline styles up when it lands. That tidy-up must never touch an
   element that has since moved on: if the viewer leaves for another view mid-flight, the
   frame is already being animated out by the departing view, and wiping its transform
   would snap it back into place for a moment before the view is removed. */
function settled(node) {
  return node.isConnected && node.closest('.view') === viewEl;
}

function clearFlight(node) {
  node.style.transition = '';
  node.style.transform = '';
  node.style.transformOrigin = '';   // a deck-exit flight pivoted at centre; hand the frame back at 0 0
}

/* a flat-hierarchy preserve-3d layer the deck's paintings fly in on the way out. It has no perspective of
   its own — each painting keeps its own inline perspective() for the turn (frame-centred, symmetric, the
   same natural shape the in-slot flight draws) — so translateZ here only orders the overlap (depth) and
   never resizes it, and the deck's left-in-front stacking is held without the angle looking off. */
function flipAir() {
  let air = document.querySelector('.flip-air');
  if (!air) { air = el('div', 'flip-air'); app.appendChild(air); }
  return air;
}

/* the painting's own frame moves house into its new slot and flies the delta home.
   No clone, no second <img> — the same pixels travel.
   flatFly (leaving the deck): the frame flies in the 3D layer above, keeping the deck's perspective and
   overlap order, and drops into its slot only once the cards have spread apart — so the overlap never
   flips and the angle never breaks. */
function prepareFlip(fromFlips, toFlips, noStagger, flatFly) {
  const byId = new Map(toFlips.map((t) => [t.el.dataset.id, t]));
  const flights = [];
  const owners = [];
  const air = flatFly ? flipAir() : null;
  /* the flight layer borrows the DECK'S OWN perspective — same 1000px, same vanishing point (the centre
     of the deck box, off to the left). A painting flying at its deck position and angle then renders
     exactly as it did in the deck, so the hand-off has no snap: the even fan does not collapse into a
     bunched, flatter cluster the instant the flip takes over. Paintings are the same size in every view
     now, so no scale is needed either — the turn to flat is the only shape change. */
  if (air) {
    const deckEl = document.querySelector('.flow__deck');
    if (deckEl) {
      const dr = deckEl.getBoundingClientRect();
      air.style.perspective = '1000px';
      air.style.perspectiveOrigin = (dr.left + dr.width / 2) + 'px ' + (dr.top + dr.height / 2) + 'px';
    } else { air.style.perspective = ''; air.style.perspectiveOrigin = ''; }
  }
  const myGen = navGen;   // a later navigation may re-fly these frames; its cleanup, not ours, owns them
  for (const from of fromFlips) {
    const to = byId.get(from.el.dataset.id);
    if (!to) continue;
    const owner = to.el.closest('.lse-card');
    if (owner) { owner.style.zIndex = '5'; owners.push(owner); }
    const srcCard = from.el.closest('.lse-card');
    const roty = srcCard && typeof srcCard._roty === 'number' ? srcCard._roty : 0;
    let endT = '';                      // where the flight lands — see the roty branch for why it matters
    /* a painting leaving the deck stands at its deck angle: fly from that angle to flat, turning and
       travelling as one move. Pivot at the centre so the box matches the deck's. */
    const cx = from.bounds.left + from.bounds.width / 2 - (to.bounds.left + to.bounds.width / 2);
    const cy = from.bounds.top + from.bounds.height / 2 - (to.bounds.top + to.bounds.height / 2);
    const converge = (pose) => {
      from.el.style.transformOrigin = '50% 50%';
      from.el.style.transition = 'none';
      let scale = 1;
      for (let pass = 0; pass < 4; pass++) {
        from.el.style.transform = pose(scale);
        const shown = from.el.getBoundingClientRect().width;
        if (shown < 2) break;
        if (Math.abs(shown - from.bounds.width) < 0.5) break;
        scale *= from.bounds.width / shown;
      }
    };
    if (roty && air) {
      /* fly in the deck's own perspective layer (set on .flip-air above). Sitting the frame at its slot
         and shifting it back to the deck spot (cx,cy) with the deck angle renders it exactly as the deck
         did — no scale, no per-frame perspective, no snap. It travels to the slot (cx,cy -> 0) and turns
         flat (rotateY -> 0) as one move; at flat, the perspective no longer foreshortens, so it lands at
         its true slot size. The slot waits empty until the landing. */
      air.appendChild(from.el);
      from.el.style.position = 'absolute';
      from.el.style.left = to.bounds.left + 'px'; from.el.style.top = to.bounds.top + 'px';
      from.el.style.width = to.bounds.width + 'px'; from.el.style.height = to.bounds.height + 'px';
      from.el.style.margin = '0';
      from.el.style.transformOrigin = '50% 50%';
      from.el.style.transition = 'none';
      to.el.replaceChildren();
      from.el.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0) rotateY(' + roty + 'deg)';
      endT = 'translate3d(0px,0px,0) rotateY(0deg)';
    } else {
      to.el.replaceChildren(from.el);
      to.el.style.visibility = '';        // a slot that lent its frame out was hidden — it is back
      if (roty) {
        converge((sc) =>
          'perspective(1000px) translate3d(' + cx + 'px,' + cy + 'px,0) scale(' + sc + ') rotateY(' + roty + 'deg)');
        endT = 'perspective(1000px) translate3d(0px,0px,0) scale(1) rotateY(0deg)';
      } else {
        /* centre-delta, not left-delta: the scale pivots at the centre, so aligning left edges leaves the
           box (from.width - to.width)/2 off — it snapped on an interrupted flight between different sizes */
        const scale = to.bounds.width ? from.bounds.width / to.bounds.width : 1;
        from.el.style.transition = 'none';
        from.el.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0) scale(' + scale + ')';
      }
    }
    /* the deck-angle turn eases more evenly than the flat flights: --ease-travel front-loads hard, so a
       turning card raced in and braked. A gentler ease-out spreads the deceleration across the flight. */
    const ease = roty ? 'cubic-bezier(.33,1,.68,1)' : 'var(--ease-travel)';
    from.el._flightGen = myGen;   // stamp who owns this flight now
    flights.push({ el: from.el, to: to.el, delay: noStagger ? 0 : flights.length * FLIP.stagger, end: endT, ease });
  }
  if (!flights.length) return null;
  return () => {
    for (const f of flights) {
      f.el.style.transition = 'transform ' + FLIP.dur + 'ms ' + f.ease + ' ' + f.delay + 'ms';
      f.el.style.transform = f.end;
    }
    const last = flights[flights.length - 1];
    /* drop each 3D-layer painting into its slot once the flight has fully settled it — the carousel
       (and the index) sit FLAT at rest, so a flat painting moving into a flat slot is a pure DOM move:
       no resize, no snap. The size change is already spent, smoothly, over the flight itself. */
    if (air) {
      setTimeout(() => {
        for (const f of flights) {
          if (f.el._flightGen !== myGen) continue;
          if (f.to.isConnected) {
            f.to.replaceChildren(f.el);
            f.el.style.position = ''; f.el.style.left = ''; f.el.style.top = '';
            f.el.style.width = ''; f.el.style.height = ''; f.el.style.margin = '';
            clearFlight(f.el);
          } else { f.el.remove(); }            // destination gone — heal rebuilds it
        }
        for (const o of owners) { if (settled(o)) o.style.zIndex = ''; }
      }, FLIP.dur + last.delay + 50);
      return;
    }
    setTimeout(() => {
      for (const f of flights) { if (f.el._flightGen === myGen && settled(f.el)) clearFlight(f.el); }
      for (const o of owners) { if (settled(o)) o.style.zIndex = ''; }
    }, FLIP.dur + last.delay + 50);
  };
}

/* slots with no painting of their own coming in rise from below the fold */
function prepareRise(targets, fromFlow, toFlow) {
  const start = fromFlow ? RISE.fromFlow : RISE.start;
  const risers = [];
  for (const t of targets) {
    const b = t.bounds;
    if (b.bottom < 0 || b.top > innerHeight || b.right < -100 || b.left > innerWidth + 100) continue;
    const y = -((b.top - innerHeight) * (toFlow ? 1.25 : 1));
    t.el.style.transition = 'none';
    t.el.style.transform = 'translate3d(0,' + y + 'px,0) scale(.9)';
    risers.push({ el: t.el, delay: start + (risers.length + 1) * RISE.stagger });
  }
  if (!risers.length) return null;
  return () => {
    for (const r of risers) {
      r.el.style.transition = 'transform ' + RISE.dur + 'ms var(--ease-rise) ' + r.delay + 'ms';
      r.el.style.transform = '';
    }
    const last = risers[risers.length - 1];
    setTimeout(() => {
      for (const r of risers) { if (settled(r.el)) clearFlight(r.el); }
    }, RISE.dur + last.delay + 50);
  };
}

/* a view that is still animating out is torn down at once when the next navigation
   lands — otherwise its rAF loop keeps running and its paintings stay on screen */
function finalizeLeaving() {
  if (!leaving) return;
  const { el, inst, car, timer } = leaving;
  leaving = null;
  clearTimeout(timer);
  if (inst && inst.destroy) inst.destroy();
  if (car) car.destroy();
  if (el) el.remove();
}

/* the old page leaves WHILE the new one arrives — both are mounted at once */
/* A view can be left while it is still arriving. Its slots would then keep rising into
   view on their own transition — surfacing after the exit has already measured them as
   off screen, and vanishing a moment later when the view is dropped. Stop them where
   they are: whatever is off screen stays off screen, whatever is visible leaves properly. */
function freezeEntrance(viewNode) {
  if (!viewNode) return;                        // a fresh load / deep link has no outgoing view to freeze
  for (const node of viewNode.querySelectorAll('.lse-slot,.lse-frame')) {
    if (!node.style.transition && !node.style.transform) continue;
    const t = getComputedStyle(node).transform;
    node.style.transition = 'none';
    node.style.transform = t === 'none' ? '' : t;
  }
  void viewNode.offsetWidth;                 // land the freeze before the exit animates
}

function leave(oldEl, oldInst, oldCar, flags) {
  if (!oldEl) return;
  const { fromFlow, fromAbout, toAbout } = flags;
  const done = () => { if (leaving && leaving.el === oldEl) finalizeLeaving(); };
  freezeEntrance(oldEl);

  /* Into the index or the timeline the deck has already fanned shut and flown its paintings on to
     their slots (flatten + the flip, in transition); what is left of flow just fades behind them.
     Only About, whose curtain has no slots to receive them, folds and fades on its own here. */
  if (fromFlow && toAbout && oldInst && oldInst.exit) {
    leaving = { el: oldEl, inst: null, car: oldCar, timer: 0 };   // exit() already destroyed it
    oldInst.exit(done);                                  // no slots to carry to: fold and fade
    return;
  }
  if (oldInst) oldInst.destroy();
  if (oldCar) oldCar.destroy();
  if (fromAbout) {
    oldEl.classList.remove('is-in');
    oldEl.classList.add('is-out');                       // the curtain reverses
    leaving = { el: oldEl, timer: setTimeout(done, 1050) };
    return;
  }
  oldEl.classList.add('is-exit');                        // fades behind the flip
  leaving = { el: oldEl, timer: setTimeout(done, fromFlow ? 1050 : FADE + 50) };
}

async function transition(path, oldEl, oldInst, oldCar, oldPath, gen) {
  const flags = {
    fromFlow: oldPath === '/flow',
    fromAbout: oldPath === '/about',
    toFlow: path === '/flow',
    toAbout: path === '/about',
  };
  const toCarousel = path === '/' || path === '/flow';   // the views that jump to an index

  handOverIndex(oldPath, path === '/articles', oldCar, oldEl, oldInst);
  if (oldCar) oldCar.freeze();          // hold the paintings still while they are measured

  const frag = buildView(path);
  const view = frag.querySelector ? frag.querySelector('.view') : frag;
  if (view) {
    view.classList.add('is-pre');       // nothing paints until the from-state is set
    if (path === '/') view.classList.add('no-rise');   // the flip drives the slides, not the intro rise
  }
  app.appendChild(frag);
  viewEl = view;                        // current from this moment on, even mid-flight
  const inst = activeView || carousel;

  /* the index scrolls its own container and the timeline its own lerp, both live the instant they mount —
     so a scroll during the arrival would move the grid/track while the paintings are still flying in on
     their own fixed-layer transforms, and they float free. Hold the incoming view until the flight lands. */
  const lockable = (path === '/articles' || path === '/') && inst && inst.lockScroll ? inst : null;
  if (lockable) lockable.lockScroll();

  /* if this interrupted a flight, stop it NOW — before the awaits below (a to-flow/-timeline leg waits
     for the incoming deck to be ready, and the interrupted paintings would drift the whole time, so the
     later measure would read them somewhere they no longer visually are). Freeze at the click. */
  freezeEntrance(oldEl);

  /* a click that lands mid-transition retires this one: the next navigation already
     took this view as its "old" one, so it must not go on to animate itself in */
  const retired = () => gen !== navGen || !view || !view.isConnected;

  await nextFrame();                    // rects exist only once the view is in the document
  if (toCarousel) await whenReady(inst);
  await nextFrame();
  if (retired()) {
    if (view) view.classList.remove('is-pre');
    return;
  }

  /* Leaving flow is the exact reverse of arriving. Arriving, the paintings flew in from the last
     view and the deck fanned open over them; leaving, the deck fans shut (flatten, lifted above the
     arriving view so the fold is seen) and then, flat again, the paintings fly on to their slots in
     the next view — the same flip that carried them in, run backwards. About's curtain has no slots
     to receive them, so there flow folds and fades on its own (exit) instead. */
  if (flags.fromFlow && !flags.toAbout && oldInst && oldInst.freeze) {
    oldInst.freeze();                                   // hold the deck still; each painting keeps its angle
  }

  /* if this navigation interrupted a transition still in flight, the old view's paintings are mid-
     flight on their own CSS transitions. Stop them where they are BEFORE measuring — otherwise the
     measure reads a moving target and the new flip starts each frame a step off, which snaps. (For an
     un-interrupted leave the frames carry no inline flight transform, so this is a no-op.) */
  freezeEntrance(oldEl);
  const { fromFlips, toFlips, targets } = measureFlips(oldEl, view, flags.fromFlow);
  if (inst && inst.unfreeze) inst.unfreeze();           // flow: the deck angle eases in

  const skipFlip = flags.fromFlow && flags.toAbout;     // About has no slots to receive the paintings
  const playFlip = fromFlips.length && !skipFlip
    ? prepareFlip(fromFlips, toFlips, flags.toFlow, flags.fromFlow)   // leaving the deck flies in the 3D layer
    : null;
  const playRise = prepareRise(targets, flags.fromFlow, flags.toFlow);

  leave(oldEl, oldInst, oldCar, flags);
  view.classList.remove('is-pre');
  void view.offsetWidth;                // paint the from-state before attaching transitions
  requestAnimationFrame(() => {
    if (playFlip) playFlip();
    if (playRise) playRise();
  });
  if (path === '/') setTimeout(() => view.classList.remove('no-rise'), FLIP.dur + 200);
  if (lockable) {
    /* still the live view? the timeline lives in `carousel`, the index in `activeView` */
    const live = () => activeView === lockable || carousel === lockable;
    if (playFlip) {
      /* let it scroll again once the last painting has landed (staggered flights land latest) */
      const settle = FLIP.dur + fromFlips.length * FLIP.stagger + 120;
      setTimeout(() => { if (live()) lockable.unlockScroll(); }, settle);
    } else {
      lockable.unlockScroll();   // nothing flying in (fresh load / rise-only) — nothing to float over
    }
  }
}

/* ---------- router ---------- */

/* give a slot its painting back — used when the frame it lent out cannot fly home */
function restoreSlot(f) {
  if (!f.box.querySelector('.lse-frame')) {
    const frame = el('div', 'lse-frame');
    frame.dataset.id = f.box.dataset.id || '';
    const img = document.createElement('img');
    img.src = asset(f.src);
    img.className = 'ok';
    img.draggable = false;
    frame.appendChild(img);
    f.box.appendChild(frame);
  }
  f.box.style.visibility = '';
}

function restoreFlipSources() {
  for (const f of flipSources) restoreSlot(f);
  flipSources = [];
}

/* Bring every slot in the current view back to whole: unhide it, and if its painting's frame went
   missing (a flight that lost a race left it in a detail, or the detail was torn down with it) reclaim
   the frame wherever it is, or rebuild it from the slide's thumb. Run before opening a detail so the
   three it is about to lend out — and any three a previous open never gave back — are all present. */
function healView() {
  const view = viewEl;
  if (!view || !content) return;
  const byId = new Map((content.slides || []).map((s) => [s.id, s]));
  view.querySelectorAll('.lse-slot').forEach((slot) => {
    slot.style.visibility = '';
    if (slot.querySelector('.lse-frame')) return;
    const id = slot.dataset.id || '';
    let frame = id && document.querySelector('.detail .lse-frame[data-id="' + id + '"]');
    if (frame) {                                   // reclaim the real frame from a leftover detail
      frame.style.transition = ''; frame.style.transform = ''; frame.style.transformOrigin = '';
      slot.appendChild(frame);
      return;
    }
    const s = byId.get(id);                         // else rebuild it from the slide's thumb
    if (!s || !s.image) return;
    const fn = String(s.image).split('/').pop();
    frame = el('div', 'lse-frame');
    frame.dataset.id = id;
    const img = document.createElement('img');
    img.src = asset('/thumbs/600/' + encodeURIComponent(fn));
    img.className = 'ok';
    img.draggable = false;
    frame.appendChild(img);
    slot.appendChild(frame);
  });
}

/* detail close: the paintings fly back into their slots with the same that carried
   them out — the mirror of the entrance.
   Nothing else moves: the view behind the detail was never torn down, so making its slots
   rise again would read as the deck vanishing and coming back. */
async function flyDetailHome(detailEl) {
  const view = viewEl;
  if (!view || !detailEl) return;
  await nextFrame();                            // let the carousel's jump to this work land
  const { fromFlips, toFlips } = measureFlips(detailEl, view, false);
  /* a slot whose painting cannot fly home — its slide wrapped off screen while the detail
     was open — is filled again right now. Waiting until the detail is gone would pop the
     image in a second late; the copy still in the detail simply leaves with the curtain. */
  const landing = new Set(toFlips.map((t) => t.el));
  flipSources = flipSources.filter((f) => {
    if (landing.has(f.box)) return true;
    restoreSlot(f);
    return false;
  });
  if (!fromFlips.length) return;
  const playFlip = prepareFlip(fromFlips, toFlips, false);
  void view.offsetWidth;                        // paint the from-state before it animates
  requestAnimationFrame(() => { if (playFlip) playFlip(); });
}

function render() {
  const path = route();

  /* each view carries its own background; a detail keeps the one belonging to the page under it */
  if (window.LSEBackground && !path.startsWith('/p/')) {
    window.LSEBackground.apply(((content && content.backgrounds) || {})[path]);
  }

  /* detail = overlay above the (kept) home — no home teardown, no flash */
  if (path.startsWith('/p/')) {
    finalizeLeaving();                       // no half-left view may sit under the detail
    if (!viewEl || !viewEl.isConnected) {    // deep link only — keep a live view
      entered = true;                        // deep link: skip the gate
      if (carousel) { carousel.destroy(); carousel = null; }
      document.body.classList.add('lock');
      app.replaceChildren();
      const frag = renderHome();
      viewEl = frag.querySelector('.view');
      app.appendChild(frag);
    }
    const flip = pendingFlip;
    pendingFlip = null;
    window.LSEDetail.open(app, {
      content, aspects,
      order: flip && flip.order,     // page prev/next in the order the opening view showed (index sort etc.)
      closePath: lastViewPath,
      onSync: (i) => { if (carousel) carousel.goTo(i); },
      onLeave: flyDetailHome,     // the paintings fly back into the view +
      onGone: () => { restoreFlipSources(); healView(); },   // …and whatever did not make it is healed whole
    }, path.slice(3), flip);
    return;
  }
  if (window.LSEDetail.isOpen && path === lastViewPath) {
    window.LSEDetail.close();                // back from detail: animate out, keep the view
    return;
  }

  /* exit choreography */
  const gen = ++navGen;                      // this navigation retires any earlier one
  finalizeLeaving();                         // a still-departing view goes now, not later
  const oldEl = viewEl;
  const oldInst = activeView;
  const oldCar = carousel;
  const oldPath = lastViewPath;
  activeView = null;
  carousel = null;
  viewEl = null;
  lastViewPath = path;
  updateMenu(path);
  document.body.classList.add('lock');       // every view manages its own scroll
  restoreFlipSources();                      // a detail may still hold the home's live <img>s
  app.querySelectorAll('.intro,.detail').forEach((n) => n.remove());

  if (path === '/' && !entered) {            // first load: the intro gate owns the choreography
    if (oldEl) oldEl.remove();
    const frag = renderHome();
    viewEl = frag.querySelector('.view');
    app.appendChild(frag);
    return;
  }
  transition(path, oldEl, oldInst, oldCar, oldPath, gen);
}

/* persistent menu: only the active state changes between routes */
function updateMenu(path) {
  if (!menuEl) return;
  menuEl.querySelectorAll('a').forEach((a) => {
    /* match the mount-free route, not the href attribute — under a project page the href is
       /mommy/flow while path is /flow, so they never matched, nothing was marked current, and
       the indicator had no button to sit on and stayed hidden */
    a.classList.toggle('active', a.dataset.route === path);
  });
  placeBlob(true);
}

function navigate(href) {
  /* the menu marks where you already are, and tapping that button used to tear the view down
     and play its arrival again — the paintings flew back in over a page that never left */
  /* the link already carries the mount (its href was written with toHref); strip it back off
     before normalising, or the mount is added a second time and /flow becomes /mommy/mommy/flow */
  let to = String(href);
  if (BASE && to.indexOf(BASE) === 0) to = to.slice(BASE.length);
  to = to.replace(/\/+$/, '') || '/';
  const at = route();
  if (to === at) {
    /* a painting whose detail overlay is gone but whose URL is still /p/… (a reopen that lost a race,
       or any teardown) must reopen on the next click — not sit stuck. Re-render to bring it back. */
    if (to.indexOf('/p/') === 0 && !(window.LSEDetail && window.LSEDetail.isOpen)) { render(); return; }
    /* tapping the tab you are already on returns the view to its start — the first work / the top —
       rather than tearing it down and replaying its arrival */
    const v = activeView || carousel;
    if (v && v.reset) v.reset();
    return;
  }
  history.pushState(null, '', toHref(to));
  render();
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

/* While the window is being dragged, elements whose transform is derived from the viewport
   (the wordmark) would animate to each intermediate size — the logo lags behind the edge of
   the window. Mark the resize so those transitions sit out, and lift the mark once it stops. */
let resizeEnd = 0;
addEventListener('resize', () => {
  document.documentElement.classList.add('is-resizing');
  clearTimeout(resizeEnd);
  resizeEnd = setTimeout(() => document.documentElement.classList.remove('is-resizing'), 160);
});

/* ---------- boot ---------- */

Promise.all([loadContent(), loadAspects(), loadIcons(), loadColors()]).then(([c, a, , t]) => {
  content = c;
  aspects = a;
  tones = t || {};
  /* the intro gate belongs to the timeline. Land straight on /flow, /articles, /about or a
     painting and there is no gate to pass — so the wordmark and menu must already be up. */
  if (route() !== '/') entered = true;
  const wm = wordmark();
  document.title = [wm.l2, wm.l1].filter(Boolean).join(' — ');
  /* persistent chrome: wordmark + menu live outside the router */
  wmEl = buildWordmark(0);   // the title reveals first — the list and button are timed after it
  if (entered) wmEl.classList.add('is-ready');
  document.body.appendChild(wmEl);
  menuEl = buildMenu();
  if (entered) menuEl.classList.add('is-in');
  document.body.appendChild(menuEl);
  /* the first placement is not a journey — it is simply where the drop already is */
  requestAnimationFrame(() => placeBlob(false));
  addEventListener('resize', () => placeBlob(false));
  document.body.appendChild(el('div', 'noise'));   // film grain, above everything
  render();
});
})();

