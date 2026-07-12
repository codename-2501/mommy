/* THE LOOKBACK — Surf (card deck), Index (collage grid), About.
   Mechanics ported from the originals: surf = C1kfZrZv.js, grid smooth-scroll
   with rotateX tilt = Bx_gN5Pg.js, about = wyNRnxoT.js. */
(() => {
'use strict';

const LERP = 0.1;
const WHEEL_MULT = /Win/.test(navigator.platform) ? 0.9 : 0.4;

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

/* every framed painting fades in when it loads, and keeps that .ok wherever it flies to */
function gateLoad(img) {
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
}

function isSmall() {
  return matchMedia('(max-width:699px)').matches;
}

function category(s) {
  return String(s.category || '').trim() ||
    String(s.bottom || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function month(s) {
  const m = /\(([^)]+)\)\s*$/.exec(String(s.bottom || ''));
  return m ? m[1].trim() : '';
}

/* ---------------- SURF: floating card deck (original values) ---------------- */
function mountSurf(view, slides, aspects, onOpen) {
  const wrap = el('div', 'surf');
  const inner = el('div', 'surf__inner');
  const deck = el('div', 'surf__deck');
  inner.appendChild(deck);
  wrap.appendChild(inner);
  const hoverLbl = el('div', 'surf__label label');
  wrap.appendChild(hoverLbl);
  view.appendChild(wrap);

  const items = slides.map((s, i) => {
    const it = el('article', 'surf-item js-flip-o');
    const media = el('div', 'surf-item__media');
    const box = el('div', 'surf-item__box js-flip-target');
    box.dataset.id = s.id || '';
    const name = String(s.image || '').split('/').pop();
    box.style.aspectRatio = String(aspects[name] || 1);
    const frame = el('div', 'tlb-frame js-flip');
    frame.dataset.id = s.id || '';
    const img = el('img');
    img.src = thumb(s.image, 600);
    img.draggable = false;
    img.loading = i < 10 ? 'eager' : 'lazy';
    gateLoad(img);
    frame.appendChild(img);
    box.appendChild(frame);
    media.appendChild(box);
    it.appendChild(media);
    it.addEventListener('mouseenter', () => {
      hoverLbl.textContent = '(' + (i + 1) + ') ' + [category(s), month(s)].filter(Boolean).join(' / ');
      hoverLbl.classList.add('is-on');
    });
    it.addEventListener('mouseleave', () => hoverLbl.classList.remove('is-on'));
    it.addEventListener('click', () => { if (!moved) onOpen(s, frame); });
    deck.appendChild(it);
    return { el: it, s };
  });

  /* original: P=18 (6 mobile), spread=ww/P, sine bob, rotateY(-70 - 15p) */
  let bounds = [], total = 0, rest = 0, time = 0;
  let target = 0, cur = 0, vel = 0, deckK = 0;
  let dragging = false, moved = false, sx = 0, sy = 0, st = 0, raf = 0, lastTs = 0;

  function measure() {
    const P = isSmall() ? 6 : 18;
    const spread = innerWidth / P;
    rest = (innerHeight / (P * 1.5)) * 0.35;
    bounds = items.map((it, i) => {
      it.el.style.transform = 'translate3d(0,0,0)';
      const x = spread * i;
      it.el.style.transform = 'translate3d(' + x + 'px,0,0)';
      const r = it.el.getBoundingClientRect();
      const w = r.width;
      return { start: r.left - w - innerWidth, end: r.right + w, left: r.left, width: w };
    });
    const last = bounds[bounds.length - 1];
    total = Math.max(0, last ? last.end - bounds[0].width : 0);
  }

  function place(i, wrapped) {
    const b = bounds[i];
    const inside = wrapped > b.start && wrapped < b.end;
    let prog = 0;
    if (inside) prog = 1 - Math.max(0, Math.min(1, 1 + (wrapped - b.left - b.width) / (innerWidth + b.width)));
    const p = 1 - prog;
    const xo = p - 0.5;
    const bob = Math.sin(time + xo * Math.PI * 2) * rest * (1 + vel * 0.01);
    const y = innerHeight * 0.5 * xo + bob;
    const rotY = (-(15 * p) - 70) * deckK;
    items[i].el.style.transform =
      'translate3d(' + (b.left - wrapped) + 'px,' + y + 'px,0) rotateY(' + rotY + 'deg)';
  }

  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    cur += (target - cur) * LERP * ratio;
    cur = Math.round(cur * 100) / 100;
    vel = Math.round((cur - target) * 1000) / 1000;
    time += 0.02 * ratio;
    if (total > 0) {
      for (let i = 0; i < items.length; i++) {
        const b = bounds[i];
        let w = (cur - (b.end - total)) % total;
        if (w < 0) w += total;
        w += b.end - total;
        place(i, w);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function onDown(e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; st = target; }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 10) moved = true;
    target = st - dx * (isSmall() ? 3.5 : 2);
  }
  function onUp() { dragging = false; }
  function onWheel(e) {
    if (window.TLBDetail && window.TLBDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target += raw * WHEEL_MULT;
  }
  function onKey(e) {
    if (window.TLBDetail && window.TLBDetail.isOpen) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const lefts = bounds.map((b) => b.left);
    const near = lefts.reduce((a, v, i2) => Math.abs(v - target) < Math.abs(lefts[a] - target) ? i2 : a, 0);
    const nx = e.key === 'ArrowRight' ? Math.min(near + 4, items.length - 1) : Math.max(near - 4, 0);
    target = lefts[nx];
  }
  wrap.addEventListener('pointerdown', onDown);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('resize', measure);

  /* original: measure, jump to the work the last view was on, then report "page-done" */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    measure();                      // after insertion — detached rects are all zero
    const idx = parseInt(document.body.dataset.index, 10);
    if (idx > 0 && bounds[idx]) { target = bounds[idx].left; cur = target; }
    markReady();
  });
  raf = requestAnimationFrame(frame);

  /* original: the deck angle only eases in once the transition says so (surf-unfreeze) */
  let unfrozen = false;
  function unfreeze() {
    if (unfrozen) return;
    unfrozen = true;
    const k0 = performance.now();
    (function step() {
      const t = Math.min(1, (performance.now() - k0) / 1000);
      deckK = 1 - Math.pow(1 - t, 4);
      if (t < 1) requestAnimationFrame(step);
    })();
  }

  function destroy() {
    cancelAnimationFrame(raf);
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('wheel', onWheel);
    removeEventListener('keydown', onKey);
    removeEventListener('resize', measure);
  }

  return {
    ready,
    unfreeze,
    destroy,
    /* original V(): the paintings themselves leave — y to the viewport top, then a further
       -150% of their own height. power2.in .5s, stagger .025. The cards stay behind. */
    exit(done) {
      destroy();
      const frames = wrap.querySelectorAll('.js-flip');
      let k = 0;
      for (const f of frames) {
        const r = f.getBoundingClientRect();
        if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) continue;
        f.style.transition = 'transform .5s cubic-bezier(.55,.085,.68,.53) ' + (k * 0.025) + 's';
        f.style.transform = 'translate3d(0,' + (-r.top) + 'px,0) translateY(-150%)';
        k += 1;
      }
      setTimeout(done, 500 + k * 25);
    },
  };
}

/* -------- smooth scroll w/ tilt (original: lerp .125, rotateX(vel * -.02)) -------- */
function smoothTilt(outer, content) {
  let target = 0, cur = 0, max = 0, lastTs = 0, raf = 0;
  const tilts = () => content.querySelectorAll('.js-tilt');
  function measure() {
    max = Math.max(0, content.getBoundingClientRect().height - outer.clientHeight);
  }
  function onWheel(e) {
    if (window.TLBDetail && window.TLBDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target = Math.max(0, Math.min(max, target + raw * WHEEL_MULT));
  }
  function onKey(e) {
    if (window.TLBDetail && window.TLBDetail.isOpen) return;
    const wh = innerHeight;
    if (e.key === 'ArrowDown') { e.preventDefault(); target = Math.min(max, target + 100); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); target = Math.max(0, target - 100); }
    else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); target = Math.min(max, target + wh); }
    else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); target = Math.max(0, target - wh); }
    else if (e.key === 'Home') { target = 0; }
    else if (e.key === 'End') { target = max; }
  }
  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    const v = cur - target;
    cur += (target - cur) * 0.125 * ratio;
    content.style.transform = 'translate3d(0,' + (-cur) + 'px,0)';
    const ry = 'rotateX(' + (v * -0.02) + 'deg)';
    tilts().forEach((t) => { t.style.transform = ry; });
    raf = requestAnimationFrame(frame);
  }
  addEventListener('wheel', onWheel, { passive: true });
  addEventListener('keydown', onKey);
  addEventListener('resize', measure);
  requestAnimationFrame(() => { measure(); });
  raf = requestAnimationFrame(frame);
  return {
    scrollTo(y) { target = cur = Math.max(0, Math.min(max, y)); },
    measure,
    destroy() {
      cancelAnimationFrame(raf);
      removeEventListener('wheel', onWheel);
      removeEventListener('keydown', onKey);
      removeEventListener('resize', measure);
    },
  };
}

