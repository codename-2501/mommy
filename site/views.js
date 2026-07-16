/* LSE GALLERY — Flow (3D card deck), Index (collage grid), About.
   Flow: sine-bobbing deck with a rotateY tilt. Index: smooth-scrolled 12-column grid
   whose rows tilt with the scroll velocity. About: curtain page with line reveals. */
(() => {
'use strict';

const LERP = 0.12;                                              // chase, per frame
const WHEEL_MULT = /Win/.test(navigator.platform) ? 1 : 0.45;   // wheel feels lighter on mac

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

/* every framed painting fades in when it loads, and keeps that .ok wherever it flies to */
function gateLoad(img) {
  if (img.complete) img.classList.add('ok');
  else img.addEventListener('load', () => img.classList.add('ok'), { once: true });
}

/* The page has two drawings, a phone's and a desktop's, and it used to switch between their
   numbers at a single pixel of window: seven paintings abreast became sixteen, a card 20rem wide
   became 28.1rem, a drag that travelled 3.6x became 2.2x. Nothing about a 701px window is twice
   as wide as a 699px one, so nothing about it should be drawn twice as loosely.
   `span` is where the window stands between the two drawings, 0 at the phone's width and 1 at the
   desktop's, and every number that differed between them is read off it. Counts land on whole
   numbers, so they step one at a time, at the width where one more actually fits. */
function span() {
  return Math.max(0, Math.min(1, (innerWidth - 390) / (1500 - 390)));
}
function tween(small, large) {
  return small + (large - small) * span();
}

const { MONTHS, month, category } = window.LSEData;   // date first — see site/data.js

/* month name -> year, exactly as the timeline ruler resolves it: take it from any slide
   dated in that month, and fall back to 2026 for the months nobody dated */
function yearsByMonth(slides) {
  const byNum = {};
  for (const s of slides || []) {
    const m = /^(\d{4})-(\d{2})/.exec(String(s.date || ''));
    if (m) byNum[+m[2]] = m[1];
  }
  const out = {};
  MONTHS.forEach((name, i) => { out[name] = byNum[i + 1] || '2026'; });
  return out;
}

/* ---------------- FLOW: floating card deck ---------------- */
function mountFlow(view, slides, aspects, onOpen, opts) {
  const wrap = el('div', 'flow');
  const inner = el('div', 'flow__inner');
  const deck = el('div', 'flow__deck');
  inner.appendChild(deck);
  wrap.appendChild(inner);
  const hoverLbl = el('div', 'flow__label label');
  wrap.appendChild(hoverLbl);
  view.appendChild(wrap);

  /* the same timeline the carousel carries. The deck runs the same works in the same order,
     so the question the ruler asks — which work is under the centre line — has an answer here
     too; it simply had no one to ask it. */
  const ruler = window.LSERuler.create(view, slides, Object.assign({ monthOf: month }, opts || {}));
  requestAnimationFrame(() => ruler.el.classList.add('is-on'));

  const items = slides.map((s, i) => {
    const it = el('article', 'flow-item lse-card');
    const media = el('div', 'flow-item__media');
    const box = el('div', 'flow-item__box lse-slot');
    box.dataset.id = s.id || '';
    const name = String(s.image || '').split('/').pop();
    box.style.aspectRatio = String(aspects[name] || 1);
    const frame = el('div', 'lse-frame');
    frame.dataset.id = s.id || '';
    const img = el('img');
    img.src = thumb(s.image, 600);
    img.draggable = false;
    img.loading = 'eager';   // the deck moves cards by transform; lazy never fires (see carousel)
    gateLoad(img);
    frame.appendChild(img);
    box.appendChild(frame);
    media.appendChild(box);
    it.appendChild(media);
    /* the painting slides 75% aside on hover — out from under the cursor. This layer stays
       put over the card's spot, so the hover (and the click) has something stable
       to land on instead of flickering onto whichever neighbour moves in underneath. */
    it.appendChild(el('div', 'flow-item__hit'));
    it.addEventListener('mouseenter', () => {
      hoverLbl.textContent = '(' + (i + 1) + ') ' + [category(s), month(s)].filter(Boolean).join(' / ');
      hoverLbl.classList.add('is-on');
      hoverIdx = i;      // the deck sorts by 3D depth, so the lifted card is pulled forward:
    });                  // z-index cannot raise it inside a preserve-3d parent
    it.addEventListener('mouseleave', () => {
      hoverLbl.classList.remove('is-on');
      if (hoverIdx === i) hoverIdx = -1;
    });
    it.addEventListener('click', () => { if (!moved) onOpen(s, box); });
    deck.appendChild(it);
    return { el: it, s };
  });

  /* the deck: cards are spread across the viewport width, bob on a sine wave as they pass,
     and stand at an angle that eases open when the view arrives */
  let bounds = [], total = 0, rest = 0, time = 0;
  let cardGap = 0, lapWorks = 0;         // px between cards, and works in one lap of the deck
  let target = 0, cur = 0, vel = 0, deckK = 0;
  let dragging = false, moved = false, sx = 0, sy = 0, st = 0, raf = 0, lastTs = 0;
  let hoverIdx = -1;              // the card the cursor is lifting (see mouseenter above)

  function measure() {
    const P = Math.round(tween(7, 16));   // cards abreast across the viewport
    const spread = innerWidth / P;
    rest = (innerHeight / (P * 1.5)) * 0.4;   // bob amplitude
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
    /* The deck loops every `total` px, and that is not exactly one work per card-width: the
       first card's offset and its own width ride along in it. Measured in works, a lap is
       `lapWorks`, which is a little more than the archive holds. The ruler is given the lap as
       a fraction and stretched over the archive, so the timeline comes round exactly when the
       deck does — feed it the raw count instead and the ruler would jump back a work or so
       every time the deck crossed its seam. */
    cardGap = bounds.length > 1 ? bounds[1].left - bounds[0].left : innerWidth;
    lapWorks = cardGap > 0 ? total / cardGap : slides.length;
    ruler.resize();
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
    const rotY = (-(18 * p) - 66) * deckK;   // deck angle, opening as the card comes forward
    /* the hovered card slides 75% sideways — pull it forward in the deck's 3D space so it
       passes OVER its neighbours instead of under them */
    const z = i === hoverIdx ? 60 : 0;
    items[i].el.style.transform =
      'translate3d(' + (b.left - wrapped) + 'px,' + y + 'px,' + z + 'px) rotateY(' + rotY + 'deg)';
  }

  function frame(ts) {
    const ratio = lastTs ? Math.min(3, (ts - lastTs) / (1000 / 60)) : 1;
    lastTs = ts;
    cur += (target - cur) * LERP * ratio;
    cur = Math.round(cur * 100) / 100;
    vel = Math.round((cur - target) * 1000) / 1000;
    time += 0.022 * ratio;
    if (total > 0) {
      for (let i = 0; i < items.length; i++) {
        const b = bounds[i];
        let w = (cur - (b.end - total)) % total;
        if (w < 0) w += total;
        w += b.end - total;
        place(i, w);
      }
      const f = (cur + innerWidth * 0.5 - bounds[0].left) / cardGap;   // work under the line
      let lap = f % lapWorks;
      if (lap < 0) lap += lapWorks;
      ruler.update(lap * (slides.length / lapWorks), ratio);
    }
    raf = requestAnimationFrame(frame);
  }

  function onDown(e) { dragging = true; moved = false; sx = e.clientX; sy = e.clientY; st = target; }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - sx;
    if (Math.abs(dx) > 10) moved = true;
    target = st - dx * tween(3.6, 2.2);   // drag travel
  }
  function onUp() { dragging = false; }
  function onWheel(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target += raw * WHEEL_MULT;
  }
  function onKey(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
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

  /* : measure, jump to the work the last view was on, then report "page-done" */
  let markReady;
  const ready = new Promise((res) => { markReady = res; });
  requestAnimationFrame(() => {
    measure();                      // after insertion — detached rects are all zero
    const idx = parseInt(document.body.dataset.index, 10);
    if (idx > 0 && bounds[idx]) { target = bounds[idx].left; cur = target; }
    markReady();
  });
  raf = requestAnimationFrame(frame);

  /* : the deck angle only eases in once the transition says so (flow-unfreeze) */
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
    ruler.destroy();          // it listens for resize of its own
  }

  function stopInput() {
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
    /* the work under the centre line — the same one the ruler reads. Handed to the next view so it
       opens on the same paintings, which is what lets them carry over the way timeline↔index do. */
    activeIndex() {
      if (!cardGap) return 0;
      const f = (cur + innerWidth * 0.5 - bounds[0].left) / cardGap;
      let lap = f % lapWorks;
      if (lap < 0) lap += lapWorks;
      const work = Math.round(lap * (slides.length / lapWorks));
      return ((work % slides.length) + slides.length) % slides.length;
    },
    /* Turn the deck to face the viewer — the reverse of the fan opening on arrival. In the fan the
       cards stand at 70–84°, edge-on, and edge-on their on-screen rectangles are slivers a flip
       cannot carry; flat they are whole rectangles again. Easing deckK to 0 lays them flat where
       they are (the frame loop keeps applying it), and once flat the paintings can be measured
       clean and flown to their slots in the next view. */
    flatten() {
      stopInput();
      target = cur;
      return new Promise((res) => {
        const t0 = performance.now(), DUR = 300, startK = deckK;
        (function flat() {
          const t = Math.min(1, (performance.now() - t0) / DUR);
          deckK = startK * (1 - Math.pow(t, 4));         // the open's ease-out, reversed
          if (t < 1) requestAnimationFrame(flat);
          else res();
        })();
      });
    },
    /* the fallback for leaving where nothing can carry over (About's curtain has no slots): the
       fan simply folds shut and the view fades, the mirror of it opening on arrival. */
    exit(done) {
      stopInput();
      target = cur;
      const t0 = performance.now(), DUR = 720, startK = deckK;
      view.style.willChange = 'opacity';
      (function close() {
        const t = Math.min(1, (performance.now() - t0) / DUR);
        deckK = startK * (1 - Math.pow(t, 4));
        view.style.opacity = String(1 - t * t);
        if (t < 1) requestAnimationFrame(close);
        else { destroy(); done(); }
      })();
    },
  };
}

/* -------- smooth scroll: same machinery as the detail panel, so the pages share one feel.
   It used to move the content with a transform and hand-roll the drag and the fling, which
   on a phone meant a scroll that neither carried the system's momentum nor bounced at the
   ends — beside the detail's native scroll it read as a different page. The container scrolls
   natively now: the finger gets the OS's own physics, and the wheel gets the same lerp the
   detail uses. The rows still tilt, driven by the speed the scroll is actually running at. -------- */
function smoothTilt(outer, content) {
  let target = 0, cur = 0, lastTs = 0, raf = 0, applied = -1, prevTop = 0;
  const mult = /Win/.test(navigator.platform) ? 0.9 : 0.4;   // detail.js: same numbers
  const tilts = () => content.querySelectorAll('.lse-row');
  /* the tilt is a scroll-driven CSS animation (app.css: rowTilt) wherever the browser has one:
     the compositor draws it, so it survives a phone's momentum scroll, and every row shares the
     scrollport's vanishing point. The script only steps in for a browser without it. */
  const cssTilt = () =>
    typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline', 'view()');
  const limit = () => Math.max(0, outer.scrollHeight - outer.clientHeight);
  function measure() { target = Math.min(target, limit()); }

  function onWheel(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    const raw = e.wheelDeltaY !== undefined ? -e.wheelDeltaY : e.deltaY;
    target = Math.max(0, Math.min(limit(), target + raw * mult));
    e.preventDefault();                     // the lerp owns the wheel, not the browser
  }
  function onKey(e) {
    if (window.LSEDetail && window.LSEDetail.isOpen) return;
    const wh = innerHeight, max = limit();
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
    /* a touch (or any scroll we did not drive) moves scrollTop under us — follow it rather
       than fight it, exactly as the detail does */
    if (applied >= 0 && Math.abs(outer.scrollTop - applied) > 1) cur = target = outer.scrollTop;
    cur += (target - cur) * 0.1 * ratio;    // detail.js: same lerp
    outer.scrollTop = cur;
    applied = outer.scrollTop;

    /* the tilt rides the speed the page is actually moving at, so it works the same whether
       the wheel, a finger or the system's momentum is driving it */
    const v = outer.scrollTop - prevTop;
    prevTop = outer.scrollTop;
    /* a phone's rows are a quarter the width, so the same angle bends them a quarter as far
       across the screen — it takes more angle there to read as the same lean */
    /* where the compositor draws the tilt itself (a phone, see app.css: rowTilt) the script
       must keep its hands off the transform — an inline one every frame would fight it */
    if (!cssTilt()) {
      const deg = Math.max(-22, Math.min(22, v * 0.45));
      const ry = 'perspective(600px) rotateX(' + deg + 'deg)';
      tilts().forEach((t) => { t.style.transform = ry; });
    }
    raf = requestAnimationFrame(frame);
  }

  outer.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('keydown', onKey);
  addEventListener('resize', measure);
  const ro = new ResizeObserver(measure);   // images land late; the limit must follow
  ro.observe(content);
  raf = requestAnimationFrame(frame);
  return {
    scrollTo(y) {
      target = cur = Math.max(0, Math.min(limit(), y));
      outer.scrollTop = cur; applied = outer.scrollTop; prevTop = outer.scrollTop;
    },
    measure,
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      outer.removeEventListener('wheel', onWheel);
      removeEventListener('keydown', onKey);
      removeEventListener('resize', measure);
    },
  };
}

