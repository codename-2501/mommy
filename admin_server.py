#!/usr/bin/env python3
"""Painting archive — site + local admin server.

Serves the frontend in site/, the admin panel at /admin/, and a small JSON API that
edits content.json, the image library and the per-page copy. Everything it serves is
ours: no third-party site, bundle or content is read or shipped.

Usage:  python admin_server.py [port]     (default 8082)
Site:   http://localhost:8082/
Admin:  http://localhost:8082/admin/  (local only — a public tunnel gets a 404)
"""
import sys, os, json, re, time, glob, shutil, hashlib, tempfile, urllib.parse, http.server, socketserver, socket

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(ROOT, "content.json")
BACKUP_DIR = os.path.join(ROOT, ".backups")
IMAGES_DIR = os.path.join(ROOT, "images")
SITE_DIR = os.path.join(ROOT, "site")
SITE_ROUTES = ("/", "/surf", "/articles", "/about")   # SPA shell routes (+ /p/<id>)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8082

ALLOWED_IMG = (".jpg", ".jpeg", ".png", ".webp", ".gif")

KEEP_BACKUPS = 30


def read_content():
    with open(CONTENT, encoding="utf-8") as fh:
        return json.load(fh)


def content_version():
    """A fingerprint of the file as it is right now.

    The admin holds a whole copy of content.json in the browser and saves all of it, so a tab
    that loaded before some other change landed would write its stale copy back over that
    change — a lost update nobody sees, because the save reports success. The version tags
    what a tab read, letting a save that is not based on the current file be refused.
    """
    try:
        with open(CONTENT, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()[:16]
    except OSError:
        return ""


def backup_content():
    """Snapshot the current content.json before it is replaced.

    The archive is the only thing standing between a bad write and a lost
    archive, so it is taken from the file on disk — not from whatever the
    caller believes the current state to be.
    """
    if not os.path.exists(CONTENT):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"content-{stamp}.json")
    n = 1
    while os.path.exists(dest):                      # same-second saves
        dest = os.path.join(BACKUP_DIR, f"content-{stamp}-{n}.json")
        n += 1
    shutil.copy2(CONTENT, dest)
    old = sorted(glob.glob(os.path.join(BACKUP_DIR, "content-*.json")))[:-KEEP_BACKUPS]
    for f in old:
        os.remove(f)
    return dest


