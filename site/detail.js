/* LSE GALLERY — detail view (an overlay above the timeline; the painting flies into it).
   FLIP: clicked painting flies to the strip slot (1s "snappy").
   Panel: outer mask from +100%, inner from -100% (curtain), content reveals 1.15s expo. */
(() => {
'use strict';

let root = null;              // overlay element
let curId = null;
let closing = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function thumb(src, w) {
  const f = String(src || '').split('/').pop();
  return f ? window.LSEData.asset('/thumbs/' + w + '/' + encodeURIComponent(f)) : '';
}

function slideIdx(slides, id) {
  const i = slides.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

const { month, category } = window.LSEData;   // date first — see site/data.js

/* the work's year and month, as the admin has it: "February 2026" */
function dated(s) {
  const y = window.LSEData.year(s);
  const name = month(s);
  if (!y) return name;
  return name ? name + ' ' + y : y;
}

/* strip media cell: natural aspect, width-bound */
/* same shape as every other view: an unclipped slot holding the clipping frame that
   travels. The detail's paintings can therefore fly home on close. */
function mediaCell(s, aspects, cls) {
  const box = el('div', 'dt-media lse-slot ' + (cls || ''));
  box.dataset.id = s.id || '';
  const name = String(s.image || '').split('/').pop();
  box.style.aspectRatio = String(aspects[name] || 1);
  const frame = el('div', 'lse-frame');
  frame.dataset.id = s.id || '';
  const img = el('img');
  img.src = thumb(s.image, 600);
  img.alt = s.title || s.bottom || '';
  img.draggable = false;
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
  frame.appendChild(img);
  box.appendChild(frame);
  return box;
}

/* article body: paragraphs from desc, media interleaved by pos, aligned l/c/r */
function buildBody(s) {
  const body = el('div', 'dt-body');
  const paras = String(s.desc || '').split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const media = Array.isArray(s.media) && s.media.length
    ? s.media
    : (s.image ? [{ type: 'image', src: s.image, pos: -1 }] : []);
  const P = paras.length;
  const slot = (m) => {
    if (m.pos === -1) return -1;                      // implicit main image: skip in body
    if (m.pos == null || m.pos === '') return P;
    const k = parseInt(m.pos, 10);
    return isNaN(k) ? P : Math.max(0, Math.min(P, k));
  };
  const emit = (i) => {
    for (const m of media) {
      if (slot(m) !== i) continue;
      const fig = el('figure', 'dt-fig dt-fig--' + (m.align || 'center'));
      if (m.type === 'video' && (m.videoId || m.url)) {
        const vid = m.videoId || (String(m.url).match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([\w-]{6,})/) || [])[1];
        if (!vid) continue;
        const fr = el('div', 'dt-video');
        const ifr = document.createElement('iframe');
        ifr.src = 'https://www.youtube.com/embed/' + vid;
        ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
        ifr.allowFullscreen = true;
        fr.appendChild(ifr);
        fig.appendChild(fr);
      } else {
        const src = m.src || m.image;
        if (!src) continue;
        const img = el('img');
        img.src = window.LSEData.asset(src);           // body images: full quality
        img.loading = 'lazy';
        img.alt = m.caption || '';
        img.classList.add('dt-zoomable');
        img.addEventListener('click', () => lightbox(src, m.caption));
        fig.appendChild(img);
      }
      if (m.caption) fig.appendChild(el('figcaption', 'label', m.caption));
      body.appendChild(fig);
    }
  };
  emit(0);
  paras.forEach((p, i) => {
    body.appendChild(el('p', null, p));
    emit(i + 1);
  });
  return body;
}

function buildContent(s, i, slides) {
  const wrap = el('div', 'dt-content');
  const meta = el('div', 'dt-meta');
  if (category(s)) {
    const chipMask = el('div', 'dt-reveal');
    chipMask.appendChild(el('span', 'dt-chip', category(s)));
    meta.appendChild(chipMask);
  }
  if (month(s)) {
    const moMask = el('div', 'dt-reveal');
    moMask.appendChild(el('span', 'dt-month label', '(' + month(s) + ')'));
    meta.appendChild(moMask);
  }
  if (meta.children.length) wrap.appendChild(meta);
  if (s.title) {
    const h = el('h1', 'dt-title');
    const m = el('div', 'dt-reveal');
    m.appendChild(el('span', null, s.title));
    h.appendChild(m);
    wrap.appendChild(h);
  }
  /* spec rows (admin: 연월 / 제품 규격 / 제품 타입) */
  const when = dated(s);
  if (when || s.size || s.ptype) {
    const spec = el('div', 'dt-spec');
    const row = (k, v) => {
      const r = el('div', 'dt-spec__row dt-reveal');
      const inn = el('div', null);
      inn.appendChild(el('span', 'dt-spec__k label', k));
      inn.appendChild(el('span', 'dt-spec__v', v));
      r.appendChild(inn);
      spec.appendChild(r);
    };
    if (when) row('Date', when);
    if (s.size) row('Size', s.size);
    if (s.ptype) row('Type', s.ptype);
    wrap.appendChild(spec);
  }
  const fade = el('div', 'dt-fade');
  fade.appendChild(buildBody(s));
  wrap.appendChild(fade);
  return wrap;
}

function buildStrip(s, i, slides, aspects, nav) {
  const strip = el('div', 'dt-strip');
  const row = el('div', 'dt-strip__row');
  const prev = slides[(i - 1 + slides.length) % slides.length];
  const next = slides[(i + 1) % slides.length];

  const side = (sl, cls) => {
    const a = el('div', 'dt-side ' + cls);
    a.appendChild(mediaCell(sl, aspects));
    a.addEventListener('click', () => nav(sl.id));
    return a;
  };
  row.appendChild(side(prev, 'dt-side--prev'));

  const cur = el('div', 'dt-cur');
  const numMask = el('div', 'dt-reveal');
  numMask.appendChild(el('div', 'label', String(i + 1)));
  cur.appendChild(numMask);
  cur.appendChild(mediaCell(s, aspects, 'dt-cur__media'));
  const catText = [category(s), month(s) && '(' + month(s) + ')'].filter(Boolean).join(' ');
  if (catText) {
    const catMask = el('div', 'dt-reveal');
    catMask.appendChild(el('div', 'label', catText));
    cur.appendChild(catMask);
  }
  row.appendChild(cur);

  row.appendChild(side(next, 'dt-side--next'));
  strip.appendChild(row);
  /* empty strip area = Close */
  strip.addEventListener('click', (e) => {
    if (e.target === strip || e.target === row) window.LSEDetail.close();
  });
  return strip;
}

/* Both directions have always worked — the arrow keys call _nav(±1). Only Next was on screen,
   so a phone, which has no arrow keys, could walk the archive forwards and never back. */
const ARROW = '<svg viewBox="0 0 12 10" fill="none"><path d="M7.36 9.49 6.34 8.53 9.26 5.42H0V4.05h9.26L6.34.94 7.36 0l4.39 4.74-4.39 4.75Z" fill="currentColor"/></svg>';

function buildControls(nextId, onNext, onClose, onPrev) {
  const nav = el('nav', 'dt-controls');
  const pv = el('button', 'dt-ctl dt-ctl--prev');
  pv.innerHTML = ARROW;               // the same arrow, turned around in CSS
  pv.title = 'Previous';
  pv.addEventListener('click', onPrev);
  const nx = el('button', 'dt-ctl');
  nx.innerHTML = ARROW;
  nx.title = 'Next';
  nx.addEventListener('click', onNext);
  const cl = el('button', 'dt-ctl dt-ctl--close');
  cl.innerHTML = '<svg viewBox="0 0 17 17" fill="none"><rect x="3.5" y="4.9" width="2" height="12" transform="rotate(-45 3.5 4.9)" fill="currentColor"/><rect x="12" y="3.5" width="2" height="12" transform="rotate(45 12 3.5)" fill="currentColor"/></svg><span>Close</span>';
  cl.addEventListener('click', onClose);
  nav.appendChild(pv);
  nav.appendChild(nx);
  nav.appendChild(cl);
  return nav;
}

/* flight bookkeeping — rapid prev/next must cancel in-progress flights cleanly */
const pendingFlights = new Set();   // scheduled setTimeout ids
const activeFlights = new Set();    // {ghost, target, done}

function later(fn, ms) {
  const id = setTimeout(() => { pendingFlights.delete(id); fn(); }, ms);
  pendingFlights.add(id);
}

function cancelFlights() {
  for (const id of pendingFlights) clearTimeout(id);
  pendingFlights.clear();
  for (const f of activeFlights) {
    clearTimeout(f.done);
    f.img.style.transition = 'none';             // land instantly
    f.img.style.transform = '';
    f.img.style.transformOrigin = '';
    f.box.classList.remove('is-flying');
  }
  activeFlights.clear();
}

/* FLIP the way: reparent the actual <img> into the destination slot and
   animate it from its old screen position. The same painted pixels move — an image
   swap or blank frame is structurally impossible. */
function flyLive(fromSlot, toSlot) {
  const frame = fromSlot && fromSlot.querySelector('.lse-frame');
  if (!frame || !toSlot) return false;
  const f = fromSlot.getBoundingClientRect();
  const t = toSlot.getBoundingClientRect();
  if (!f.width || !t.width) return false;
  toSlot.replaceChildren(frame);                 // the frame moves house)
  fromSlot.style.visibility = 'hidden';          // the empty slot it left stays hidden
  toSlot.style.visibility = '';
  toSlot.classList.add('is-flying');             // overflow free during the flight
  frame.style.transition = 'none';
  frame.style.transform = 'translate(' + (f.left - t.left) + 'px,' + (f.top - t.top) +
    'px) scale(' + (f.width / t.width) + ')';
  void frame.offsetWidth;
  frame.style.transition = 'transform 900ms var(--ease-travel)';
  frame.style.transform = '';
  const rec = { img: frame, box: toSlot, done: 0 };
  activeFlights.add(rec);
  rec.done = setTimeout(() => {
    frame.style.transition = '';
    frame.style.transform = '';
    toSlot.classList.remove('is-flying');
    activeFlights.delete(rec);
  }, 950);
  return true;
}

/* lightbox — attached image at natural size (contained), click/Esc closes */
function lightbox(src, caption) {
  const lb = el('div', 'dt-lightbox');
  const img = el('img');
  img.src = window.LSEData.asset(src);
  lb.appendChild(img);
  if (caption) lb.appendChild(el('div', 'label dt-lightbox__cap', caption));
  lb.addEventListener('click', () => {
    lb.classList.remove('is-on');
    setTimeout(() => lb.remove(), 380);
  });
  document.body.appendChild(lb);
  requestAnimationFrame(() => requestAnimationFrame(() => lb.classList.add('is-on')));
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const lb = document.querySelector('.dt-lightbox');
  if (lb) { e.stopImmediatePropagation(); lb.click(); }
}, true);

/* panel smooth scroll — virtual-scroll feel (delta *0.9, lerp .1/frame), with a rubber-band at the
   ends so the page gives and springs back instead of stopping dead — the same feel as the index. */
function smoothScroll(sc) {
  let target = 0, cur = 0, last = 0, applied = -1, over = 0, overHold = 0;
  const OVER_MAX = 120;   // how far the rubber-band gives at an end, px
  const mult = /Win/.test(navigator.platform) ? 0.9 : 0.4;
  const body = () => sc.firstElementChild;   // the content the overshoot rides on
  sc.addEventListener('wheel', (e) => {
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    const lim = sc.scrollHeight - sc.clientHeight, next = target + raw * mult;
    /* whatever the wheel pushes past an edge goes into the overshoot at a fraction, capped, and
       springs back in the tick — a rubber-band, not a wall */
    if (next < 0) over += (-next) * 0.45;
    else if (next > lim) over -= (next - lim) * 0.45;
    over = Math.max(-OVER_MAX, Math.min(OVER_MAX, over));
    if (over !== 0) overHold = 8;   // hold the give while momentum is still arriving; spring when quiet
    target = Math.max(0, Math.min(lim, next));
    e.preventDefault();
  }, { passive: false });
  function tick(ts) {
    if (!sc.isConnected) return;
    const ratio = last ? Math.min(3, (ts - last) / (1000 / 60)) : 1;
    last = ts;
    if (applied >= 0 && Math.abs(sc.scrollTop - applied) > 1) {
      cur = target = sc.scrollTop;         // external scroll (anchors, scrollIntoView…)
    }
    cur += (target - cur) * 0.1 * ratio;
    sc.scrollTop = cur;
    applied = sc.scrollTop;
    if (over !== 0) {
      if (overHold > 0) overHold -= ratio;   // hold the give through momentum, spring once it goes quiet
      else over += (0 - over) * 0.11 * ratio;   // chewier spring — slower, fuller give than a snap-back
      if (Math.abs(over) < 0.4 && overHold <= 0) over = 0;
      const b = body();
      if (b) b.style.transform = over ? 'translateY(' + over.toFixed(1) + 'px)' : '';
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function render(container, opts, id, flip, dir) {
  const { content, aspects } = opts;
  const slides = content.slides || [];
  const i = slideIdx(slides, id);
  const s = slides[i];
  curId = id;

  const scroller = el('div', 'dt-scroll');
  scroller.appendChild(buildContent(s, i, slides));
  const inner = container.querySelector('.dt-panel__in');
  const oldSc = inner.querySelector('.dt-scroll:not(.dt-scroll--out)');
  if (oldSc && dir) {
    oldSc.classList.add('dt-scroll--out');       // : old content fades .35…
    scroller.classList.add('dt-scroll--in');     // …new content fades in right after
    setTimeout(() => oldSc.remove(), 400);
    inner.appendChild(scroller);
  } else {
    inner.replaceChildren(scroller);
  }
  smoothScroll(scroller);

  const old = container.querySelector('.dt-strip:not(.dt-strip--out)');
  const strip = buildStrip(s, i, slides, aspects, (nid) => go(nid));
  if (old) old.replaceWith(strip); else container.insertBefore(strip, container.firstChild);

  const oldCtl = container.querySelector('.dt-controls');
  const ctl = buildControls(null,
    () => go(slides[(i + 1) % slides.length].id),
    () => window.LSEDetail.close(),
    () => go(slides[(i - 1 + slides.length) % slides.length].id));
  if (oldCtl) oldCtl.replaceWith(ctl); else container.appendChild(ctl);

  /* item→item — role-shift: cur→prev slot and next→cur slot FLY (reverse
     for prev), the incoming far side slides in, the outgoing far side slides away */
  if (dir) {
    const os = dir.oldStrip;
    const fwd = dir.dir > 0;
    const inn2 = strip.querySelector(fwd ? '.dt-side--next .dt-media' : '.dt-side--prev .dt-media');
    if (inn2) {
      inn2.style.transition = 'none';
      inn2.style.transform = 'translateX(' + (fwd ? 110 : -110) + '%)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        inn2.style.transition = 'transform 900ms var(--ease-travel)';
        inn2.style.transform = '';
      }));
    }
    const flights = fwd ? [
      ['.dt-cur__media', '.dt-side--prev .dt-media', 0],
      ['.dt-side--next .dt-media', '.dt-cur__media', 35],
    ] : [
      ['.dt-cur__media', '.dt-side--next .dt-media', 0],
      ['.dt-side--prev .dt-media', '.dt-cur__media', 35],
    ];
    for (const [fromSel, toSel, delay] of flights) {
      const fb = os && os.querySelector(fromSel);
      const tb = strip.querySelector(toSel);
      if (!fb || !tb) continue;
      tb.style.visibility = 'hidden';    // before first paint
      if (delay) later(() => flyLive(fb, tb), delay);
      else flyLive(fb, tb);
    }
    const out = os && os.querySelector(fwd ? '.dt-side--prev .dt-media' : '.dt-side--next .dt-media');
    if (out) out.style.transform = 'translateX(' + (fwd ? -110 : 110) + '%)';
  }

  /* home→detail: the timeline waits for "page-done" (~200ms) before
     playing — a still beat, THEN fade+flights+panel start together as one */
  const start = () => {
    container.classList.remove('is-wait');
    void container.offsetWidth;
    container.classList.add('is-on');
    container.classList.add('is-rev');
    if (flip) {
      const slots = [
        [flip.cur, '.dt-cur__media', 0],
        [flip.prev, '.dt-side--prev .dt-media', 35],
        [flip.next, '.dt-side--next .dt-media', 70],
      ];
      for (const [src, sel, delay] of slots) {
        const box = strip.querySelector(sel);
        if (!box) continue;
        if (!src || !src.el) { box.style.visibility = ''; continue; }   // nothing flies here
        if (delay) later(() => flyLive(src.el, box), delay);
        else flyLive(src.el, box);
      }
    }
  };
  if (flip) {
    /* pre-hide the flight slots before the overlay ever paints */
    for (const sel of ['.dt-cur__media', '.dt-side--prev .dt-media', '.dt-side--next .dt-media']) {
      const box = strip.querySelector(sel);
      if (box) box.style.visibility = 'hidden';
    }
    container.classList.add('is-wait');
    later(start, 160);   // a beat of stillness before the painting takes off
  } else {
    start();
  }

  /* keyboard prev/next */
  container._nav = (delta) => go(slides[(i + delta + slides.length) % slides.length].id);

  function go(nid) {
    history.pushState(null, '', '/p/' + nid);
    /* rapid navigation: finish previous flights instantly, drop leaving strips */
    cancelFlights();
    container.querySelectorAll('.dt-strip--out').forEach((s2) => s2.remove());
    const ni = slideIdx(slides, nid);
    const fwd = ((ni - i + slides.length) % slides.length) <= slides.length / 2;
    strip.classList.add('dt-strip--out');           // labels fade; images handled below
    setTimeout(() => strip.remove(), 1100);
    container.classList.remove('is-rev');           // replay text reveals only
    render(container, opts, nid, null, { dir: fwd ? 1 : -1, oldStrip: strip });
  }
}

function open(parent, opts, id, flip) {
  closing = false;
  if (!root) {
    root = el('div', 'detail');
    root.appendChild(el('div', 'dt-bg'));   // home fades under us
    const panel = el('div', 'dt-panel');
    const inn = el('div', 'dt-panel__in');
    /* the header held nothing but a Close, and the bottom controls carry one — on every
       width now, so the panel has a single, visible way out instead of two */
    panel.appendChild(inn);
    root.appendChild(panel);
    parent.appendChild(root);
    root._opts = opts;
  }
  render(root, opts, id, flip);
}

function close() {
  if (!root || closing) return;
  closing = true;
  const cp = (root._opts && root._opts.closePath) || '/';
  if ((location.pathname.replace(/\/+$/, '') || '/') !== cp) history.pushState(null, '', cp);
  const opts = root._opts || {};
  cancelFlights();                               // settle any in-progress item flights
  /* NOW move the hidden carousel to the current painting
     — never at open, where the jump would be visible under the click */
  if (opts.onSync && opts.content) {
    opts.onSync(slideIdx(opts.content.slides || [], curId));
  }
  /* the leaving detail is handed to the SAME transition engine the views use: its
     paintings fly home (J) and the slots that get none rise (Y) — X/J/Y */
  const leavingRoot = root;
  if (opts.onLeave) opts.onLeave(leavingRoot);

  root.classList.add('is-off');
  root.classList.remove('is-on');
  setTimeout(() => {
    leavingRoot.remove();
    if (root === leavingRoot) { root = null; curId = null; }
    closing = false;
    if (opts.onGone) opts.onGone();              // any slot left empty gets its frame back
  }, 1150);
}

document.addEventListener('keydown', (e) => {
  if (!root || closing) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowRight' && root._nav) { e.preventDefault(); root._nav(1); }
  else if (e.key === 'ArrowLeft' && root._nav) { e.preventDefault(); root._nav(-1); }
});

window.LSEDetail = {
  open, close,
  get isOpen() { return !!root; },
  get id() { return curId; },
};
})();