/* ---------------- INDEX: collage grid, 12 per row ---------------- */
function mountIndex(view, slides, aspects, onOpen) {
  const outer = el('div', 'agrid');
  const content = el('div', 'agrid__in');
  outer.appendChild(content);
  view.appendChild(outer);

  const perRow = Math.round(tween(4, 12));
  const years = yearsByMonth(slides);
  let row = null, seenMonth = '';
  slides.forEach((s, i) => {
    if (i % perRow === 0) {
      row = el('div', 'agrid__row lse-row');
      /* the row is as many columns wide as it holds. It used to be twelve in the stylesheet and
         four on a phone, while the count of cells put in it was decided here — so the moment the
         count became a continuous thing, the two stopped agreeing and a row of seven was laid out
         across twelve columns. One of them has to own the number, and it is this one. */
      row.style.gridTemplateColumns = 'repeat(' + perRow + ',1fr)';
      content.appendChild(row);
    }
    const cell = el('article', 'agrid__cell lse-card');
    cell.dataset.index = String(i);          // : the row lookup that hands the index on
    const name = String(s.image || '').split('/').pop();
    const box = el('div', 'agrid__media lse-slot');
    box.dataset.id = s.id || '';
    box.style.aspectRatio = String(aspects[name] || 1);
    const frame = el('div', 'lse-frame');
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
      const txt = el('div', 'label', mo);
      /* same rule as the ruler: this work's own year, else the month's, else 2026 */
      const own = /^(\d{4})/.exec(String(s.date || ''));
      txt.dataset.year = (own && own[1]) || years[mo] || '2026';
      rev.appendChild(txt);
      lbl.appendChild(rev);
      cell.appendChild(lbl);
    }
    cell.addEventListener('click', () => onOpen(s, box));
    row.appendChild(cell);
  });

  const sc = smoothTilt(outer, content);
  /* the month labels ride up out of their masks on .is-in — without it they stay clipped */
  requestAnimationFrame(() => requestAnimationFrame(() => view.classList.add('is-in')));

  /* : scroll straight to the handed-over work's row, then report "page-done" */
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

