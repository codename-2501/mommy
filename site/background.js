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
let token = 0;             // the route this background belongs to; a later one wins
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

/* apply(background, opts) — called on every route change with that view's own setting.
   opts.transition mirrors the admin's 화면 전환 (content.meta.transition): in 'fade' the page's
   background does not hard-swap when it changes from one picture to another — the old one fades out
   and the new one fades up in its place, the same fade the views take. In the default ('flip') the
   background swaps under the flight as it always did. */
function apply(bg, opts) {
  const prevSrc = cfg.src;                      // the picture we are leaving, read before cfg is overwritten
  cfg = {
    src: (bg && bg.src) || '',
    motion: MOTIONS.includes(bg && bg.motion) ? bg.motion : 'none',
    opacity: bg && bg.opacity != null ? Number(bg.opacity) : 1,
  };
  stop();

  const el = ensureLayer();
  token += 1;                                  // a route change mid-load must not be overtaken
  const mine = token;

  /* the reveal proper — pulled out so a fade-mode picture change can run it after the old one has
     faded out. Drops the layer when there is nothing to show, else decodes the new picture and fades
     it up on the frame after. */
  const reveal = () => {
    if (token !== mine) return;
    if (!cfg.src || cfg.motion === 'none') {
      el.style.opacity = '0';
      document.body.classList.remove('has-bg');
      /* let the fade finish before the picture is dropped, or it vanishes instead of fading */
      setTimeout(() => { if (token === mine) el.style.backgroundImage = ''; }, 600);
      return;
    }
    /* a page that paints its own ground (About is black) has to know a picture is behind it,
       or it simply covers the picture up */
    document.body.classList.add('has-bg');

    /* The background used to appear in the same frame it was asked for: the layer was created,
       given its picture and its final opacity at once, so the browser had no earlier value to
       ease from and the picture arrived undecoded — it snapped in, whole, over a page that was
       still sliding into place. Decode first, and only then fade, on the frame after. */
    const pre = new Image();
    pre.src = window.LSEData.asset(cfg.src);
    const show = () => {
      if (token !== mine) return;              // a later route already took over
      el.style.backgroundImage = 'url("' + window.LSEData.asset(cfg.src) + '")';
      el.style.transform = 'translate3d(0,0,0)';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (token !== mine) return;
        el.style.opacity = String(Math.max(0, Math.min(1, cfg.opacity)));
      }));

      if (cfg.motion === 'fixed') return;      // nothing to drive: it simply sits there
      mx = my = cx = cy = 0;
      scrollY = currentScroll();
      addEventListener('pointermove', onPointer, { passive: true });
      raf = requestAnimationFrame(frame);
    };
    (pre.decode ? pre.decode().catch(() => {}) : Promise.resolve()).then(show);
  };

  /* fade mode, and the picture is genuinely changing from one to another (not merely appearing on a
     bare page — the reveal already fades that in): fade the old one out first, then reveal the new one
     in its place. The 600ms matches the .6s opacity transition on .site-bg. */
  const fadingBetween = opts && opts.transition === 'fade' &&
    prevSrc && cfg.src && prevSrc !== cfg.src && el.style.backgroundImage;
  if (fadingBetween) {
    el.style.opacity = '0';
    setTimeout(reveal, 600);
  } else {
    reveal();
  }
}

/* the layer exists from the start, transparent: a transition needs something to ease from */
if (document.body) ensureLayer();
else addEventListener('DOMContentLoaded', ensureLayer, { once: true });

window.LSEBackground = { apply, MOTIONS };
})();
