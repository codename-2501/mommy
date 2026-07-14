#!/usr/bin/env python3
"""Painting archive — site + local admin server.

Serves the frontend in site/, the admin panel at /admin/, and a small JSON API that
edits content.json, the image library and the per-page copy. Everything it serves is
ours: no third-party site, bundle or content is read or shipped.

Usage:  python admin_server.py [port]     (default 8082)
Site:   http://localhost:8082/
Admin:  http://localhost:8082/admin/  (local always; from outside only with a key — see below)

Remote admin is off unless a key exists. `python admin_server.py --remote-admin` writes one
to .admin_token and prints the single link that carries it. Whoever holds that link can edit
the archive, so it is the whole lock: hand it out as you would a key, and `--forget-remote`
throws it away — every link minted from it dies with it.
"""
import sys, os, json, re, time, glob, shutil, hashlib, hmac, secrets, tempfile, urllib.parse, http.server, socketserver, socket

ROOT = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(ROOT, "content.json")
BACKUP_DIR = os.path.join(ROOT, ".backups")
IMAGES_DIR = os.path.join(ROOT, "images")
SITE_DIR = os.path.join(ROOT, "site")
SITE_ROUTES = ("/", "/flow", "/articles", "/about")   # SPA shell routes (+ /p/<id>)
LEGACY_ROUTES = {"/surf": "/flow"}                    # renamed — keep old links alive
_ports = [a for a in sys.argv[1:] if a.isdigit()]     # the flags are not a port
PORT = int(_ports[0]) if _ports else 8082

ALLOWED_IMG = (".jpg", ".jpeg", ".png", ".webp", ".gif")

KEEP_BACKUPS = 30

TOKEN_FILE = os.path.join(ROOT, ".admin_token")
COOKIE = "lse_admin"
COOKIE_DAYS = 14


def remote_key():
    """The key that lets a request from outside edit — empty when remote admin is off.

    Its absence is the safe default: with no key the admin does not exist beyond this
    machine, whatever the tunnel says."""
    try:
        with open(TOKEN_FILE) as fh:
            return fh.read().strip()
    except OSError:
        return ""


def mint_key():
    key = secrets.token_urlsafe(32)
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(key + "\n")
    return key


def image_uses(content, name):
    """Every place an image is referenced, not just a slide's cover.

    The delete guard used to look only at slides[].image, so an image that was a page's
    background, the wordmark's logo, the favicon, an About block or a body image inside a
    slide counted as unused — it was deleted without a word, and its references stayed behind
    pointing at a file that no longer existed. build_static then refused to build at all.
    """
    ref = "/images/" + name
    hit = lambda v: isinstance(v, str) and v.endswith(ref)
    uses = []

    for s in content.get("slides") or []:
        if hit(s.get("image")):
            uses.append(("slide", s.get("id") or ""))
        for m in s.get("media") or []:
            if hit(m.get("src")):
                uses.append(("slide-body", s.get("id") or ""))

    for page, blocks in (content.get("blocks") or {}).items():
        for b in blocks or []:
            if b.get("type") == "image" and hit(b.get("src")):
                uses.append(("block", page))

    for page, bg in (content.get("backgrounds") or {}).items():
        if hit((bg or {}).get("src")):
            uses.append(("background", page))

    if hit((content.get("wordmark") or {}).get("image")):
        uses.append(("logo", ""))
    meta = content.get("meta") or {}
    if hit(meta.get("favicon")):
        uses.append(("favicon", ""))
    if hit(meta.get("ogImage")):
        uses.append(("og", ""))
    return uses


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


def site_shell(base_url=""):
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

    try:
        meta = read_content().get("meta") or {}
    except Exception:
        meta = {}
    return _ASSET_REF.sub(stamp, inject_head(html, meta, base_url))


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


COLORS_CACHE = os.path.join(ROOT, ".colors.json")
_COLORS = None


