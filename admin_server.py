#!/usr/bin/env python3
"""THE LOOKBACK clone + admin server.

Serves the cloned site (with a runtime override script injected), the admin
panel at /admin/, and a small JSON API to edit content.json and upload images.

Usage:  python admin_server.py [port]     (default 8082)
Site:   http://localhost:8082/
Admin:  http://localhost:8082/admin/
"""
import sys, os, json, re, copy, urllib.parse, http.server, socketserver
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(ROOT, "content.json")
IMAGES_DIR = os.path.join(ROOT, "images")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8082

INJECT = '<script src="/tlb-admin.js"></script>'
ALLOWED_IMG = (".jpg", ".jpeg", ".png", ".webp", ".gif")


def read_content():
    with open(CONTENT, encoding="utf-8") as fh:
        return json.load(fh)


def safe_name(name):
    name = os.path.basename(name).replace("\\", "_")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name or "upload.bin"


ROUTES = [
    "/", "/about", "/surf", "/articles",
    "/articles/kendrick-lamar-taps-willy-chavarria-for-super-bowl-halftime-collection",
    "/articles/zipper-surf-film", "/articles/post-malone-at-wild-horses-festival-in-san-diego",
    "/articles/ch-11-shit-waves-hawaii", "/articles/new-balance-933-andrew-reynolds",
    "/articles/nigo-and-pharrell-williams-appointed-as-creative-advisors-for-not-a-hotel",
    "/articles/the-kate-bellm-interview", "/articles/redman-muddy-water-too-album-drop",
    "/articles/kelly-slater-retires", "/articles/fashion", "/articles/broncho-jams",
    "/articles/welcome-to-the-team", "/articles/neon-pill",
    "/articles/99-cents-only-store-gallery-exhibition", "/articles/the-legend-of-phil-shao",
    "/articles/surfer-aloslebir-108-foot-monster-wave", "/articles/stussy-autumn-drop",
    "/articles/post-malone-f1-trillion", "/articles/sora-launches", "/articles/defective-units-vol-1",
]


TEMPLATE_SLUG = "defective-units-vol-1"
_TPL_PAYLOAD = None


def _template_payload():
    global _TPL_PAYLOAD
    if _TPL_PAYLOAD is None:
        with open(os.path.join(ROOT, "articles", TEMPLATE_SLUG, "_payload.json"), encoding="utf-8") as fh:
            _TPL_PAYLOAD = json.load(fh)
    return list(_TPL_PAYLOAD)


def _tpl_grid_item():
    o = json.loads(_gql_template())
    for bl in o["data"]["page"]["content"].get("blocks", []):
        if bl.get("type") == "media_grid_block" and bl.get("items"):
            return bl["items"][0]
    return None


def _tpl_embed():
    o = json.loads(_gql_template())
    for bl in o["data"]["page"]["content"].get("blocks", []):
        if bl.get("type") == "embed":
            return bl
    return None


def _slide_by_id(sid):
    try:
        for s in read_content().get("slides", []):
            if s.get("id") == sid:
                return s
    except Exception:
        pass
    return None


_ASPECTS = None


def image_aspects():
    """{filename: width/height} for every image, so thumbnails keep their ratio."""
    global _ASPECTS
    if _ASPECTS is None:
        _ASPECTS = {}
        try:
            from PIL import Image
            for f in os.listdir(IMAGES_DIR):
                if f.lower().endswith(ALLOWED_IMG):
                    try:
                        w, h = Image.open(os.path.join(IMAGES_DIR, f)).size
                        _ASPECTS[f] = round(w / h, 4) if h else 1
                    except Exception:
                        pass
        except Exception:
            pass
    return _ASPECTS


_DATO_URL = re.compile(r"https://www\.datocms-assets\.com/[^\"\\]*")


def _image_block(bid, src, caption):
    """A media_grid_block holding one image of `src` with `caption`."""
    item = copy.deepcopy(_tpl_grid_item()) or {"id": bid + "-i", "caption": "", "media": {}}
    item = json.loads(_DATO_URL.sub(src, json.dumps(item)))   # point every asset URL at our image
    item["caption"] = caption or ""
    if isinstance(item.get("media"), dict):
        item["media"]["video"] = None
        item["media"]["alt"] = None
        item["media"]["title"] = None
    return {"id": bid, "type": "media_grid_block", "items": [item]}


