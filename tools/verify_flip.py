#!/usr/bin/env python3
"""Phase 5 (1) verification — does the same painting really fly between views?

Drives the rebuilt site in an isolated headless profile, walks home -> surf ->
articles -> home, and for each hop:
  - records which work id the leaving view was showing (body.dataset.index handoff)
  - asserts the LIVE .lse-frame frame was reparented into the new view's slot with
    the same data-id (original J(): appendChild, never a clone)
  - samples the flying frame's transform across the flight
  - saves frames so the motion can be eyeballed against the legacy clone
"""
import sys, time, pathlib
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tlb_frames")
OUT.mkdir(parents=True, exist_ok=True)
PROFILE = OUT / "profile"

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=1440,900")
opts.add_argument("--force-device-scale-factor=1")
opts.add_argument(f"--user-data-dir={PROFILE}")     # isolated profile (hard rule 1)
opts.add_argument("--no-first-run")
opts.add_argument("--disable-extensions")
d = webdriver.Chrome(options=opts)
d.set_window_size(1440, 900)

# the leaving view is tagged before the click, so "reparented" means: this live frame
# now hangs under a view that did NOT exist when the hop started.
FLIP_PROBE = """
const out = [];
for (const f of document.querySelectorAll('.lse-frame')) {
  const t = getComputedStyle(f).transform;
  if (t === 'none') continue;
  const view = f.closest('.view');
  const slot = f.parentElement;
  const img = f.querySelector('img');
  out.push({
    id: f.dataset.id,
    transform: t,
    slotId: slot && slot.dataset ? slot.dataset.id : null,
    reparented: !!(view && !view.dataset.oldview),
    opacity: img ? getComputedStyle(img).opacity : null,   // a flying painting must be SEEN
  });
}
return out;
"""

def probe(label):
    return d.execute_script(FLIP_PROBE)

def shot(name):
    d.save_screenshot(str(OUT / name))

def snapshot_ids(sel):
    return d.execute_script(
        "return [...document.querySelectorAll(arguments[0])].map(e => e.dataset.id);", sel)

fail = []

def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        fail.append(msg)