/* ---------------- INDEX: 12-per-row collage grid (original values) ---------------- */
function mountIndex(view, slides, aspects, onOpen) {
  const outer = el('div', 'agrid');
  const content = el('div', 'agrid__in');
  outer.appendChild(content);
  view.appendChild(outer);

  const perRow = isSmall() ? 4 : 12;
  let row = null, seenMonth = '';
  slides.forEach((s, i) => {
    if (i % perRow === 0) {
      row = el('div', 'agrid__row js-tilt');
      content.appendChild(row);
    }
    const cell = el('article', 'agrid__cell js-flip-o');
    cell.dataset.index = String(i);          // original: the row lookup that hands the index on
    const name = String(s.image || '').split('/').pop();
    const box = el('div', 'agrid__media js-flip-target');
    box.dataset.id = s.id || '';
    box.style.aspectRatio = String(aspects[name] || 1);
    const frame = el('div', 'tlb-frame js-flip');
    frame.dataset.id = s.id || '';
    const img = el('img');
    img.src = thumb(s.image, 300);
    img.loading = i < perRow * 3 ? 'eager' : 'lazy';
    img.draggable = false;
    gateLoad(img);
    frame.appendChild(img);
    box.appendChild(frame);
    cell.appendChild(box);
    const mo = month(s);
    if (mo && mo !== seenMonth) {
      seenMonth = mo;
      const lbl = el('div', 'agrid__month');
      const rev = el('div', 'dt-reveal');
      rev.appendChild(el('div', 'label', mo));
      lbl.appendChild(rev);
      cell.appendChild(lbl);
    }
    cell.addEventListener('click', () => onOpen(s, frame));
    row.appendChild(cell);
  });

  const sc = smoothTilt(outer, content);

  /* original: scroll straight to the handed-over work's row, then report "page-done" */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    sc.measure();
    const idx = parseInt(document.body.dataset.index, 10);
    const cells = content.querySelectorAll('[data-index]');
    const cell = idx > 0 ? cells[idx] : null;
    if (cell && cells[0]) {
      sc.scrollTo(cell.getBoundingClientRect().top - cells[0].getBoundingClientRect().top);
    }
    markReady();
  });
  return { ready, destroy: sc.destroy, measure: sc.measure, scrollTo: sc.scrollTo };
}

