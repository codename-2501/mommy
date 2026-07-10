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

  const wm = buildWordmark(entered ? 0 : logoStart);
  frag.appendChild(wm);

  const view = el('main', 'view view--home');
  frag.appendChild(view);

  const menu = buildMenu();
  frag.appendChild(menu);

  if (carousel) { carousel.destroy(); carousel = null; }
  carousel = window.TLBCarousel.mount(
    view, content.slides || [], aspects, yearsByName(),
    (s, item) => {
      const grab = (it) => {
        const img = it && it.querySelector('.car-media img');
        if (!img) return null;
        const r = img.getBoundingClientRect();
        if (r.right < 0 || r.left > innerWidth) return null;   // only visible ones fly
        return { rect: r, src: img.currentSrc || img.src };
      };
      const track = item.parentElement;
      pendingFlip = {
        cur: grab(item),
        prev: grab(item.previousElementSibling || track.lastElementChild),
        next: grab(item.nextElementSibling || track.firstElementChild),
      };
      navigate('/p/' + (s.id || ''));
    },
  );

  if (!entered) {
    wm.classList.add('at-intro');
    frag.appendChild(renderIntro(logoStart));
  } else {
    wm.classList.add('is-ready');
    menu.classList.add('is-in');
    view.classList.add('is-in');
  }
  return frag;
}

function renderStub(name) {
  const frag = document.createDocumentFragment();
  const logo = el('div', 'site-logo label is-in', wordmark().l2);
  frag.appendChild(logo);
  const view = el('main', 'view view-stub');
  view.appendChild(el('div', 'label', name));
  frag.appendChild(view);
  const menu = buildMenu();
  menu.classList.add('is-in');
  frag.appendChild(menu);
  return frag;
}

/* ---------- router ---------- */

/* detail close: the home re-enters with its full entrance (original Y() replays) */
function replayHomeEnter() {
  const view = document.querySelector('.view--home');
  if (!view) return;
  view.classList.add('no-trans');
  view.classList.remove('is-in');
  void view.offsetWidth;                        // apply the reset without animating
  view.classList.remove('no-trans');
  requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('is-in')));
}

function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';

  /* detail = overlay above the (kept) home — no home teardown, no flash */
  if (path.startsWith('/p/')) {
    if (!document.querySelector('.view--home')) {
      entered = true;                        // deep link: skip the gate
      if (carousel) { carousel.destroy(); carousel = null; }
      document.body.classList.add('lock');
      app.replaceChildren();
      app.appendChild(renderHome());
    }
    const flip = pendingFlip;
    pendingFlip = null;
    window.TLBDetail.open(app, {
      content, aspects,
      onSync: (i) => { if (carousel) carousel.goTo(i); },
      onClose: replayHomeEnter,
    }, path.slice(3), flip);
    return;
  }
  if (path === '/' && window.TLBDetail.isOpen && document.querySelector('.view--home')) {
    window.TLBDetail.close();                // back from detail: animate out, keep home
    return;
  }

  if (carousel) { carousel.destroy(); carousel = null; }
  document.body.classList.toggle('lock', path === '/');
  app.replaceChildren();
  if (path === '/') {
    app.appendChild(renderHome());
  } else if (path === '/surf') {
    app.appendChild(renderStub('surf'));
  } else if (path === '/articles') {
    app.appendChild(renderStub('index'));
  } else if (path === '/about') {
    app.appendChild(renderStub('about'));
  } else {
    app.appendChild(renderStub('not found'));
  }
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
  const wm = wordmark();
  document.title = [wm.l2, wm.l1].filter(Boolean).join(' — ');
  document.body.appendChild(el('div', 'noise'));   // film grain, above everything
  render();
});
})();
