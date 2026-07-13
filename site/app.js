/* LSE GALLERY — painting archive frontend. Data: /api/content only. */
(() => {
'use strict';

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const app = document.getElementById('app');
let content = null;
let aspects = {};             // image filename -> width/height
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
    const r = await fetch('/api/content');
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

async function loadAspects() {
  try {
    const r = await fetch('/api/aspects');
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
      const r = await fetch(m.icon);
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
    const delay = si * step;
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
  gate.style.transitionDelay = (logoStart + 0.6).toFixed(2) + 's';
  const enter = el('button', 'btn', 'Enter →');
  enter.addEventListener('click', () => enterSite(intro));
  gate.appendChild(enter);
  intro.appendChild(gate);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    intro.classList.add('is-ready');
    const wm = document.querySelector('.wordmark');
    if (wm) wm.classList.add('is-ready');
    for (const run of scrambles) run();
  }));
  return intro;
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
  a.href = m.href;
  a.title = m.title;
  a.setAttribute('data-nav', '');
  a.innerHTML = icons[m.icon] || '';
  a.appendChild(el('span', 'menu__txt', m.title));   // mobile: text buttons
  const cur = location.pathname.replace(/\/+$/, '') || '/';
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
  return menu;
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
    view, content.slides || [], aspects, yearsByName(),
    (s, item) => {
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
    const slides = content.slides || [];
    const n = slides.length;
    const i = slides.findIndex((x) => x.id === s.id);
    const pack = (slot) => {
      const img = slot && slot.querySelector('img');
      if (!slot || !img) return null;
      const r = slot.getBoundingClientRect();
      if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return null;
      return { el: slot, src: img.currentSrc || img.src };
    };
    const slotFor = (k) => {
      const id = n && slides[((k % n) + n) % n].id;
      return id ? view.querySelector('.lse-slot[data-id="' + id + '"]') : null;
    };
    pendingFlip = {
      cur: pack(box),
      prev: i < 0 ? null : pack(slotFor(i - 1)),
      next: i < 0 ? null : pack(slotFor(i + 1)),
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
    return renderView('flow', (v, open) => window.LSEViews.mountFlow(v, slides, aspects, open));
  }
  if (path === '/articles') {
    return renderView('articles', (v, open) => window.LSEViews.mountIndex(v, slides, aspects, open));
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
function handOverIndex(fromPath, toArticles, oldCar, oldEl) {
  let idx = 0;
  if (fromPath === '/' && !toArticles) {
    idx = (oldCar && oldCar.activeIndex()) || 0;
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
  const rest = targetEls.filter((node) => !paired.has(node)).map(bind);
  /* leaving flow nothing flips (the paintings fly out instead) — every slot rises, top row first */
  const targets = fromFlow
    ? [...toFlips, ...rest].sort((a, b) => (Math.abs(a.bounds.top - b.bounds.top) > 1
      ? a.bounds.top - b.bounds.top
      : a.bounds.left - b.bounds.left))
    : rest;
  return {
    fromFlips: fromFlow ? seen : seen.filter((f) => ids.has(f.el.dataset.id)),
    toFlips,
    targets,
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
}

/* the painting's own frame moves house into its new slot and flies the delta home.
   No clone, no second <img> — the same pixels travel. */
function prepareFlip(fromFlips, toFlips, noStagger) {
  const byId = new Map(toFlips.map((t) => [t.el.dataset.id, t]));
  const flights = [];
  const owners = [];
  for (const from of fromFlips) {
    const to = byId.get(from.el.dataset.id);
    if (!to) continue;
    const owner = to.el.closest('.lse-card');
    if (owner) { owner.style.zIndex = '5'; owners.push(owner); }
    to.el.replaceChildren(from.el);
    to.el.style.visibility = '';        // a slot that lent its frame out was hidden — it is back
    const dx = from.bounds.left - to.bounds.left;
    const dy = from.bounds.top - to.bounds.top;
    const scale = to.bounds.width ? from.bounds.width / to.bounds.width : 1;
    from.el.style.transition = 'none';
    from.el.style.transform =
      'translate3d(' + dx + 'px,' + dy + 'px,0) scale(' + scale + ')';
    flights.push({ el: from.el, delay: noStagger ? 0 : flights.length * FLIP.stagger });
  }
  if (!flights.length) return null;
  return () => {
    for (const f of flights) {
      f.el.style.transition = 'transform ' + FLIP.dur + 'ms var(--ease-travel) ' + f.delay + 'ms';
      f.el.style.transform = '';
    }
    const last = flights[flights.length - 1];
    setTimeout(() => {
      for (const f of flights) { if (settled(f.el)) clearFlight(f.el); }
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

  if (fromFlow && !toAbout && oldInst && oldInst.exit) {
    leaving = { el: oldEl, inst: null, car: oldCar, timer: 0 };   // exit() already destroyed it
    oldInst.exit(done);                                  // the paintings fly out
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
  if (!fromFlow) oldEl.classList.add('is-exit');         // autoAlpha 0, .35s
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

  handOverIndex(oldPath, path === '/articles', oldCar, oldEl);
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

  const { fromFlips, toFlips, targets } = measureFlips(oldEl, view, flags.fromFlow);
  if (inst && inst.unfreeze) inst.unfreeze();           // flow: the deck angle eases in

  const skipFlip = flags.fromFlow && !flags.toAbout;    // flow leaves by flying its paintings out
  const playFlip = fromFlips.length && !skipFlip
    ? prepareFlip(fromFlips, toFlips, flags.toFlow)
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
}

/* ---------- router ---------- */

/* give a slot its painting back — used when the frame it lent out cannot fly home */
function restoreSlot(f) {
  if (!f.box.querySelector('.lse-frame')) {
    const frame = el('div', 'lse-frame');
    frame.dataset.id = f.box.dataset.id || '';
    const img = document.createElement('img');
    img.src = f.src;
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
  const path = location.pathname.replace(/\/+$/, '') || '/';

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
      closePath: lastViewPath,
      onSync: (i) => { if (carousel) carousel.goTo(i); },
      onLeave: flyDetailHome,     // the paintings fly back into the view +
      onGone: restoreFlipSources,
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
    a.classList.toggle('active', a.getAttribute('href') === path);
  });
}

function navigate(href) {
  /* the menu marks where you already are, and tapping that button used to tear the view down
     and play its arrival again — the paintings flew back in over a page that never left */
  const to = String(href).replace(/\/+$/, '') || '/';
  const at = location.pathname.replace(/\/+$/, '') || '/';
  if (to === at) return;
  history.pushState(null, '', href);
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

Promise.all([loadContent(), loadAspects(), loadIcons()]).then(([c, a]) => {
  content = c;
  aspects = a;
  /* the intro gate belongs to the timeline. Land straight on /flow, /articles, /about or a
     painting and there is no gate to pass — so the wordmark and menu must already be up. */
  if ((location.pathname.replace(/\/+$/, '') || '/') !== '/') entered = true;
  const wm = wordmark();
  document.title = [wm.l2, wm.l1].filter(Boolean).join(' — ');
  /* persistent chrome: wordmark + menu live outside the router */
  wmEl = buildWordmark(entered ? 0 : introLogoStart(content.slides));
  if (entered) wmEl.classList.add('is-ready');
  document.body.appendChild(wmEl);
  menuEl = buildMenu();
  if (entered) menuEl.classList.add('is-in');
  document.body.appendChild(menuEl);
  document.body.appendChild(el('div', 'noise'));   // film grain, above everything
  render();
});
})();

