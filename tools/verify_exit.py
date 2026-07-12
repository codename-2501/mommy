#!/usr/bin/env python3
"""Exit / view-lifecycle checks (selenium, isolated profile).

Two faults this guards against:
  A) clicking the menu again while a transition is still running left the previous view
     in the DOM for good — its rAF loop kept running and its paintings stayed on screen,
     so views (and their images) piled up with every click.
  B) closing the timeline detail drew the same painting twice — once in the detail on its
     way out, once in the home underneath.

Usage:  python3 tools/verify_exit.py [out_dir]
"""
import sys, time, pathlib
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/tlb_exit")
OUT.mkdir(parents=True, exist_ok=True)

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--window-size=1440,900")
opts.add_argument("--force-device-scale-factor=1")
opts.add_argument(f"--user-data-dir={OUT / 'profile'}")
opts.add_argument("--no-first-run")
d = webdriver.Chrome(options=opts)
d.set_window_size(1440, 900)

COUNTS = """
return {
  views: document.querySelectorAll('.view').length,
  details: document.querySelectorAll('.detail').length,
  mounted: document.querySelectorAll('.carousel').length
         + document.querySelectorAll('.surf').length
         + document.querySelectorAll('.agrid').length,
};
"""

# a painting counts as on screen only if EVERY ancestor lets it through
DUP = """
const eff = (el) => {
  let o = 1;
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (s.visibility === 'hidden' || s.display === 'none') return 0;
    o *= parseFloat(s.opacity);
  }
  return o;
};
const seen = {};
for (const img of document.querySelectorAll('img')) {
  const r = img.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) continue;
  if (r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight) continue;
  if (eff(img) < 0.08) continue;
  const src = img.src.split('/').pop().split('?')[0];
  (seen[src] = seen[src] || []).push(img.closest('.detail') ? 'detail' : 'home');
}
return Object.entries(seen).filter(([, v]) => v.length > 1).map(([src, v]) => ({ src, at: v }));
"""

fail = []

def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        fail.append(msg)

try:
    d.get("http://localhost:8082/")
    time.sleep(2.5)
    d.find_element(By.CSS_SELECTOR, ".intro-gate .btn").click()
    time.sleep(3.5)

    print("\n[A] six menu clicks, each landing mid-transition")
    for href in ["/surf", "/articles", "/", "/surf", "/articles", "/"]:
        d.find_element(By.CSS_SELECTOR, f'a[href="{href}"]').click()
        time.sleep(0.35)                       # deliberately interrupt the transition
        c = d.execute_script(COUNTS)
        check(c["views"] <= 2, f"at most the leaving + arriving view exist (views={c['views']})")
    time.sleep(2.5)
    c = d.execute_script(COUNTS)
    check(c["views"] == 1, f"one view alive once things settle (views={c['views']})")
    check(c["mounted"] == 1, f"one mounted view instance — nothing piled up (mounted={c['mounted']})")

    print("\n[B] timeline detail: open, then close")
    d.find_element(By.CSS_SELECTOR, 'a[href="/"]').click()
    time.sleep(3.0)
    d.execute_script("document.querySelectorAll('.car-item')[2].click();")
    time.sleep(2.5)
    d.find_element(By.CSS_SELECTOR, ".dt-close, .detail button").click()

    doubles = []
    t0 = time.time()
    while time.time() - t0 < 2.0:
        dup = d.execute_script(DUP)
        if dup:
            doubles.append((int((time.time() - t0) * 1000), dup))
        d.save_screenshot(str(OUT / f"close_{int((time.time() - t0) * 1000):04d}.png"))
        time.sleep(0.08)
    time.sleep(1.5)
    c = d.execute_script(COUNTS)
    check(not doubles, f"no painting is ever drawn twice during the exit ({len(doubles)} moments)")
    for ms, dup in doubles[:5]:
        print(f"    t={ms}ms {[(x['src'][:18], x['at']) for x in dup]}")
    check(c["details"] == 0, "the detail node is gone")
    check(c["views"] == 1, f"one view alive after the close (views={c['views']})")
    check(not d.execute_script(DUP), "nothing overlaps once the exit has finished")

    print("\n[C] scrolled index -> timeline (the carousel starts away from slide 0)")
    d.find_element(By.CSS_SELECTOR, 'a[href="/articles"]').click()
    time.sleep(3.0)
    for _ in range(10):
        ActionChains(d).scroll_by_amount(0, 400).perform()   # a real wheel: synthetic ones carry no wheelDeltaY
        time.sleep(0.12)
    time.sleep(2.0)
    handed = d.execute_script("""
      const rows = [...document.querySelectorAll('.js-tilt')];
      const mid = innerHeight / 2;
      let best = null, bd = Infinity;
      for (const r of rows) { const dd = Math.abs(r.getBoundingClientRect().top - mid);
        if (dd < bd) { bd = dd; best = r; } }
      const c = best && best.querySelector('[data-index]');
      return c ? parseInt(c.dataset.index, 10) : 0;
    """)
    check(handed > 0, f"the index was scrolled off the first row (nearest row index={handed})")
    d.find_element(By.CSS_SELECTOR, 'a[href="/"]').click()

    # every slide must be positioned: an unplaced one sits at its natural flex spot — on screen
    OVERLAP = """
    const boxes = [];
    for (const f of document.querySelectorAll('.view--home .js-flip')) {
      const r = f.getBoundingClientRect();
      if (r.width < 30 || r.right < 0 || r.left > innerWidth) continue;
      boxes.push({ id: f.dataset.id, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const hits = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 30 && oy > 30) hits.push([a.id, b.id]);
    }
    return { onscreen: boxes.length, overlaps: hits };
    """
    stuck = []
    t0 = time.time()
    while time.time() - t0 < 3.0:
        st = d.execute_script(OVERLAP)
        if st["overlaps"]:
            stuck.append((int((time.time() - t0) * 1000), st["overlaps"][:3]))
        time.sleep(0.15)
    st = d.execute_script(OVERLAP)
    check(not st["overlaps"], f"no two slides share a spot once landed ({st['overlaps'][:3]})")
    check(len(stuck) <= 2, f"slides do not sit on top of each other during the flight ({len(stuck)} moments)")
    check(st["onscreen"] <= 7, f"only one row of slides is on screen (onscreen={st['onscreen']})")
finally:
    print("\nframes ->", OUT)
    d.quit()

print("\nRESULT:", "ALL PASS" if not fail else f"{len(fail)} FAILED")
for f in fail:
    print("  -", f)
sys.exit(1 if fail else 0)
