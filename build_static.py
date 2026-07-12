#!/usr/bin/env python3
"""LSE GALLERY - static build for CDN hosting (Cloudflare Pages etc).

admin_server.py serves the site's data through three runtime endpoints:
  GET /api/content        -> content.json verbatim
  GET /api/aspects        -> {filename: width/height} computed with Pillow
  GET /thumbs/<w>/<name>  -> the original resized to <w> and re-encoded as WebP

A static host has no Python, so this script materialises all three as files and
rewrites the copies of the frontend in dist/ to point at them. site/ itself is
never modified.

Only the images content.json actually references are shipped. Slide images are
shipped as thumbnails only; the originals are needed just for the six images the
detail body renders at full quality (detail.js: "body images: full quality").

Usage:  python3 build_static.py
Output: dist/
"""
import json
import os
import re
import shutil

from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
IMAGES = os.path.join(ROOT, "images")

# must match admin_server.py's /thumbs handler
THUMB_WIDTHS = (300, 600)
WEBP_QUALITY = 82
WEBP_METHOD = 4


def image_name(path):
    """'/images/foo.png' -> 'foo.png'"""
    if not path or "/images/" not in path:
        return None
    return path.split("/images/")[-1].split("?")[0]


def referenced_images(content):
    """Split the images content.json uses by how the frontend renders them."""
    thumbed, full = set(), set()
    for slide in content.get("slides", []):
        name = image_name(slide.get("image") or "")
        if name:
            thumbed.add(name)
        for item in slide.get("media") or []:
            if item.get("type") == "image":
                name = image_name(item.get("src") or "")
                if name:
                    full.add(name)
    return thumbed | full, full


def make_thumb(name, width, dest):
    im = Image.open(os.path.join(IMAGES, name))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    if im.width > width:
        im = im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)
    im.save(dest, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)


def patch(path, replacements):
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    for old, new in replacements:
        if old not in src:
            raise SystemExit(f"patch target missing in {os.path.relpath(path, ROOT)}: {old}")
        src = src.replace(old, new)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(src)


def main():
    with open(os.path.join(ROOT, "content.json"), encoding="utf-8") as fh:
        content = json.load(fh)

    used, full_quality = referenced_images(content)
    missing = sorted(n for n in used if not os.path.isfile(os.path.join(IMAGES, n)))
    if missing:
        raise SystemExit(f"content.json references {len(missing)} missing images: {missing[:5]}")

    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    # frontend + assets
    shutil.copytree(os.path.join(ROOT, "site"), os.path.join(DIST, "site"))
    shutil.copytree(os.path.join(ROOT, "icons"), os.path.join(DIST, "icons"))
    shutil.copy(os.path.join(ROOT, "site", "index.html"), os.path.join(DIST, "index.html"))
    shutil.copy(os.path.join(ROOT, "content.json"), os.path.join(DIST, "content.json"))

    # /api/aspects -> aspects.json (same envelope: app.js reads j.aspects)
    aspects = {}
    for name in sorted(used):
        w, h = Image.open(os.path.join(IMAGES, name)).size
        aspects[name] = round(w / h, 4) if h else 1
    with open(os.path.join(DIST, "aspects.json"), "w", encoding="utf-8") as fh:
        json.dump({"aspects": aspects}, fh, ensure_ascii=False)

    # /thumbs/<w>/<name> -> dist/thumbs/<w>/<name>.webp
    for width in THUMB_WIDTHS:
        out = os.path.join(DIST, "thumbs", str(width))
        os.makedirs(out)
        for name in sorted(used):
            make_thumb(name, width, os.path.join(out, name + ".webp"))

    # originals, only for the detail body's full-quality images
    if full_quality:
        os.makedirs(os.path.join(DIST, "images"))
        for name in sorted(full_quality):
            shutil.copy(os.path.join(IMAGES, name), os.path.join(DIST, "images", name))

    # point the frontend at the materialised files
    patch(os.path.join(DIST, "site", "app.js"), [
        ("fetch('/api/content')", "fetch('/content.json')"),
        ("fetch('/api/aspects')", "fetch('/aspects.json')"),
    ])
    for js in ("views.js", "detail.js"):
        patch(os.path.join(DIST, "site", js), [
            ("'/thumbs/' + w + '/' + encodeURIComponent(f)",
             "'/thumbs/' + w + '/' + encodeURIComponent(f) + '.webp'"),
        ])
    patch(os.path.join(DIST, "site", "carousel.js"), [
        ("'/thumbs/600/' + encodeURIComponent(file)",
         "'/thumbs/600/' + encodeURIComponent(file) + '.webp'"),
    ])

    # SPA shell: admin_server served site/index.html for /, /surf, /articles,
    # /about and /p/<id>. Static hosts serve real files first, so a catch-all is
    # safe and keeps deep links and refreshes working.
    with open(os.path.join(DIST, "_redirects"), "w", encoding="utf-8") as fh:
        fh.write("/*  /index.html  200\n")

    total = sum(
        os.path.getsize(os.path.join(d, f))
        for d, _, files in os.walk(DIST) for f in files
    )
    count = sum(len(files) for _, _, files in os.walk(DIST))
    print(f"dist/  {count} files  {total / 1048576:.1f}MB")
    print(f"  images used {len(used)}  thumbed {len(used)}  full-quality {len(full_quality)}")


if __name__ == "__main__":
    main()
