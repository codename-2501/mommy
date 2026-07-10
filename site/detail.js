/* THE LOOKBACK — detail view (overlay above home, original transition values).
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
  return f ? '/thumbs/' + w + '/' + encodeURIComponent(f) : '';
}

function slideIdx(slides, id) {
  const i = slides.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

function category(s) {
  return String(s.category || '').trim() ||
    String(s.bottom || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function month(s) {
  const m = /\(([^)]+)\)\s*$/.exec(String(s.bottom || ''));
  return m ? m[1].trim() : '';
}

/* strip media cell: natural aspect, width-bound */
function mediaCell(s, aspects, cls) {
  const box = el('div', 'dt-media ' + (cls || ''));
  const name = String(s.image || '').split('/').pop();
  box.style.aspectRatio = String(aspects[name] || 1);
  const img = el('img');
  img.src = thumb(s.image, 600);
  img.alt = s.title || s.bottom || '';
  img.draggable = false;
  box.appendChild(img);
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
        img.src = src;                                 // body images: full quality
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
  /* product spec rows (admin: 제품 규격 / 제품 타입) */
  if (s.size || s.ptype) {
    const spec = el('div', 'dt-spec');
    const row = (k, v) => {
      const r = el('div', 'dt-spec__row dt-reveal');
      const inn = el('div', null);
      inn.appendChild(el('span', 'dt-spec__k label', k));
      inn.appendChild(el('span', 'dt-spec__v', v));
      r.appendChild(inn);
      spec.appendChild(r);
    };
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
  /* empty strip area = Close (original: backdrop click navigates back) */
  strip.addEventListener('click', (e) => {
    if (e.target === strip || e.target === row) window.TLBDetail.close();
  });
  return strip;
}

function buildControls(nextId, onNext, onClose) {
  const nav = el('nav', 'dt-controls');
  const nx = el('button', 'dt-ctl');
  nx.innerHTML = '<svg viewBox="0 0 12 10" fill="none"><path d="M7.36 9.49 6.34 8.53 9.26 5.42H0V4.05h9.26L6.34.94 7.36 0l4.39 4.74-4.39 4.75Z" fill="currentColor"/></svg>';
  nx.title = 'Next';
  nx.addEventListener('click', onNext);
  const cl = el('button', 'dt-ctl dt-ctl--close');
  cl.innerHTML = '<svg viewBox="0 0 17 17" fill="none"><rect x="3.5" y="4.9" width="2" height="12" transform="rotate(-45 3.5 4.9)" fill="currentColor"/><rect x="12" y="3.5" width="2" height="12" transform="rotate(45 12 3.5)" fill="currentColor"/></svg><span>Close</span>';
  cl.addEventListener('click', onClose);
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
    f.ghost.remove();
    if (f.target) f.target.style.visibility = '';
  }
  activeFlights.clear();
}

/* FLIP: fly a clone into a slot. The ghost lives INSIDE the overlay at z5 so the
   flight passes UNDER the right panel, like the original's reparented figures. */
function flipInto(fromRect, imgSrc, targetBox, host, srcEl) {
  const t = targetBox.getBoundingClientRect();
  if (!fromRect || !t.width) return;
  const ghost = el('div', 'dt-ghost');
  const img = el('img');
  img.src = imgSrc;
  ghost.appendChild(img);
  Object.assign(ghost.style, {
    left: t.left + 'px', top: t.top + 'px',
    width: t.width + 'px', height: t.height + 'px',
  });
  const dx = fromRect.left - t.left, dy = fromRect.top - t.top;
  const sc = fromRect.width / t.width;
  ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sc + ')';
  (host || document.body).appendChild(ghost);
  targetBox.style.visibility = 'hidden';
  const rec = { ghost, target: targetBox, done: 0 };
  activeFlights.add(rec);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (srcEl) srcEl.style.visibility = 'hidden';   // only once the ghost is painted
    ghost.style.transform = 'translate(0,0) scale(1)';
  }));
  rec.done = setTimeout(() => {
    targetBox.style.visibility = '';
    ghost.remove();
    activeFlights.delete(rec);
  }, 1050);
}

