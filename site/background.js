/* LSE GALLERY — the page's background, set per view in the admin (content.json → backgrounds).

   A background is a picture behind everything, and how it moves is part of what it says:
     none      no background at all — the page keeps the plain ground it was designed on
     fixed     it sits still while the page moves over it
     follow    it drifts a little with the cursor, in the same direction — depth, gently
     invert    it drifts against the cursor — the same depth, read the other way round
     parallax  it trails the scroll, slower than the content in front of it

   The moving kinds are driven from one rAF loop and written as a transform, so they never
   force a layout: a background that reflows on every mouse move would drag the whole page
   down with it. On a phone there is no cursor, so 'follow' and 'invert' take their lead from
   the scroll instead — the same idea, from the only input a finger gives. */
(() => {
'use strict';

const MOTIONS = ['none', 'fixed', 'follow', 'invert', 'parallax'];
const DRIFT = 28;          // px the picture may travel from centre for a cursor at the edge
const PARALLAX = 0.25;     // how much of the scroll the background takes

let layer = null;
let cfg = { src: '', motion: 'none', opacity: 1 };
let mx = 0, my = 0;        // where the pointer wants it (-1..1)
let cx = 0, cy = 0;        // where it actually is — eased, so a jerk of the mouse is not one
let scrollY = 0;
let raf = 0;

function ensureLayer() {
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'site-bg';
  document.body.insertBefore(layer, document.body.firstChild);
  return layer;
}

function onPointer(e) {
  if (e.pointerType === 'touch') return;      // a finger scrolls; it does not hover
  mx = (e.clientX / innerWidth) * 2 - 1;
  my = (e.clientY / innerHeight) * 2 - 1;
}

function currentScroll() {
  const sc = document.querySelector('.agrid, .about__mask-in');
  return sc ? sc.scrollTop : 0;
}

function frame() {
  const m = cfg.motion;
  if (m === 'follow' || m === 'invert') {
    const sign = m === 'invert' ? -1 : 1;
    /* no cursor on a phone — let the scroll stand in for it, so the motion still exists */
    const tx = mx, ty = my || (currentScroll() % innerHeight) / innerHeight - 0.5;
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    layer.style.transform =
      'translate3d(' + (sign * cx * DRIFT) + 'px,' + (sign * cy * DRIFT) + 'px,0) scale(1.06)';
  } else if (m === 'parallax') {
    scrollY += (currentScroll() - scrollY) * 0.12;
    layer.style.transform = 'translate3d(0,' + (-scrollY * PARALLAX) + 'px,0) scale(1.12)';
  }
  raf = requestAnimationFrame(frame);
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  removeEventListener('pointermove', onPointer);
}

/* apply(background) — called on every route change with that view's own setting */
function apply(bg) {
  cfg = {
    src: (bg && bg.src) || '',
    motion: MOTIONS.includes(bg && bg.motion) ? bg.motion : 'none',
    opacity: bg && bg.opacity != null ? Number(bg.opacity) : 1,
  };
  stop();

  if (!cfg.src || cfg.motion === 'none') {
    if (layer) { layer.style.opacity = '0'; layer.style.backgroundImage = ''; }
    return;
  }

  const el = ensureLayer();
  el.style.backgroundImage = 'url("' + cfg.src + '")';
  el.style.opacity = String(Math.max(0, Math.min(1, cfg.opacity)));
  el.style.transform = 'translate3d(0,0,0)';

  if (cfg.motion === 'fixed') return;         // nothing to drive: it simply sits there

  mx = my = cx = cy = 0;
  scrollY = currentScroll();
  addEventListener('pointermove', onPointer, { passive: true });
  raf = requestAnimationFrame(frame);
}

window.LSEBackground = { apply, MOTIONS };
})();