def _video_block(bid, video_id, caption):
    """An embed block for a YouTube video id."""
    emb = copy.deepcopy(_tpl_embed())
    if not emb:
        return None
    emb["id"] = bid
    e = emb.setdefault("embed", {})
    e["provider"] = "youtube"
    e["providerUid"] = video_id
    e["url"] = "https://www.youtube.com/watch?v=" + video_id
    e["thumbnailUrl"] = "https://i.ytimg.com/vi/%s/hqdefault.jpg" % video_id
    e["title"] = caption or ""
    return emb


def _slide_media(s):
    """Normalize a slide's media list; fall back to its single image."""
    media = s.get("media")
    if isinstance(media, list) and media:
        return media
    if s.get("image"):
        return [{"type": "image", "src": s["image"], "caption": ""}]
    return []


def virtual_payload(slug):
    """Build a Nuxt payload for a virtual /articles/tlb-<id> route from a slide."""
    sid = slug[4:] if slug.startswith("tlb-") else slug
    s = _slide_by_id(sid)
    arr = _template_payload()
    if not s:
        return json.dumps(arr, ensure_ascii=False)
    img = s.get("image") or ""
    title = s.get("title") or s.get("bottom") or ""
    desc = s.get("desc") or ""
    slug_idx = -1
    for i, v in enumerate(arr):
        if not isinstance(v, str):
            continue
        if img and re.match(r"^/images/[A-Za-z0-9._-]+\.(?:jpe?g|png|webp|gif)$", v, re.I):
            arr[i] = img
            continue
        if v == TEMPLATE_SLUG:
            arr[i] = slug
            slug_idx = i
    if title and slug_idx >= 0 and isinstance(arr[slug_idx + 1], str):
        arr[slug_idx + 1] = title
    if desc:
        first = True
        for i, v in enumerate(arr):
            if isinstance(v, str) and len(v) > 40 and not re.match(r"^https?:|^data:", v) and "/images/" not in v:
                arr[i] = desc if first else ""
                first = False
    return json.dumps(arr, ensure_ascii=False)


_GQL_TPL = None


def _gql_template():
    global _GQL_TPL
    if _GQL_TPL is None:
        with open(os.path.join(ROOT, "gql_template.json"), encoding="utf-8") as fh:
            _GQL_TPL = fh.read()
    return _GQL_TPL


def _slide_for_slug(slug):
    """slug 'tlb-<id>' -> that slide; a real article slug -> its first slide."""
    if slug and slug.startswith("tlb-"):
        return _slide_by_id(slug[4:])
    try:
        for s in read_content().get("slides", []):
            if (s.get("url") or "") == "/articles/" + (slug or ""):
                return s
    except Exception:
        pass
    return None


def gql_response(slug):
    """Build a DatoCMS-shaped GraphQL response for a slug, filled with our slide."""
    obj = json.loads(_gql_template())
    page = obj.get("data", {}).get("page")
    if not page:
        return json.dumps(obj, ensure_ascii=False)
    s = _slide_for_slug(slug)
    page["slug"] = slug
    if s:
        mm = re.match(r"^(.*?)\s*(\([^)]*\))?\s*$", str(s.get("bottom") or ""))
        # badge/category: dedicated field if set, else derived from the bottom label
        cat = str(s.get("category") or "").strip() or (mm.group(1).strip() if mm else "") or (s.get("bottom") or "")
        page["title"] = s.get("title") or s.get("bottom") or page.get("title")
        if isinstance(page.get("tag"), dict) and cat:
            page["tag"]["title"] = cat
        # month (shown next to the category) comes from the date — align it
        mon = (re.search(r"\(([^)]*)\)", str(s.get("bottom") or "")) or [None, ""])[1].strip()
        months = ["january", "february", "march", "april", "may", "june",
                  "july", "august", "september", "october", "november", "december"]
        if mon.lower() in months and isinstance(page.get("date"), str):
            page["date"] = "2026-%02d-09" % (months.index(mon.lower()) + 1)
        # rebuild the article body from the slide's media list (images + videos),
        # in order, in the ORIGINAL format (media_grid + embed blocks)
        desc = s.get("desc") or ""
        first_img = None
        try:
            content = page["content"]
            doc = content["value"]["document"]
            children, blocks = [], []
            if desc:
                children.append({"type": "paragraph", "children": [{"type": "span", "value": desc, "marks": []}]})
            for i, m in enumerate(_slide_media(s)):
                bid = "tlbblk%d" % i
                if (m.get("type") == "video") and (m.get("videoId") or m.get("url")):
                    vid = m.get("videoId") or _yt_id(m.get("url"))
                    bl = _video_block(bid, vid, m.get("caption")) if vid else None
                    if bl:
                        blocks.append(bl)
                        children.append({"type": "block", "item": bid})
                else:
                    src = m.get("src") or m.get("image") or ""
                    if src:
                        first_img = first_img or src
                        blocks.append(_image_block(bid, src, m.get("caption")))
                        children.append({"type": "block", "item": bid})
            doc["children"] = children
            content["blocks"] = blocks
        except Exception:
            pass
        # keep one page image for meta/og; clear video/alt
        if page.get("images"):
            page["images"] = page["images"][:1]
        for im in page.get("images", []) or []:
            if isinstance(im, dict):
                im["video"] = None
                im["alt"] = None
                im["title"] = None
    out = json.dumps(obj, ensure_ascii=False)
    # clean up any leftover template asset URLs (meta/og/thumbnails) -> our first image
    if s:
        fallback = first_img or s.get("image")
        if fallback:
            out = _DATO_URL.sub(fallback, out)
    return out