/* One CV entry, whichever shape the admin saved it in.

     v1  {date:'2025.03', text:'…'}                  date and text, no group
     v2  {text:'…', note:'2024.10, 루브르박물관'}      the year and the place, run together
     v3  {text:'…', date:'2024.10', place:'루브르박물관'}

   The year and the place were one field, so a date could not be read, sorted or set apart from
   the venue it happened to sit beside. They part here, and the old rows part with them: a note
   splits at its first comma — the half that reads as a date is the date. */
function cvItem(it) {
  const o = it || {};
  const text = String(o.text ?? '').trim();
  let date = String(o.date ?? '').trim();
  let place = String(o.place ?? '').trim();

  if (!date && !place && o.note) {
    const note = String(o.note).trim();
    const cut = note.indexOf(',');
    const head = (cut < 0 ? note : note.slice(0, cut)).trim();
    const tail = cut < 0 ? '' : note.slice(cut + 1).trim();
    if (/\d/.test(head)) { date = head; place = tail; }   // "2024.10, 루브르박물관"
    else { place = note; }                                //  no year in it: it is all a place
  }
  return { text, date, place, textEn: String(o.textEn ?? '').trim() };
}

/* ---------------- ABOUT: black page, big lines, credits ---------------- */
/* One About block -> one element. The page is whatever list the admin composed, in that
   order: copy and pictures interleave freely, so nothing here may assume a fixed shape. */