/* lightbox — attached image at natural size (contained), click/Esc closes */
function lightbox(src, caption) {
  const lb = el('div', 'dt-lightbox');
  const img = el('img');
  img.src = src;
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

/* panel smooth scroll — original virtual-scroll feel (delta *0.9, lerp .1/frame) */
function smoothScroll(sc) {
  let target = 0, cur = 0, last = 0, applied = -1;
  const mult = /Win/.test(navigator.platform) ? 0.9 : 0.4;
  sc.addEventListener('wheel', (e) => {
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, target + raw * mult));
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
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function render(container, opts, id, flip, dir) {
  const { content, aspects, onSync } = opts;
  const slides = content.slides || [];
  const i = slideIdx(slides, id);
  const s = slides[i];
  curId = id;
  if (onSync) onSync(i);

  const scroller = el('div', 'dt-scroll');
  scroller.appendChild(buildContent(s, i, slides));
  const inner = container.querySelector('.dt-panel__in');
  const oldSc = inner.querySelector('.dt-scroll:not(.dt-scroll--out)');
  if (oldSc && dir) {
    oldSc.classList.add('dt-scroll--out');       // original: old content fades .35
    setTimeout(() => oldSc.remove(), 400);
    inner.appendChild(scroller);
  } else {
    inner.replaceChildren(scroller);
  }
  smoothScroll(scroller);

  const old = container.querySelector('.dt-strip:not(.dt-strip--out)');
  const strip = buildStrip(s, i, slides, aspects, (nid) => go(nid));
  if (dir) strip.classList.add('dt-strip--in');  // sides fade in after the swap
  if (old) old.replaceWith(strip); else container.insertBefore(strip, container.firstChild);

  const oldCtl = container.querySelector('.dt-controls');
  const ctl = buildControls(null,
    () => go(slides[(i + 1) % slides.length].id),
    () => window.TLBDetail.close());
  if (oldCtl) oldCtl.replaceWith(ctl); else container.appendChild(ctl);

  /* item→item — original role-shift: cur→prev slot and next→cur slot FLY (reverse
     for prev), the incoming far side slides in, the outgoing far side slides away */
  if (dir) {
    const os = dir.oldStrip;
    const fwd = dir.dir > 0;
    const inn2 = strip.querySelector(fwd ? '.dt-side--next .dt-media' : '.dt-side--prev .dt-media');
    if (inn2) {
      inn2.style.transition = 'none';
      inn2.style.transform = 'translateX(' + (fwd ? 110 : -110) + '%)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        inn2.style.transition = 'transform 1s var(--ease-snappy)';
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
      const r = fb.getBoundingClientRect();
      const img = fb.querySelector('img');
      tb.style.visibility = 'hidden';    // before first paint
      later(() => flipInto(r, img ? (img.currentSrc || img.src) : '', tb, container, fb), delay);
    }
    const out = os && os.querySelector(fwd ? '.dt-side--prev .dt-media' : '.dt-side--next .dt-media');
    if (out) out.style.transform = 'translateX(' + (fwd ? -110 : 110) + '%)';
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    container.classList.add('is-on');
    container.classList.add('is-rev');
  }));
  /* original: every matching visible painting flies to its slot, stagger .035 */
  if (flip) {
    const slots = [
      [flip.cur, '.dt-cur__media', 0],
      [flip.prev, '.dt-side--prev .dt-media', 35],
      [flip.next, '.dt-side--next .dt-media', 70],
    ];
    for (const [src, sel, delay] of slots) {
      if (!src) continue;
      const box = strip.querySelector(sel);
      if (!box) continue;
      box.style.visibility = 'hidden';   // before first paint — no pop-in flash
      later(() => flipInto(src.rect, src.src, box, container), delay);
    }
  }

  /* keyboard prev/next (original slug page keydown) */
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
    root.appendChild(el('div', 'dt-bg'));   // home fades under us (original: .35s)
    const panel = el('div', 'dt-panel');
    const inn = el('div', 'dt-panel__in');
    const head = el('header', 'dt-head');
    const close = el('button', null, 'Close');
    close.addEventListener('click', () => window.TLBDetail.close());
    head.appendChild(close);
    panel.appendChild(inn);
    panel.appendChild(head);
    root.appendChild(panel);
    parent.appendChild(root);
    root._opts = opts;
  }
  render(root, opts, id, flip);
}

function close() {
  if (!root || closing) return;
  closing = true;
  if ((location.pathname.replace(/\/+$/, '') || '/') !== '/') history.pushState(null, '', '/');
  const opts = root._opts || {};
  cancelFlights();                               // settle any in-progress item flights
  if (opts.onClose) opts.onClose();              // home replays its entrance underneath

  /* original: the strip paintings FLY BACK to their carousel slots (reverse flip) */
  const strip = root.querySelector('.dt-strip:not(.dt-strip--out)');
  if (strip && opts.getHomeTarget && opts.content) {
    const slides = opts.content.slides || [];
    const n = slides.length;
    const i = slideIdx(slides, curId);
    const pairs = [
      ['.dt-cur__media', i, 0],
      ['.dt-side--prev .dt-media', (i - 1 + n) % n, 35],
      ['.dt-side--next .dt-media', (i + 1) % n, 70],
    ];
    for (const [sel, k, delay] of pairs) {
      const box = strip.querySelector(sel);
      const target = box && opts.getHomeTarget(k);
      if (!box || !target) continue;
      const t = target.getBoundingClientRect();
      if (t.right < 0 || t.left > innerWidth) continue;   // fly only into view
      const r = box.getBoundingClientRect();
      const img = box.querySelector('img');
      target.style.visibility = 'hidden';                 // before the home is unveiled
      later(() => flipInto(r, img ? (img.currentSrc || img.src) : '', target, root, box), delay);
    }
  }

  root.classList.add('is-off');
  root.classList.remove('is-on');
  setTimeout(() => {
    if (root) root.remove();
    root = null; curId = null; closing = false;
  }, 1150);
}

document.addEventListener('keydown', (e) => {
  if (!root || closing) return;
  if (e.key === 'Escape') close();
  else if (e.key === 'ArrowRight' && root._nav) { e.preventDefault(); root._nav(1); }
  else if (e.key === 'ArrowLeft' && root._nav) { e.preventDefault(); root._nav(-1); }
});

window.TLBDetail = {
  open, close,
  get isOpen() { return !!root; },
  get id() { return curId; },
};
})();
