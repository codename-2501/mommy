/* LSE GALLERY — one reading of a slide's month, category and year.

   These were parsed in four places (carousel, views, detail, app), each with its own rule,
   and they disagreed: the detail read the admin's `date` field, while the timeline and the
   intro dug the month out of the `bottom` caption — "Inspire (January)". A work dated
   2026-06 in the admin therefore hung under January on the timeline, and if anything
   followed the bracket ("(January)핰씨") the caption stopped parsing and the work lost its
   month entirely. The date the admin sets is the work's date; the caption is only a
   fallback for the slides that never got one. */
(() => {
'use strict';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/* "(January)" out of the caption — anywhere in it, not only at the end */
function monthFromCaption(s) {
  const m = /\(([^)]+)\)/.exec(String(s.bottom || ''));
  if (!m) return '';
  const name = m[1].trim();
  const i = MONTHS.findIndex((x) => x.toLowerCase() === name.toLowerCase());
  return i < 0 ? '' : MONTHS[i];
}

function monthIndex(s) {                       // 0-11, or -1
  const m = /^(\d{4})-(\d{2})/.exec(String(s.date || ''));
  if (m) {
    const i = parseInt(m[2], 10) - 1;
    if (i >= 0 && i < 12) return i;
  }
  return MONTHS.indexOf(monthFromCaption(s));
}

function month(s) {                            // "June", or ''
  const i = monthIndex(s);
  return i < 0 ? '' : MONTHS[i];
}

function year(s) {                             // "2026"
  return (/^(\d{4})/.exec(String(s.date || '')) || [])[1] || '';
}

/* the caption minus its bracketed month: "Inspire (January)" -> "Inspire" */
function category(s) {
  return String(s.category || '').trim() ||
    String(s.bottom || '').replace(/\s*\([^)]*\)\s*/, ' ').trim();
}

/* Where the site is mounted. A project on GitHub Pages lives under /<repo>/, not at the root,
   so every root-absolute path the app was written with (/site, /images, /thumbs, /flow) has to
   be read and written through this prefix. It is injected into the page at build time; empty
   when the site is served from the root, which is what the local admin server does — so nothing
   below changes anything at all in development. */
const SITE_BASE = (window.__SITE_BASE__ || '').replace(/\/+$/, '');
/* a root-absolute asset path, moved under the mount */
function asset(p) {
  return SITE_BASE && typeof p === 'string' && p.charAt(0) === '/' ? SITE_BASE + p : p;
}
/* the current route with the mount taken off the front — what the router matches against */
function route() {
  let p = location.pathname;
  if (SITE_BASE && p.indexOf(SITE_BASE) === 0) p = p.slice(SITE_BASE.length);
  return p.replace(/\/+$/, '') || '/';
}
/* a route turned back into a real URL under the mount, for links and pushState */
function toHref(path) {
  const p = String(path);
  return SITE_BASE + (p.charAt(0) === '/' ? p : '/' + p);
}

window.LSEData = { MONTHS, month, monthIndex, year, category, base: SITE_BASE, asset, route, toHref };
})();