def image_colors():
    """{filename: "#rrggbb"} — one colour standing for each painting.

    Read at a glance, the archive is a run of colours before it is a run of dates: the year the
    flowers came, the winter of grey water. Averaging a whole picture would wash every one of
    them to the same mud, so each is shrunk to 8x8 first and the most saturated of those 64
    cells is taken — the colour the painting is actually *of*, not the colour of its canvas.

    It costs a read of every image, so it is cached on disk and only the images that are new
    since last time are looked at."""
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
                im = Image.open(os.path.join(IMAGES_DIR, f)).convert("RGB").resize((8, 8))
                best, score = (128, 128, 128), -1
                for px in im.getdata():
                    mx, mn = max(px), min(px)
                    sat = (mx - mn) / mx if mx else 0
                    s2 = sat * 2 + (mx / 255) * 0.5      # colourful first, then bright
                    if s2 > score:
                        score, best = s2, px
                out[f] = "#%02x%02x%02x" % best
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

    def _base_url(self):
        """Where this request thinks the site lives — an og:image must be absolute, and over
        a tunnel that host is the tunnel's, not localhost. The scraper asks over https."""
        host = (self.headers.get("Host") or "").strip()
        if not host:
            return ""
        proto = self.headers.get("x-forwarded-proto")
        if not proto:
            proto = "http" if host.startswith(("localhost", "127.0.0.1", "[::1]")) else "https"
        return "%s://%s" % (proto, host)

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

    def _cookies(self):
        out = {}
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k:
                out[k] = v
        return out

    def _authed(self):
        """Whether this request may edit.

        Local requests always may — the panel exists for the machine that runs the server.
        A request from outside may only if it carries the key, compared in constant time so
        the comparison itself does not leak how much of a guess was right.
        """
        if not self._is_public():
            return True
        key = remote_key()
        if not key:
            return False
        offered = (self._cookies().get(COOKIE)
                   or self.headers.get("X-Admin-Key")
                   or urllib.parse.parse_qs(
                       urllib.parse.urlparse(self.path).query).get("k", [""])[0])
        return bool(offered) and hmac.compare_digest(offered, key)

    def _grant(self, path):
        """Trade the key in the URL for a cookie, then send the caller back without it.

        A key that stays in the address bar is a key left in the lock: it is written to
        history, offered to whatever the page later links to, and read over the holder's
        shoulder. It is spent once, here, and the browser carries it from then on.
        """
        secure = "; Secure" if self.headers.get("x-forwarded-proto") == "https" else ""
        self.send_response(302)
        self.send_header("Set-Cookie",
                         "%s=%s; Path=/; Max-Age=%d; HttpOnly; SameSite=Lax%s"
                         % (COOKIE, remote_key(), COOKIE_DAYS * 86400, secure))
        self.send_header("Location", path if path.endswith("/") else path + "/")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()

    def _deny_public(self, path):
        """The editing surface exists for the machine that runs the server, and for whoever
        holds the key — to everyone else it is not hidden behind a password, it is absent.
        A wrong key is answered 404, not 403: a refusal would confirm there is something here
        to guess at."""
        if self._authed():
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
        """Saving content, uploading and deleting need the key when they come from outside,
        whatever the route — reading the archive never does."""
        if not self._authed():
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
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # arriving on the admin with a key in hand: take it out of the URL at once
        if (path.rstrip("/") == "/admin" and self._is_public()
                and urllib.parse.parse_qs(parsed.query).get("k") and self._authed()):
            return self._grant(path)

        if self._deny_public(path):          # without the key the admin simply does not exist
            return

        # new frontend (site/): SPA shell for all app routes
        clean_route = path.rstrip("/") or "/"

        # /surf was renamed to /flow: a link someone already has must not land on a 404
        if clean_route in LEGACY_ROUTES:
            self.send_response(301)
            self.send_header("Location", LEGACY_ROUTES[clean_route])
            self.end_headers()
            return

        if clean_route in SITE_ROUTES or clean_route.startswith("/p/"):
            shell = os.path.join(SITE_DIR, "index.html")
            if os.path.isfile(shell):
                return self._send_html(site_shell(self._base_url()))

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

        if path == "/api/colors":
            return self._send_json({"colors": image_colors()})

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
                # an image in use anywhere — a cover, a body image, a block, a background,
                # the logo, the favicon — is not deleted unless the caller insists
                uses = image_uses(read_content(), name)
                if uses and qs.get("force", ["0"])[0] != "1":
                    return self._send_json(
                        {"error": "in use", "inUse": True, "uses": uses}, 409)
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
    if "--remote-admin" in sys.argv:
        key = remote_key() or mint_key()
        print("Remote admin is ON. The link below is the key — anyone holding it can edit.")
        print("  https://<your-tunnel-host>/admin/?k=" + key)
        print("Run with --forget-remote to revoke it.")
        return
    if "--forget-remote" in sys.argv:
        try:
            os.remove(TOKEN_FILE)
            print("Remote admin is OFF. Every link minted from the old key is dead.")
        except OSError:
            print("Remote admin was already off.")
        return

    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = DualStackServer(("", PORT), Handler)     # IPv4 + IPv6
    except OSError:
        httpd = socketserver.ThreadingTCPServer(("", PORT), Handler)   # IPv4-only fallback
    with httpd:
        print(f"LSE GALLERY + admin -> http://localhost:{PORT}/  (127.0.0.1 and ::1)")
        print(f"Admin panel        -> http://localhost:{PORT}/admin/")
        print("Remote admin       -> " + ("ON (key in .admin_token)" if remote_key()
                                          else "off — local only"))
        print("Ctrl+C to stop.", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
