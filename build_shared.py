"""Shared build helpers — the two pieces build_static.py needs to render the public site.

Extracted so the static build has no dependency on the local admin server: the deploy
ships this file (and build_static.py) and nothing of the admin. Single source — the admin
server imports these same functions from here.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
IMAGES_DIR = os.path.join(ROOT, "images")
ALLOWED_IMG = (".jpg", ".jpeg", ".png", ".webp", ".gif")
LEGACY_ROUTES = {"/surf": "/flow"}                    # renamed — keep old links alive

_HEAD_MARK = re.compile(r'<link rel="icon"[^>]*>')


def esc_attr(v):
    return (str(v or "")
            .replace("&", "&amp;").replace('"', "&quot;")
            .replace("<", "&lt;").replace(">", "&gt;"))


def inject_head(html, meta, base_url="", thumb_ext=""):
    """Favicon + link-preview tags, from content.json's meta.

    KakaoTalk, Slack and the rest fetch the HTML with a bot that runs no JavaScript, so a
    tag the app adds at runtime is never seen: the preview has to be in the served markup.
    og:image must also be an absolute URL — a relative one silently yields no thumbnail.
    """
    title = meta.get("title") or "LSE GALLERY"
    desc = meta.get("description") or ""
    icon = meta.get("favicon") or ""
    og = meta.get("ogImage") or ""
    base = (base_url or meta.get("siteUrl") or "").rstrip("/")

    def absolute(path):
        if not path or path.startswith(("http://", "https://")):
            return path
        return base + path if base else ""

    def small(path):
        """A tab icon has no business being a multi-MB painting: serve the thumbnail."""
        if path.startswith("/images/"):
            return "/thumbs/300/" + path.split("/images/", 1)[1] + thumb_ext
        return path

    icon_href = small(icon) if icon else "data:,"
    tags = ['<link rel="icon" href="%s">' % esc_attr(icon_href)]
    if icon:
        tags.append('<link rel="apple-touch-icon" href="%s">' % esc_attr(icon_href))
    tags += [
        '<meta property="og:type" content="website">',
        '<meta property="og:title" content="%s">' % esc_attr(title),
        '<meta property="og:site_name" content="%s">' % esc_attr(title),
    ]
    if desc:
        tags.append('<meta property="og:description" content="%s">' % esc_attr(desc))
    if base:
        tags.append('<meta property="og:url" content="%s/">' % esc_attr(base))
    og_abs = absolute(og)
    if og_abs:
        tags += [
            '<meta property="og:image" content="%s">' % esc_attr(og_abs),
            '<meta name="twitter:card" content="summary_large_image">',
            '<meta name="twitter:image" content="%s">' % esc_attr(og_abs),
        ]
    else:
        tags.append('<meta name="twitter:card" content="summary">')

    return _HEAD_MARK.sub("\n".join(tags), html, count=1)



COLORS_CACHE = os.path.join(ROOT, ".colors.json")
_COLORS = None


def image_colors():
    """{filename: "#rrggbb"} — one colour standing for each painting.

    Read at a glance, the archive is a run of colours before it is a run of dates: the spring
    the yellows came, the winter of grey water.

    Averaging a painting is useless — the colours on opposite sides of the wheel cancel and
    every canvas comes back the same mud. Shrinking it first is nearly as bad: each cell is
    already an average, so the strongest cell of an 8x8 is a washed-out version of the colour
    that was actually there, and the strip came out in pastels a painter would not recognise.

    The picture is sampled at 32x32 instead — small enough to read 45 images quickly, fine
    enough that a cell still holds one colour rather than a blend. The top tenth by saturation
    is taken and averaged among themselves: one loud pixel cannot speak for the painting, but
    the hundred loudest together are what the painting is of.

    It costs a read of every image, so it is cached on disk; only images new since last time
    are looked at."""
    global _COLORS
    if _COLORS is not None:
        return _COLORS
    cache = {}
    try:
        with open(COLORS_CACHE) as fh:
            cache = json.load(fh)
    except Exception:
        cache = {}

    out, fresh = {}, False
    try:
        from PIL import Image
        for f in sorted(os.listdir(IMAGES_DIR)):
            if not f.lower().endswith(ALLOWED_IMG):
                continue
            if f in cache:
                out[f] = cache[f]
                continue
            try:
                im = Image.open(os.path.join(IMAGES_DIR, f)).convert("RGB").resize((32, 32))
                px = list(im.getdata())
                def sat(p):
                    mx, mn = max(p), min(p)
                    return (mx - mn) / mx if mx else 0
                px.sort(key=sat, reverse=True)
                top = px[: max(1, len(px) // 10)]          # the loudest tenth of the canvas
                r = sum(p[0] for p in top) // len(top)
                g = sum(p[1] for p in top) // len(top)
                b = sum(p[2] for p in top) // len(top)
                out[f] = "#%02x%02x%02x" % (r, g, b)
                fresh = True
            except Exception:
                pass
    except Exception:
        pass

    if fresh or len(out) != len(cache):
        try:
            with open(COLORS_CACHE, "w") as fh:
                json.dump(out, fh)
        except Exception:
            pass
    _COLORS = out
    return _COLORS

