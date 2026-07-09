#!/usr/bin/env python3
"""THE LOOKBACK clone + admin server.

Serves the cloned site (with a runtime override script injected), the admin
panel at /admin/, and a small JSON API to edit content.json and upload images.

Usage:  python admin_server.py [port]     (default 8082)
Site:   http://localhost:8082/
Admin:  http://localhost:8082/admin/
"""
import sys, os, json, re, urllib.parse, http.server, socketserver
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