/* ---------------- ABOUT: black page, big lines, credits ---------------- */
function mountAbout(view, content) {
  const texts = (content && content.texts && content.texts['/about']) || {};
  const wm = (content && content.wordmark) || {};
  const title = texts.title ||
    '"' + (wm.l2 || 'The Lookback') + '"\n(SE/2026)\nA living\narchive of\n' + (wm.l1 || 'LSE Gallery');
  const intro = texts.intro ||
    '승은(Seung Eun)의 1년, 195점의 유화를 한 곳에 모은 디지털 아카이브입니다. 계절을 지나며 그린 꽃과 풍경, 실험적인 화면들이 월별 타임라인으로 이어집니다. 붓이 지나간 순서대로, 한 해의 기록을 돌아봅니다.';
  const thanks = texts.thanks || 'Thank you for\nlooking back with us.\n\n계속 그리겠습니다.';

  const page = el('div', 'about');
  const maskOuter = el('div', 'about__mask');
  const maskInner = el('div', 'about__mask-in');
  const scroller = el('div', 'about__scroll');

  const head = el('div', 'about__head');
  const l1 = el('div', 'label dt-reveal');
  l1.appendChild(el('div', null, '(' + (wm.l2 || 'TLB') + ')'));
  const l2 = el('div', 'label dt-reveal');
  l2.appendChild(el('div', null, '(25-26)'));
  head.appendChild(l1);
  head.appendChild(l2);
  scroller.appendChild(head);

  const h1 = el('h1', 'about__title');
  title.split(/\n/).forEach((line) => {
    const m = el('div', 'about__line');
    m.appendChild(el('div', 'about__line-in', line));
    h1.appendChild(m);
  });
  scroller.appendChild(h1);

  const introEl = el('div', 'about__intro about__fade');
  intro.split(/\n+/).forEach((p) => introEl.appendChild(el('p', null, p)));
  scroller.appendChild(introEl);

  const thanksEl = el('div', 'about__thanks');
  thanks.split(/\n/).forEach((line) => {
    if (!line.trim()) return;
    thanksEl.appendChild(el('div', null, line));
  });
  scroller.appendChild(thanksEl);

  /* Noun Project attribution (CC BY 3.0 — the plan's only allowed original credit) */
  const cred = el('div', 'about__credits label');
  [['timeline', 'Justin Blake', '3643975'], ['flow', 'Abdul Matic', '7813263'],
   ['collage', 'Mustofa Bayu', '6753741'], ['profile', 'Evan Shuster', '139147']]
    .forEach(([name, author, id]) => {
      cred.appendChild(el('div', null,
        '"' + name + '" by ' + author + ' — Noun Project (nounproject.com/icon/' + id + ') / CC BY 3.0'));
    });
  scroller.appendChild(cred);

  maskInner.appendChild(scroller);
  maskOuter.appendChild(maskInner);
  page.appendChild(maskOuter);
  view.appendChild(page);

  const sc = smoothTilt(maskInner, scroller);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    view.classList.add('is-in');
    setTimeout(() => sc.measure(), 600);
  }));
  return sc;
}

window.TLBViews = { mountSurf, mountIndex, mountAbout };
})();