def _yt_id(url):
    if not url:
        return ""
    m = re.search(r"(?:v=|/embed/|youtu\.be/|/shorts/)([A-Za-z0-9_-]{6,})", url)
    return m.group(1) if m else (url if re.match(r"^[A-Za-z0-9_-]{6,}$", url) else "")


_JS_CACHE = {}


def rewritten_js(name):
    """Serve app JS with the DatoCMS endpoint pointed at our local server."""
    if name in _JS_CACHE:
        return _JS_CACHE[name]
    with open(os.path.join(ROOT, "_nuxt", name), "r", encoding="utf-8") as fh:
        js = fh.read()
    base = "http://localhost:%d" % PORT     # absolute URL (datocms client does new URL(endpoint))
    js = js.replace("https://graphql.datocms.com", base + "/gql")
    js = js.replace("https://graphql-listen.datocms.com", base + "/gql-listen")
    _JS_CACHE[name] = js
    return js


class _TextExtractor(HTMLParser):
    """Collect visible text-node strings in document order (like the browser)."""
    SKIP = {"script", "style", "noscript", "template", "head", "title", "meta", "link"}

    def __init__(self):
        super().__init__()
        self.stack = []
        self.items = []

    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)

    def handle_endtag(self, tag):
        while self.stack:
            t = self.stack.pop()
            if t == tag:
                break

    def handle_data(self, data):
        if any(t in self.SKIP for t in self.stack):
            return
        s = data.strip()
        if s:
            self.items.append(s)