function aboutBlock(b) {
  const text = (b.text || '').trim();

  if (b.type === 'image') {
    if (!b.src) return null;
    /* size and placement are the admin's: half fills half the column (the picture keeps its
       own ratio either way), and the alignment decides which edge the spare room goes to */
    const size = b.size === 'half' ? 'half' : 'full';
    const align = ['left', 'right'].includes(b.align) ? b.align : 'center';
    const fig = el('figure', 'about__fig about__fade about__fig--' + size + ' about__fig--' + align);
    const img = el('img');
    img.src = window.LSEData.asset(b.src);
    img.alt = b.caption || '';
    img.loading = 'lazy';
    img.addEventListener('load', () => img.classList.add('ok'));
    fig.appendChild(img);
    if ((b.caption || '').trim()) fig.appendChild(el('figcaption', null, b.caption));
    return fig;
  }

  /* a CV block, the shape a painter's profile actually has: a group (초대 개인전, 수상, 現…)
     naming a column of entries, each entry a line of its own — the work, then the year and
     the place set quietly beside it. */
  if (b.type === 'list') {
    const items = (b.items || []).map(cvItem).filter((it) => it.text || it.date || it.place);
    const label = (b.label || '').trim();
    if (!items.length && !label) return null;

    const al = ['left', 'center', 'right'].includes(b.align) ? b.align : 'left';
    const group = el('div', 'about__cv about__fade about__al--' + al);
    /* each field carries its own size, set as a multiple so the page's scale still holds. The
       block's old single `size` becomes the entry's — that is what it used to move. */
    const F = { sm: 0.72, md: 1, lg: 1.4 };
    const pick = (v, fallback) => F[v] || F[fallback] || 1;
    group.style.setProperty('--sz-label', pick(b.sizeLabel, 'md'));
    group.style.setProperty('--sz-t', pick(b.sizeText, b.size || 'md'));
    group.style.setProperty('--sz-n', pick(b.sizeNote, 'md'));

    /* Korean and English stand together, the English quietly under its Korean — a profile is
       read by both, and a group with no English simply has none. */
    const labelEn = (b.labelEn || '').trim();
    const head = el('div', 'about__cv-label label');
    if (label) head.appendChild(el('div', 'about__cv-label-ko', label));
    if (labelEn) head.appendChild(el('div', 'about__cv-label-en', labelEn));
    group.appendChild(head);

    const list = el('div', 'about__cv-items');
    items.forEach((it) => {
      const row = el('div', 'about__cv-row');
      const main = el('div', 'about__cv-main');
      if (it.text) main.appendChild(el('span', 'about__cv-t', it.text));
      if (it.textEn) main.appendChild(el('span', 'about__cv-en', it.textEn));
      row.appendChild(main);
      /* the year and the place travel together: on a phone they drop to a line of their own
         rather than each wrapping where it happens to run out of room */
      if (it.date || it.place) {
        const meta = el('div', 'about__cv-meta');
        if (it.date) meta.appendChild(el('span', 'about__cv-d', it.date));
        if (it.place) meta.appendChild(el('span', 'about__cv-n', it.place));
        row.appendChild(meta);
      }
      list.appendChild(row);
    });
    group.appendChild(list);
    return group;
  }

  if (!text) return null;   // an empty block leaves no gap behind

  /* copy blocks can be set left, centre or right. Left unset they keep the page as it was
     drawn: the title centred over the page, the body and the sign-off ranged left. */
  const ALIGN_DEFAULT = { title: 'center', text: 'left', thanks: 'left' };
  const al = ['left', 'center', 'right'].includes(b.align) ? b.align : ALIGN_DEFAULT[b.type];
  /* Size and leading are multiples of what the block is already set at, so the page's own
     scale — which is what makes it responsive — still holds underneath them. Size used to be
     three steps (작게 / 보통 / 크게); a headline that wanted to be a shade smaller had to jump
     28% to get there. It is a number now, and the leading, which could not be set at all, is
     one too: a title set large with a phrase on each line needs its lines closer than a title
     of one line does, and nothing in the admin could say so. */
  const SZ_WORD = { sm: 0.72, md: 1, lg: 1.4 };   // the three steps it had, kept readable
  const scale = (v) => {
    if (SZ_WORD[v] != null) return SZ_WORD[v];
    const n = parseFloat(v);
    if (!isFinite(n) || n <= 0) return null;
    return n > 5 ? n / 100 : n;                   // 110 means 110%
  };
  const aligned = (node) => {
    node.classList.add('about__al--' + al);
    const s = scale(b.size);
    if (s != null) node.style.setProperty('--sz', String(s));
    const lh = parseFloat(b.lh);
    if (isFinite(lh) && lh > 0) node.style.setProperty('--lh', String(lh));
    return node;
  };

  if (b.type === 'title') {
    const h1 = el('h1', 'about__title');
    text.split(/\n/).forEach((line) => {
      const m = el('div', 'about__line');
      m.appendChild(el('div', 'about__line-in', line));
      h1.appendChild(m);
    });
    return aligned(h1);
  }

  if (b.type === 'thanks') {
    const t = el('div', 'about__thanks');
    text.split(/\n/).forEach((line) => {
      if (line.trim()) t.appendChild(el('div', null, line));
    });
    return aligned(t);
  }

  /* What was typed is what is shown. Splitting on /\n+/ made one newline and three mean the
     same thing — every break became a new paragraph, and paragraphs are set 6rem apart, so a
     line simply carried onto the next line opened a gap the width of an empty line. A blank
     line between paragraphs is a paragraph break; a single newline is a break within one. */
  const p = aligned(el('div', 'about__intro about__fade'));   // 'text'
  text.split(/\n\s*\n+/).forEach((para) => {
    const node = el('p');
    para.split('\n').forEach((line, i) => {
      if (i) node.appendChild(document.createElement('br'));
      node.appendChild(document.createTextNode(line));
    });
    p.appendChild(node);
  });
  return p;
}

