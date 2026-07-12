/* THE LOOKBACK — rebuilt frontend. Data: /api/content only. */
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
let activeView = null;        // surf/index/about instance (destroy on route change)
let lastViewPath = '/';       // where the detail Close returns to
let viewEl = null;            // the view that is CURRENT — never the one on its way out
let leaving = null;           // {el, inst, car, timers} still animating out
let navGen = 0;               // a newer navigation retires the transition in flight
let wmEl = null;              // persistent wordmark (survives route changes)
let menuEl = null;            // persistent menu

/* audio flags — "Enter with sound" turns on tick/click sounds (original) */
window.TLB_AUDIO = { on: false };
let clickAudio = null;
document.addEventListener('click', () => {
  if (!window.TLB_AUDIO.on) return;
  if (!clickAudio) clickAudio = new Audio('/site/assets/click.mp3');
  clickAudio.currentTime = 0;
  clickAudio.play().catch(() => {});
});

/* menu icons — Noun Project, CC BY 3.0 (credits inside each SVG file) */
const MENU = [
  { href: '/',         icon: '/icons/timeline.svg', key: 'timeline', title: 'Timeline' },
  { href: '/surf',     icon: '/icons/flow.svg',     key: 'flow',     title: 'Surf' },
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

async function loadContent() {
  try {
    const r = await fetch('/api/content');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
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
    l1: (w.l1 || '').trim(),
    l2: (w.l2 || 'THE LOOKBACK').trim(),
    l3: (w.l3 || '').trim(),
  };
}

/* per-month aggregation from slide `bottom` labels: "Inspire (January)" */
function monthStats(slides) {
  const stats = MONTHS.map((m) => ({ month: m, cat: '', count: 0 }));
  for (const s of slides || []) {
    const bottom = String(s.bottom || '');
    const m = /\(([^)]+)\)\s*$/.exec(bottom);
    if (!m) continue;
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === m[1].trim().toLowerCase());
    if (idx < 0) continue;
    const cat = String(s.category || '').trim() ||
      bottom.replace(/\s*\([^)]*\)\s*$/, '').trim();
    stats[idx] = {
      month: MONTHS[idx],
      cat: stats[idx].cat || cat,
      count: stats[idx].count + 1,
    };
  }
  return stats.filter((s) => s.count > 0);
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

/* scramble-text reveal (original uses GSAP ScrambleText — same feel, vanilla) */
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
  const interval = 50;                  // scramble refresh (= gsap speed .05)
  let start = null;
  let scr = randChars(text.length);
  let last = 0;
  node.textContent = '';
  function tick(ts) {
    if (start === null) start = ts + delay;
    if (ts < start) { requestAnimationFrame(tick); return; }
    const t = Math.min(1, (ts - start) / dur);   // linear reveal (original ease:"none")
    const shown = Math.floor(t * text.length + 0.5);
    if (ts - last > interval) { scr = randChars(text.length); last = ts; }
    node.textContent = text.slice(0, shown) + scr.slice(shown, text.length);
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = text;
  }
  requestAnimationFrame(tick);
}

/* ---------- wordmark (persistent big logo) ---------- */

/* original: lines rise with yPercent:105 + clip reveal, 1.5s "snappy", stagger .1 */
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

function renderIntro(logoStart) {
  const intro = el('div', 'intro');

  /* month list — 2 columns: Jan–Jul / Aug–Dec */
  const stats = monthStats(content.slides);
  const months = el('div', 'intro-months label');
  const colA = el('div', 'col');
  const colB = el('div', 'col');
  /* original: each visual LINE scrambles in for .5s, ease none, stagger .075 */
  const years = yearByMonth(content.slides);
  const scrambles = [];
  let row = 0;
  stats.forEach((s) => {
    /* original structure: month name (+year), then indented category (count) line */
    const block = el('div', 'mo');
    const monthRow = el('div', 'row');
    const monthIn = el('span', 'in m');
    const monthName = el('span', null, '');
    const yearEl = el('span', 'n', '');
    monthIn.appendChild(monthName);
    monthIn.appendChild(yearEl);
    monthRow.appendChild(monthIn);
    const catRow = el('div', 'row pl');
    const catIn = el('span', 'in');
    const cat = el('span', null, '');
    const n = el('span', 'n', '');
    catIn.appendChild(cat);
    catIn.appendChild(n);
    catRow.appendChild(catIn);
    block.appendChild(monthRow);
    block.appendChild(catRow);
    (MONTHS.indexOf(s.month) < 7 ? colA : colB).appendChild(block);
    const year = years[MONTHS.indexOf(s.month) + 1] || '2026';
    const dMonth = row * 75; row += 1;
    const dCat = row * 75; row += 1;
    scrambles.push(() => {
      scrambleIn(monthName, s.month.toUpperCase(), dMonth, 500);
      scrambleIn(yearEl, year, dMonth, 500);
      scrambleIn(cat, s.cat || '', dCat, 500);
      scrambleIn(n, '(' + s.count + ')', dCat, 500);
    });
  });
  months.appendChild(colA);
  months.appendChild(colB);
  intro.appendChild(months);

  /* enter gate — appears alongside the wordmark phase of the timeline */
  const gate = el('div', 'intro-gate');
  gate.style.transitionDelay = (logoStart + 0.6).toFixed(2) + 's';
  const withSound = el('button', 'btn', 'Enter with sound →');
  const noSound = el('button', 'alt', '…or without');
  withSound.addEventListener('click', () => enterSite(intro, true));
  noSound.addEventListener('click', () => enterSite(intro, false));
  gate.appendChild(withSound);
  gate.appendChild(noSound);
  intro.appendChild(gate);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    intro.classList.add('is-ready');
    const wm = document.querySelector('.wordmark');
    if (wm) wm.classList.add('is-ready');
    for (const run of scrambles) run();
  }));
  return intro;
}