def scan_text(path):
    """Return ordered unique editable strings for a route (excludes slide labels)."""
    rel = path.strip("/")
    fs = os.path.join(ROOT, rel, "index.html") if rel else os.path.join(ROOT, "index.html")
    if not os.path.isfile(fs):
        return []
    with open(fs, encoding="utf-8") as fh:
        html = fh.read()
    # drop the hydration data island entirely
    html = re.sub(r'<script[^>]*id="__NUXT_DATA__".*?</script>', "", html, flags=re.S)
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    # exclude slide-label noise (pure ints + strings used as slide labels)
    labels = set()
    try:
        cfg = read_content()
        for s in cfg.get("slides", []):
            labels.add((s.get("top") or "").strip())
            labels.add((s.get("bottom") or "").strip())
    except Exception:
        pass
    seen, out = set(), []
    for s in p.items:
        if s in seen:
            continue
        if len(s) < 2:            # drop per-letter logo fragments & stray glyphs
            continue
        if s.isdigit():
            continue
        if not re.search(r"[A-Za-z0-9가-힣]", s):  # must contain a letter/number/Hangul
            continue
        if s in labels:
            continue
        if len(s) > 600:
            continue
        seen.add(s)
        out.append(s)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # strip query for static file resolution (keeps _payload.json?<hash> working)
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        return super().translate_path(path)

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------------- GET ----------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/content":
            try:
                return self._send_json(read_content())
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        if path == "/api/images":
            try:
                files = sorted(
                    f for f in os.listdir(IMAGES_DIR)
                    if f.lower().endswith(ALLOWED_IMG)
                )
                return self._send_json({"images": files})
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        # virtual per-slide article payload: /articles/tlb-<id>/_payload.json
        mvp = re.match(r"^/articles/(tlb-[^/]+)/_payload\.json$", path)
        if mvp:
            try:
                body = virtual_payload(mvp.group(1)).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        # virtual per-slide article page (direct load / refresh) -> template HTML shell
        mvh = re.match(r"^/articles/(tlb-[^/]+)/?$", path)
        if mvh:
            tpl = os.path.join(ROOT, "articles", TEMPLATE_SLUG, "index.html")
            if os.path.isfile(tpl):
                with open(tpl, "rb") as fh:
                    html = fh.read()
                if INJECT.encode() not in html and b"</body>" in html:
                    html = html.replace(b"</body>", INJECT.encode() + b"</body>", 1)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(html)
                return

        # app JS with the DatoCMS endpoint redirected to our local /gql
        mjs = re.match(r"^/_nuxt/(BGLHITTy\.js|NgnKf_Q9\.js)$", path)
        if mjs:
            try:
                body = rewritten_js(mjs.group(1)).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        # DatoCMS real-time subscription (SSE) — not needed; keep it quiet
        if path.startswith("/gql-listen"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                self.wfile.write(b": ok\n\n")
            except Exception:
                pass
            return

        if path == "/tlb-admin.js":
            fs = os.path.join(ROOT, "tlb-admin.js")
            if os.path.isfile(fs):
                with open(fs, "rb") as fh:
                    js = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(js)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(js)
                return

        if path == "/api/aspects":
            return self._send_json({"aspects": image_aspects()})

        if path == "/api/pages":
            return self._send_json({"pages": ROUTES})

        if path == "/api/textscan":
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            p = qs.get("path", ["/"])[0]
            try:
                return self._send_json({"path": p, "texts": scan_text(p)})
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        # inject override script into served site HTML (not the admin app)
        clean = path.split("?", 1)[0]
        is_html = clean.endswith("/") or clean.endswith(".html")
        if is_html and not clean.startswith("/admin"):
            fs = self.translate_path(self.path)
            if os.path.isdir(fs):
                fs = os.path.join(fs, "index.html")
            if os.path.isfile(fs):
                with open(fs, "rb") as fh:
                    html = fh.read()
                if INJECT.encode() not in html and b"</body>" in html:
                    html = html.replace(b"</body>", INJECT.encode() + b"</body>", 1)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(html)
                return

        return super().do_GET()

    # ---------------- POST ----------------
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        # local GraphQL endpoint standing in for DatoCMS — returns our slide data
        if path.startswith("/gql"):
            try:
                q = json.loads(body.decode("utf-8")) if body else {}
                slug = (q.get("variables") or {}).get("slug") or ""
                out = gql_response(slug).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(out)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(out)
                return
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        if path == "/api/content":
            try:
                data = json.loads(body.decode("utf-8"))
                if not isinstance(data, dict) or "slides" not in data:
                    raise ValueError("invalid content payload")
                with open(CONTENT, "w", encoding="utf-8") as fh:
                    json.dump(data, fh, ensure_ascii=False, indent=1)
                return self._send_json({"ok": True, "slides": len(data.get("slides", []))})
            except Exception as e:
                return self._send_json({"error": str(e)}, 400)

        if path == "/api/upload":
            try:
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name = safe_name(qs.get("name", ["upload"])[0])
                ext = os.path.splitext(name)[1].lower()
                if ext not in ALLOWED_IMG:
                    raise ValueError("unsupported file type: " + ext)
                os.makedirs(IMAGES_DIR, exist_ok=True)
                dest = os.path.join(IMAGES_DIR, name)
                # avoid clobbering an existing different file
                stem, i = os.path.splitext(name)[0], 1
                while os.path.exists(dest):
                    name = f"{stem}-{i}{ext}"
                    dest = os.path.join(IMAGES_DIR, name)
                    i += 1
                with open(dest, "wb") as fh:
                    fh.write(body)
                globals()["_ASPECTS"] = None   # new image → recompute aspects
                return self._send_json({"ok": True, "image": "/images/" + name, "name": name})
            except Exception as e:
                return self._send_json({"error": str(e)}, 400)

        return self._send_json({"error": "not found"}, 404)

    # ---------------- DELETE ----------------
    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/images":
            try:
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                name = safe_name(qs.get("name", [""])[0])
                target = os.path.join(IMAGES_DIR, name)
                if not os.path.isfile(target):
                    raise ValueError("no such image")
                # block deletion if still used by a slide
                cfg = read_content()
                used = any((s.get("image") or "").endswith("/" + name) for s in cfg.get("slides", []))
                if used and qs.get("force", ["0"])[0] != "1":
                    return self._send_json({"error": "in use", "inUse": True}, 409)
                os.remove(target)
                return self._send_json({"ok": True, "deleted": name})
            except Exception as e:
                return self._send_json({"error": str(e)}, 400)
        return self._send_json({"error": "not found"}, 404)

    def log_message(self, *a):
        pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("", PORT), Handler) as httpd:
        print(f"THE LOOKBACK + admin -> http://localhost:{PORT}/")
        print(f"Admin panel        -> http://localhost:{PORT}/admin/")
        print("Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
