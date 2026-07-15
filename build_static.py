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
import sys

from PIL import Image

import admin_server   # the shell's head injection lives there; one source, one behaviour

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
    # page image blocks (About): rendered at full width, never thumbnailed — miss these and
    # the built site ships an About page pointing at images that were never copied
    for blocks in (content.get("blocks") or {}).values():
        for b in blocks or []:
            if b.get("type") == "image":
                name = image_name(b.get("src") or "")
                if name:
                    full.add(name)

    # nor is the wordmark's picture logo
    logo = image_name(((content.get("wordmark") or {}).get("image")) or "")
    if logo:
        full.add(logo)

    # a page's background is not referenced by any slide either
    for bg in (content.get("backgrounds") or {}).values():
        name = image_name((bg or {}).get("src") or "")
        if name:
            full.add(name)

    # the favicon is served from /thumbs, the share thumbnail at full size. Neither is
    # referenced by a slide, so without this the built site links to images it never copied.
    meta = content.get("meta") or {}
    fav = image_name(meta.get("favicon") or "")
    if fav:
        thumbed.add(fav)
    og = image_name(meta.get("ogImage") or "")
    if og:
        full.add(og)
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
    # where the site will be mounted: '' for a root domain, '/mommy' for a GitHub project page.
    base = ""
    for a in sys.argv[1:]:
        if a.startswith("--base="):
            base = "/" + a.split("=", 1)[1].strip("/")
    base = base.rstrip("/")

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
    shutil.copy(os.path.join(ROOT, "content.json"), os.path.join(DIST, "content.json"))

    # the shell carries the favicon and the link-preview tags. A static host has no request
    # to read the hostname from, so og:image can only be absolute if meta.siteUrl says where
    # the site will live — without it a shared link shows no thumbnail.
    meta = content.get("meta") or {}
    site_url = (meta.get("siteUrl") or "").rstrip("/")
    with open(os.path.join(ROOT, "site", "index.html"), encoding="utf-8") as fh:
        shell = admin_server.inject_head(fh.read(), meta, site_url, thumb_ext=".webp")
    # tell the frontend where it lives, before any of its scripts run, and move the scripts and
    # any other root-absolute href/src in the shell under the mount
    if base:
        shell = shell.replace("<head>",
                              '<head><script>window.__SITE_BASE__=%r;</script>' % base, 1)
        shell = re.sub(r'((?:src|href)=")(/(?!/))', r'\1' + base + r'\2', shell)
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(shell)
    # GitHub Pages has no rewrite rules: a deep link or refresh to /mommy/flow hits a file that
    # is not there. Its 404 page, though, is served for exactly those misses — so the shell IS
    # the 404 page, and the router takes it from there.
    with open(os.path.join(DIST, "404.html"), "w", encoding="utf-8") as fh:
        fh.write(shell)
    if not site_url:
        print("  경고: meta.siteUrl 이 비어 있어 og:image 절대 URL 을 만들 수 없습니다 "
              "— 링크 공유 시 썸네일이 뜨지 않습니다 (관리자 > 사이트에서 주소 입력)")

    # /api/aspects -> aspects.json (same envelope: app.js reads j.aspects)
    aspects = {}
    for name in sorted(used):
        w, h = Image.open(os.path.join(IMAGES, name)).size
        aspects[name] = round(w / h, 4) if h else 1
    with open(os.path.join(DIST, "aspects.json"), "w", encoding="utf-8") as fh:
        json.dump({"aspects": aspects}, fh, ensure_ascii=False)

    # /api/colors -> colors.json (the palette timeline; without it that mode falls back to grey)
    with open(os.path.join(DIST, "colors.json"), "w", encoding="utf-8") as fh:
        json.dump({"colors": admin_server.image_colors()}, fh, ensure_ascii=False)

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
        ("'/api/content'", "'/content.json'"),
        ("'/api/aspects'", "'/aspects.json'"),
        ("'/api/colors'", "'/colors.json'"),
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

    # CSS url() paths are root-absolute (fonts, the noise texture) and the frontend's asset()
    # cannot reach inside a stylesheet — so the mount is applied to them here, at build time.
    if base:
        css = os.path.join(DIST, "site", "app.css")
        with open(css, encoding="utf-8") as fh:
            text = fh.read()
        text = re.sub(r'url\((/(?!/))', r'url(' + base + r'\1', text)
        with open(css, "w", encoding="utf-8") as fh:
            fh.write(text)

    # SPA shell: admin_server served site/index.html for /, /flow, /articles,
    # /about and /p/<id>. Static hosts serve real files first, so a catch-all is
    # safe and keeps deep links and refreshes working.
    with open(os.path.join(DIST, "_redirects"), "w", encoding="utf-8") as fh:
        for old, new in admin_server.LEGACY_ROUTES.items():   # renamed routes, old links alive
            fh.write(f"{old}  {new}  301\n")
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