function enterSite(intro, withSound) {
  if (entered) return;
  entered = true;
  window.TLB_AUDIO.on = !!withSound;
  const gate = intro.querySelector('.intro-gate');
  if (gate) gate.style.transitionDelay = '0s';
  intro.classList.add('is-leaving');
  /* every list line scrambles out — original: to(lines, {scrambleText:"", stagger:.035}) */
  intro.querySelectorAll('.intro-months .row').forEach((row, k) => {
    row.querySelectorAll('.in > span').forEach((sp) => {
      setTimeout(() => scrambleOut(sp, 500), k * 35);
    });
  });
  const wm = document.querySelector('.wordmark');
  const menu = document.querySelector('.menu');
  const home = document.querySelector('.view--home');
  setTimeout(() => { if (wm) wm.classList.remove('at-intro'); }, 400);   // rides up 1.5s expo
  setTimeout(() => { if (home) home.classList.add('is-in'); }, 900);     // slides rise underneath
  setTimeout(() => { if (menu) menu.classList.add('is-in'); }, 1100);
  setTimeout(() => intro.remove(), 2400);
}

/* ---------- views ---------- */

function menuLink(m) {
  const a = el('a', null);
  a.href = m.href;
  a.title = m.title;
  a.setAttribute('data-nav', '');
  a.innerHTML = icons[m.icon] || '';
  a.appendChild(el('span', 'menu__txt', m.title));   // mobile: text buttons (original)
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

  /* wordmark reveal starts as the month list finishes (original: label "-=.5") */
  const rows = monthStats(content.slides).length * 2;
  const logoStart = Math.max(0, 500 + (rows - 1) * 75 - 500) / 1000;

  const view = el('main', 'view view--home');
  frag.appendChild(view);

  if (carousel) { carousel.destroy(); carousel = null; }
  carousel = window.TLBCarousel.mount(
    view, content.slides || [], aspects, yearsByName(),
    (s, item) => {
      carousel.freeze();   // stop the lerp drift so the flip source stays put
      const grab = (it) => {
        const slot = it && it.querySelector('.js-flip-target');
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

/* surf/index/about — the persistent wordmark + menu stay; only the view swaps */
function renderView(name, mount) {
  const frag = document.createDocumentFragment();
  const view = el('main', 'view view--' + name);
  frag.appendChild(view);
  const openFrom = (s, box) => {
    const img = box && box.querySelector('img');
    pendingFlip = { cur: img ? { el: box, src: img.currentSrc || img.src } : null, prev: null, next: null };
    flipSources = img ? [{ box, src: img.currentSrc || img.src }] : [];
    navigate('/p/' + (s.id || ''));
  };
  activeView = mount(view, openFrom);
  return frag;
}

function buildView(path) {
  const slides = content.slides || [];
  if (path === '/') return renderHome();
  if (path === '/surf') {
    return renderView('surf', (v, open) => window.TLBViews.mountSurf(v, slides, aspects, open));
  }
  if (path === '/articles') {
    return renderView('articles', (v, open) => window.TLBViews.mountIndex(v, slides, aspects, open));
  }
  if (path === '/about') {
    return renderView('about', (v) => window.TLBViews.mountAbout(v, content));
  }
  return renderStub('not found');
}

/* ---------- page transition (ported from the original DNhanIij.js) ---------- */

const FLIP = { dur: 1000, stagger: 35 };                          // 1s "snappy"
const RISE = { dur: 1150, stagger: 35, start: 250, fromSurf: 575 };  // 1.15s "expo"
const FADE = 350;                                                 // .35s "power1"

function nextFrame() {
  return new Promise((res) => requestAnimationFrame(() => res()));
}

/* original K(): the incoming view reports "page-done" — never wait longer than 200ms */
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

/* original B(): hand the work the viewer was on over to the incoming view */
function handOverIndex(fromPath, toArticles, oldCar, oldEl) {
  let idx = 0;
  if (fromPath === '/' && !toArticles) {
    idx = (oldCar && oldCar.activeIndex()) || 0;
  } else if (fromPath === '/articles' && oldEl) {
    const mid = innerHeight / 2;
    let best = null, bestD = Infinity;
    for (const row of oldEl.querySelectorAll('.js-tilt')) {
      const d = Math.abs(row.getBoundingClientRect().top - mid);
      if (d < bestD) { bestD = d; best = row; }
    }
    const cell = best && best.querySelector('[data-index]');
    idx = cell ? parseInt(cell.dataset.index, 10) || 0 : 0;
  }
  document.body.dataset.index = String(idx);
}

/* original W(): pair the leaving paintings with the incoming slots by work id.
   Only what the viewer can actually see takes part — plus the centred carousel slide. */
function measureFlips(oldEl, newEl, fromSurf) {
  const bind = (node) => ({ el: node, bounds: node.getBoundingClientRect() });
  const targetEls = [...newEl.querySelectorAll('.js-flip-target')];
  const flipEls = oldEl ? [...oldEl.querySelectorAll('.js-flip')] : [];
  if (!flipEls.length) return { fromFlips: [], toFlips: [], targets: targetEls.map(bind) };

  const seen = [];
  for (const node of flipEls) {
    const b = node.getBoundingClientRect();
    if (inView(b) || node.closest('.js-slide-active')) seen.push({ el: node, bounds: b });
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
  /* leaving surf nothing flips (the paintings fly out instead) — every slot rises, top row first */
  const targets = fromSurf
    ? [...toFlips, ...rest].sort((a, b) => (Math.abs(a.bounds.top - b.bounds.top) > 1
      ? a.bounds.top - b.bounds.top
      : a.bounds.left - b.bounds.left))
    : rest;
  return {
    fromFlips: fromSurf ? seen : seen.filter((f) => ids.has(f.el.dataset.id)),
    toFlips,
    targets,
  };
}

/* original J(): the painting's own frame moves house into its new slot and flies the
   delta home. No clone, no second <img> — the same pixels travel. */
function prepareFlip(fromFlips, toFlips, noStagger) {
  const byId = new Map(toFlips.map((t) => [t.el.dataset.id, t]));
  const flights = [];
  const owners = [];
  for (const from of fromFlips) {
    const to = byId.get(from.el.dataset.id);
    if (!to) continue;
    const owner = to.el.closest('.js-flip-o');
    if (owner) { owner.style.zIndex = '5'; owners.push(owner); }
    to.el.replaceChildren(from.el);
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
      f.el.style.transition = 'transform ' + FLIP.dur + 'ms var(--ease-snappy) ' + f.delay + 'ms';
      f.el.style.transform = '';
    }
    const last = flights[flights.length - 1];
    setTimeout(() => {
      for (const f of flights) { f.el.style.transition = ''; f.el.style.transform = ''; }
      for (const o of owners) o.style.zIndex = '';
    }, FLIP.dur + last.delay + 50);
  };
}

/* original Y(): slots with no painting of their own coming in rise from below the fold */
function prepareRise(targets, fromSurf, toSurf) {
  const start = fromSurf ? RISE.fromSurf : RISE.start;
  const risers = [];
  for (const t of targets) {
    const b = t.bounds;
    if (b.bottom < 0 || b.top > innerHeight || b.right < -100 || b.left > innerWidth + 100) continue;
    const y = -((b.top - innerHeight) * (toSurf ? 1.25 : 1));
    t.el.style.transition = 'none';
    t.el.style.transform = 'translate3d(0,' + y + 'px,0) scale(.9)';
    risers.push({ el: t.el, delay: start + (risers.length + 1) * RISE.stagger });
  }
  if (!risers.length) return null;
  return () => {
    for (const r of risers) {
      r.el.style.transition = 'transform ' + RISE.dur + 'ms var(--ease-out-expo) ' + r.delay + 'ms';
      r.el.style.transform = '';
    }
    const last = risers[risers.length - 1];
    setTimeout(() => {
      for (const r of risers) { r.el.style.transition = ''; r.el.style.transform = ''; }
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

/* the old page leaves WHILE the new one arrives (original: mode "", both mounted) */
function leave(oldEl, oldInst, oldCar, flags) {
  if (!oldEl) return;
  const { fromSurf, fromAbout, toAbout } = flags;
  const done = () => { if (leaving && leaving.el === oldEl) finalizeLeaving(); };

  if (fromSurf && !toAbout && oldInst && oldInst.exit) {
    leaving = { el: oldEl, inst: null, car: oldCar, timer: 0 };   // exit() already destroyed it
    oldInst.exit(done);                                  // V(): the paintings fly out
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
  if (!fromSurf) oldEl.classList.add('is-exit');         // autoAlpha 0, .35s
  leaving = { el: oldEl, timer: setTimeout(done, fromSurf ? 1050 : FADE + 50) };
}

async function transition(path, oldEl, oldInst, oldCar, oldPath, gen) {
  const flags = {
    fromSurf: oldPath === '/surf',
    fromAbout: oldPath === '/about',
    toSurf: path === '/surf',
    toAbout: path === '/about',
  };
  const toCarousel = path === '/' || path === '/surf';   // the views that jump to an index

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

  const { fromFlips, toFlips, targets } = measureFlips(oldEl, view, flags.fromSurf);
  if (inst && inst.unfreeze) inst.unfreeze();           // surf: the deck angle eases in

  const skipFlip = flags.fromSurf && !flags.toAbout;    // surf leaves by flying its paintings out
  const playFlip = fromFlips.length && !skipFlip
    ? prepareFlip(fromFlips, toFlips, flags.toSurf)
    : null;
  const playRise = prepareRise(targets, flags.fromSurf, flags.toSurf);

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

/* a slot whose frame flew into the detail and never came home (its slide was off screen
   by the time we closed) is given a fresh frame once the detail is gone */
function restoreFlipSources() {
  for (const f of flipSources) {
    if (!f.box.querySelector('.js-flip')) {
      const frame = el('div', 'tlb-frame js-flip');
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
  flipSources = [];
}

/* detail close: the leaving detail goes through the SAME engine as any other view —
   its paintings fly back into their slots (J), the slots that receive none rise (Y) */
async function flyDetailHome(detailEl) {
  const view = viewEl;
  if (!view || !detailEl) return;
  await nextFrame();                            // let the carousel's jump to this work land
  const { fromFlips, toFlips, targets } = measureFlips(detailEl, view, false);
  const playFlip = fromFlips.length ? prepareFlip(fromFlips, toFlips, false) : null;
  const playRise = prepareRise(targets, false, false);
  void view.offsetWidth;                        // paint the from-state before it animates
  requestAnimationFrame(() => {
    if (playFlip) playFlip();
    if (playRise) playRise();
  });
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
    window.TLBDetail.open(app, {
      content, aspects,
      closePath: lastViewPath,
      onSync: (i) => { if (carousel) carousel.goTo(i); },
      onLeave: flyDetailHome,     // the paintings fly back into the view (original J() + Y())
      onGone: restoreFlipSources,
    }, path.slice(3), flip);
    return;
  }
  if (window.TLBDetail.isOpen && path === lastViewPath) {
    window.TLBDetail.close();                // back from detail: animate out, keep the view
    return;
  }

  /* exit choreography (original: old page leaves WHILE the new one enters) */
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

/* ---------- boot ---------- */

Promise.all([loadContent(), loadAspects(), loadIcons()]).then(([c, a]) => {
  content = c;
  aspects = a;
  if (matchMedia('(max-width:699px)').matches) entered = true;   // original: no gate on mobile
  const wm = wordmark();
  document.title = [wm.l2, wm.l1].filter(Boolean).join(' — ');
  /* persistent chrome: wordmark + menu live outside the router (original layout level) */
  const rows0 = monthStats(content.slides).length * 2;
  const logoStart0 = Math.max(0, 500 + (rows0 - 1) * 75 - 500) / 1000;
  wmEl = buildWordmark(entered ? 0 : logoStart0);
  if (entered) wmEl.classList.add('is-ready');
  document.body.appendChild(wmEl);
  menuEl = buildMenu();
  if (entered) menuEl.classList.add('is-in');
  document.body.appendChild(menuEl);
  document.body.appendChild(el('div', 'noise'));   // film grain, above everything
  render();
});
})();