try:
    d.get("http://localhost:8082/")
    time.sleep(2.5)
    # intro gate — the single Enter button
    d.find_element(By.CSS_SELECTOR, ".intro-gate .btn").click()
    time.sleep(3.0)
    shot("00_home.png")

    # walk the carousel off slide 0 so the index handoff is actually load-bearing
    body = d.find_element(By.TAG_NAME, "body")
    for _ in range(7):
        body.send_keys(Keys.ARROW_RIGHT)     # one slide each (original arrow-key snap)
        time.sleep(0.25)
    time.sleep(1.5)
    shot("00b_home_moved.png")
    home_active = d.execute_script(
        "const a=document.querySelector('.lse-centred .lse-frame'); return a?a.dataset.id:null;")
    # the works are ordered by their admin date, so a work's id number is NOT its position
    home_active_pos = d.execute_script("""
      const items = [...document.querySelectorAll('.car-item')];
      const act = document.querySelector('.car-item.lse-centred');
      return String(items.indexOf(act));
    """)
    print(f"\nhome parked on work {home_active} (slide #{home_active_pos})")

    def hop(name, href, from_view):
        print(f"\n[{name}]")
        # tag the leaving view, and note what it is showing
        before = d.execute_script("""
          const old = document.querySelector('.view');
          old.dataset.oldview = '1';
          const act = document.querySelector('.lse-centred .lse-frame');
          return {
            visible: [...old.querySelectorAll('.lse-frame')]
              .filter(f => { const r = f.getBoundingClientRect();
                             return r.right >= 0 && r.left <= innerWidth &&
                                    r.bottom >= 0 && r.top <= innerHeight; })
              .map(f => f.dataset.id),
            active: act ? act.dataset.id : null,
          };
        """)
        print(f"  leaving view shows {len(before['visible'])} paintings, active={before['active']}")

        d.find_element(By.CSS_SELECTOR, f'a[href="{href}"]').click()

        # sample the flight
        samples, moved = [], []
        t0 = time.time()
        while time.time() - t0 < 1.4:
            p = probe(name)
            if p:
                samples.append(p)
                for f in p:
                    if f["id"] not in [m["id"] for m in moved]:
                        moved.append(f)
            ms = int((time.time() - t0) * 1000)
            if ms < 1200:
                shot(f"{name}_{ms:04d}.png")
            time.sleep(0.09)
        time.sleep(1.0)
        shot(f"{name}_settled.png")

        handed = d.execute_script("return document.body.dataset.index;")
        print(f"  body.dataset.index handed over = {handed}")

        # shared = the live frame now hangs in the NEW view, in the slot of the same work
        pairs = [m for m in moved if m["reparented"] and m["slotId"] == m["id"]]
        shared = sorted({m["id"] for m in pairs})
        print(f"  frames that animated: {len(moved)}   reparented into the new view: {len(shared)}")
        if shared:
            print(f"  shared work ids: {shared[:6]}{'...' if len(shared) > 6 else ''}")

        # no clones: each work id must have exactly one .lse-frame in the document
        dupes = d.execute_script("""
          const seen = {}, dup = [];
          for (const f of document.querySelectorAll('.lse-frame')) {
            seen[f.dataset.id] = (seen[f.dataset.id] || 0) + 1;
            if (seen[f.dataset.id] > 1) dup.push(f.dataset.id);
          }
          return dup;
        """)
        # everything must come to rest (no stuck transform / no orphan inline styles)
        stuck = d.execute_script("""
          return [...document.querySelectorAll('.lse-frame,.lse-slot')]
            .filter(e => e.style.transform && e.style.transform !== '').length;
        """)
        left = d.execute_script("return document.querySelectorAll('.view').length;")
        # a painting that flies must be visible the whole way, and visible where it lands
        ghosts = sorted({m["id"] for m in moved if m["reparented"] and m["opacity"] == "0"})
        blank = d.execute_script("""
          return [...document.querySelectorAll('.view .lse-frame')].filter(f => {
            const r = f.getBoundingClientRect();
            if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight) return false;
            const img = f.querySelector('img');
            return !img || getComputedStyle(img).opacity === '0';
          }).map(f => f.dataset.id);
        """)
        return before, shared, dupes, stuck, left, len(moved), ghosts, blank

    # home -> surf : shared flip, no stagger (original toSurf), index handed over
    before, shared, dupes, stuck, views, flew, ghosts, blank = hop("01_home_to_surf", "/surf", "home")
    handed = d.execute_script("return document.body.dataset.index;")
    check(handed == home_active_pos,
          f"home->surf: the carousel's work ({home_active}, slide #{home_active_pos}) "
          f"was handed to surf (index={handed})")
    check(home_active in shared,
          f"home->surf: the work the viewer was on ({home_active}) is the one that flew")
    check(len(shared) > 0, "home->surf: a painting was reparented into the surf slot of the same id")
    check(not dupes, f"home->surf: no cloned frames (dupes={dupes})")
    check(stuck == 0, f"home->surf: no frame left with an inline transform (stuck={stuck})")
    check(views == 1, f"home->surf: the old view was removed (views={views})")
    check(not ghosts, f"home->surf: no painting flew invisibly (ghosts={ghosts})")
    check(not blank, f"home->surf: no empty frame on screen (blank={blank})")

    # surf -> articles : original V() — paintings fly OUT, nothing flips
    before, shared, dupes, stuck, views, flew, ghosts, blank = hop("02_surf_to_articles", "/articles", "surf")
    check(flew > 0, "surf->articles: the surf paintings animate out (original V())")
    check(len(shared) == 0, "surf->articles: nothing is reparented (surf leaves by flying out)")
    check(views == 1, f"surf->articles: the old view was removed (views={views})")
    check(not blank, f"surf->articles: no empty frame on screen (blank={blank})")

    # articles -> home : shared flip back into the carousel, index handed over
    before, shared, dupes, stuck, views, flew, ghosts, blank = hop("03_articles_to_home", "/", "articles")
    check(len(shared) > 0, "articles->home: a painting was reparented into the carousel slot of the same id")
    check(not dupes, f"articles->home: no cloned frames (dupes={dupes})")
    check(stuck == 0, f"articles->home: no frame left with an inline transform (stuck={stuck})")
    check(not ghosts, f"articles->home: no painting flew invisibly (ghosts={ghosts})")
    check(not blank, f"articles->home: no empty frame on screen (blank={blank})")

    # the carousel still works after receiving a flown-in frame
    imgs = d.execute_script("""
      return [...document.querySelectorAll('.car-frame')]
        .filter(f => !f.querySelector('img')).length;
    """)
    check(imgs == 0, f"home: every carousel frame still holds its <img> (empty={imgs})")

finally:
    print("\nframes ->", OUT)
    d.quit()

print("\nRESULT:", "ALL PASS" if not fail else f"{len(fail)} FAILED")
for f in fail:
    print("  -", f)
sys.exit(1 if fail else 0)