def write_content(data, allow_empty=False):
    """Replace content.json atomically, refusing writes that destroy the archive.

    A truncating open() leaves nothing to fall back on if the payload turns out
    to be empty or the write dies halfway, so the new content lands in a temp
    file that is renamed over the old one only once it is complete on disk.
    """
    if not isinstance(data, dict) or not isinstance(data.get("slides"), list):
        raise ValueError("invalid content payload: slides must be a list")

    try:
        current = read_content().get("slides", [])
    except Exception:
        current = []                                  # unreadable/missing: nothing to protect

    incoming = data["slides"]
    if current and not incoming and not allow_empty:
        raise ValueError(
            f"refusing to erase all {len(current)} slides — "
            "pass ?allow_empty=1 if this is intended"
        )

    backup_content()
    fd, tmp = tempfile.mkstemp(dir=ROOT, prefix=".content-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=1)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, CONTENT)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    return len(incoming)


_ASSET_REF = re.compile(r'(?:href|src)="(/site/[A-Za-z0-9._/-]+\.(?:css|js))"')


def site_shell():
    """The SPA shell with every /site/ asset stamped with its file's mtime.

    Without the stamp a browser that already cached app.css or views.js keeps using the
    old copy, so a code change simply does not show up until a hard reload.
    """
    with open(os.path.join(SITE_DIR, "index.html"), encoding="utf-8") as fh:
        html = fh.read()

    def stamp(m):
        ref = m.group(1)
        fs = os.path.join(ROOT, ref.lstrip("/"))
        try:
            v = int(os.path.getmtime(fs))
        except OSError:
            return m.group(0)
        return m.group(0).replace(ref, "%s?v=%d" % (ref, v))

    return _ASSET_REF.sub(stamp, html)


def safe_name(name):
    name = os.path.basename(name).replace("\\", "_")
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    return name or "upload.bin"


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


# Pages whose body the admin composes as blocks (content.json → blocks[page]).
# The block list IS the page: there is no fixed field set to scan for.
EDITABLE_PAGES = ("/about",)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # strip query for static file resolution (keeps _payload.json?<hash> working)
    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        return super().translate_path(path)

    def end_headers(self):
        """Static files went out with only Last-Modified, so browsers kept serving an old
        site/app.css and site/views.js from cache long after they changed. Nothing here is
        worth caching — this is a local editing server."""
        sent = b"".join(getattr(self, "_headers_buffer", []) or [])
        if b"Cache-Control" not in sent:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------------- public vs local ----------------
    def _is_public(self):
        """True when the request arrived from outside this machine.

        A tunnel (cloudflared) connects to us over loopback, so the peer address always
        looks local. What gives a public request away is the Host it asked for and the
        proxy headers it carries.
        """
        for h in ("cf-connecting-ip", "x-forwarded-for", "cf-ray", "x-real-ip"):
            if self.headers.get(h):
                return True
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        return host not in ("localhost", "127.0.0.1", "::1", "")

    def _deny_public(self, path):
        """The editing surface exists for the machine that runs the server, not the world."""
        if not self._is_public():
            return False
        p = path.rstrip("/") or "/"
        blocked = (
            p == "/admin" or p.startswith("/admin/")
            or p.startswith("/api/pages")
        )
        if blocked:
            self.send_error(404, "Not Found")
            return True
        return False

    def _deny_public_write(self):
        """Saving content, uploading and deleting are local-only, whatever the route."""
        if self._is_public():
            self._send_json({"error": "read-only"}, 403)
            return True
        return False

    def _send_html(self, html):
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, fs, ctype):
        with open(fs, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------------- GET ----------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if self._deny_public(path):          # over a tunnel the admin simply does not exist
            return

        # new frontend (site/): SPA shell for all app routes
        clean_route = path.rstrip("/") or "/"
        if clean_route in SITE_ROUTES or clean_route.startswith("/p/"):
            shell = os.path.join(SITE_DIR, "index.html")
            if os.path.isfile(shell):
                return self._send_html(site_shell())

        if path == "/api/content":
            try:
                data = read_content()
                data["_version"] = content_version()   # what this reader is basing edits on
                return self._send_json(data)
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

        if path == "/api/aspects":
            return self._send_json({"aspects": image_aspects()})

        # resized image cache: /thumbs/<width>/<name> -> webp (carousel-size assets;
        # the originals are multi-MB and stall the scroll while decoding)
        mth = re.match(r"^/thumbs/(\d{2,4})/([^/]+)$", path)
        if mth:
            try:
                w = max(64, min(2000, int(mth.group(1))))
                name = safe_name(urllib.parse.unquote(mth.group(2)))
                src = os.path.join(IMAGES_DIR, name)
                if not os.path.isfile(src):
                    return self._send_json({"error": "no such image"}, 404)
                tdir = os.path.join(IMAGES_DIR, ".thumbs", str(w))
                dest = os.path.join(tdir, name + ".webp")
                if (not os.path.isfile(dest)) or os.path.getmtime(dest) < os.path.getmtime(src):
                    from PIL import Image
                    os.makedirs(tdir, exist_ok=True)
                    im = Image.open(src)
                    if im.mode not in ("RGB", "RGBA"):
                        im = im.convert("RGB")
                    if im.width > w:
                        im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
                    im.save(dest, "WEBP", quality=82, method=4)
                with open(dest, "rb") as fh:
                    body = fh.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/webp")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "public, max-age=86400")
                self.end_headers()
                self.wfile.write(body)
                return
            except Exception as e:
                return self._send_json({"error": str(e)}, 500)

        if path == "/api/pages":
            return self._send_json({"pages": list(EDITABLE_PAGES)})

        return super().do_GET()

    # ---------------- POST ----------------
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""

        # every write is local-only
        if self._deny_public_write():
            return

        if path == "/api/content":
            try:
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                data = json.loads(body.decode("utf-8"))
                allow_empty = qs.get("allow_empty", ["0"])[0] == "1"

                # a save must be based on the file as it is now, or it is a stale tab
                # writing its whole copy back over whatever changed in the meantime
                base = data.pop("_version", None)
                now = content_version()
                if base is not None and now and base != now:
                    return self._send_json({
                        "error": "content.json 이 이 탭에서 불러온 뒤로 변경됐습니다. "
                                 "새로고침한 뒤 다시 편집하세요 (덮어쓰기 방지)",
                        "stale": True,
                    }, 409)

                n = write_content(data, allow_empty=allow_empty)
                return self._send_json({"ok": True, "slides": n, "version": content_version()})
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
        if self._deny_public_write():
            return
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


class DualStackServer(socketserver.ThreadingTCPServer):
    """Listen on IPv6 with dual-stack so both 127.0.0.1 and ::1 (localhost) reach us.
    On Windows, `localhost` often resolves to ::1 first — an IPv4-only bind then refuses it."""
    address_family = socket.AF_INET6
    allow_reuse_address = True

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        except (AttributeError, OSError):
            pass
        super().server_bind()


def main():
    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = DualStackServer(("", PORT), Handler)     # IPv4 + IPv6
    except OSError:
        httpd = socketserver.ThreadingTCPServer(("", PORT), Handler)   # IPv4-only fallback
    with httpd:
        print(f"LSE GALLERY + admin -> http://localhost:{PORT}/  (127.0.0.1 and ::1)")
        print(f"Admin panel        -> http://localhost:{PORT}/admin/")
        print("Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
