/* THE LOOKBACK — rebuilt frontend. Data: /api/content only. */
(() => {
'use strict';

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];
const app = document.getElementById('app');
let content = null;
let entered = false;          // intro gate passed this page-load

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

/* ---------- intro gate ---------- */

function buildLine(text, letterIndex) {
  const line = el('div', 'line');
  for (const word of text.split(/\s+/)) {
    const w = el('div', 'word');
    for (const ch of word) {
      const l = el('div', 'ltr', ch);
      l.style.setProperty('--d', (letterIndex.line * 0.12 + letterIndex.i * 0.028).toFixed(3) + 's');
      l.style.setProperty('--dx', (letterIndex.i * 0.012).toFixed(3) + 's');
      letterIndex.i += 1;
      w.appendChild(l);
    }
    line.appendChild(w);
  }
  return line;
}

function renderIntro() {
  const intro = el('div', 'intro');
  const wm = wordmark();

  const logo = el('div', 'intro-logo');
  const idx = { i: 0, line: 0 };
  for (const text of [wm.l1, wm.l2, wm.l3]) {
    if (!text) continue;
    logo.appendChild(buildLine(text, idx));
    idx.line += 1;
  }
  intro.appendChild(logo);

  /* month list — 2 columns: Jan–Jul / Aug–Dec */
  const stats = monthStats(content.slides);
  const months = el('div', 'intro-months label');
  const colA = el('div', 'col');
  const colB = el('div', 'col');
  for (const s of stats) {
    const row = el('div', 'row');
    row.appendChild(el('span', null, s.cat || s.month));
    row.appendChild(el('span', 'n', '(' + s.count + ')'));
    (MONTHS.indexOf(s.month) < 7 ? colA : colB).appendChild(row);
  }
  months.appendChild(colA);
  months.appendChild(colB);
  intro.appendChild(months);

  /* enter gate */
  const gate = el('div', 'intro-gate label');
  const withSound = el('button', null, 'Enter with sound →');
  const noSound = el('button', null, '…or without');
  withSound.addEventListener('click', () => enterSite(intro, true));
  noSound.addEventListener('click', () => enterSite(intro, false));
  gate.appendChild(withSound);
  gate.appendChild(noSound);
  intro.appendChild(gate);

  requestAnimationFrame(() => requestAnimationFrame(() => intro.classList.add('is-ready')));
  return intro;
}

function enterSite(intro) {
  if (entered) return;
  entered = true;
  intro.classList.add('is-leaving');
  const logo = document.querySelector('.site-logo');
  const menu = document.querySelector('.menu');
  setTimeout(() => {
    intro.remove();
    if (logo) logo.classList.add('is-in');
    if (menu) menu.classList.add('is-in');
  }, 950);
}

/* ---------- views ---------- */

function renderHome() {
  const frag = document.createDocumentFragment();

  const logo = el('div', 'site-logo label', wordmark().l2);
  frag.appendChild(logo);

  const view = el('main', 'view');           // carousel lands here in Phase 2
  frag.appendChild(view);

  const menu = el('nav', 'menu');            // frosted menu lands here in Phase 2
  frag.appendChild(menu);

  if (!entered) {
    frag.appendChild(renderIntro());
  } else {
    logo.classList.add('is-in');
    menu.classList.add('is-in');
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
  return frag;
}

/* ---------- router ---------- */

function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  app.replaceChildren();
  if (path === '/') {
    app.appendChild(renderHome());
  } else if (path === '/surf') {
    app.appendChild(renderStub('surf'));
  } else if (path === '/articles') {
    app.appendChild(renderStub('index'));
  } else if (path === '/about') {
    app.appendChild(renderStub('about'));
  } else if (path.startsWith('/p/')) {
    app.appendChild(renderStub(path.slice(3)));
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

loadContent().then((c) => {
  content = c;
  const wm = wordmark();
  document.title = [wm.l2, wm.l1].filter(Boolean).join(' — ');
  render();
});
})();