function mountAbout(view, content) {
  const wm = (content && content.wordmark) || {};
  /* the page lives in content.json, composed in the admin — it is the only source */
  const blocks = (content && content.blocks && content.blocks['/about']) || [];

  const page = el('div', 'about');
  const maskOuter = el('div', 'about__mask');
  const maskInner = el('div', 'about__mask-in');
  const scroller = el('div', 'about__scroll');

  const head = el('div', 'about__head');
  const l1 = el('div', 'label dt-reveal');
  l1.appendChild(el('div', null, '(' + (wm.l2 || 'LSE') + ')'));
  const l2 = el('div', 'label dt-reveal');
  l2.appendChild(el('div', null, '(25-26)'));
  head.appendChild(l1);
  head.appendChild(l2);
  scroller.appendChild(head);

  blocks.forEach((b) => {
    const node = b && aboutBlock(b);
    if (!node) return;
    /* the space under a block belongs to every kind of block, not just the copy — set it here
       rather than in each branch, so a picture and a CV group answer to the same control */
    const gap = ['none', 'sm', 'md', 'lg', 'xl'].includes(b.gap) ? b.gap : 'md';
    node.classList.add('about__gap--' + gap);
    scroller.appendChild(node);
  });

  /* Noun Project attribution (CC BY 3.0 — the plan's only allowed credit) */
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

  /* The wordmark is fixed and About scrolls its own type under it, so the two ran through each
     other. Hiding it outright left the top of the page bare — it belongs there while the page
     is at rest. It steps aside only once the copy starts climbing towards it. */
  const onScroll = () => {
    document.body.classList.toggle('about-scrolled', maskInner.scrollTop > 24);
  };
  maskInner.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const destroy = sc.destroy;
  sc.destroy = () => {
    maskInner.removeEventListener('scroll', onScroll);
    document.body.classList.remove('about-scrolled');
    destroy();
  };

  requestAnimationFrame(() => requestAnimationFrame(() => {
    view.classList.add('is-in');
    setTimeout(() => sc.measure(), 600);
  }));
  return sc;
}

window.LSEViews = { mountFlow, mountIndex, mountAbout };
})();
