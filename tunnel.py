#!/usr/bin/env python3
"""Temporary public link for the local site (cloudflared quick tunnel).

The admin panel drives this: publish a link, keep it alive across crashes and server
restarts, and push the URL to Telegram whenever it changes (a quick tunnel gets a new
hostname every time it starts, so the link is announced each time).

State lives in .tunnel.json next to this file (gitignored).
"""
import json, os, re, subprocess, threading, time, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, ".tunnel.json")
SECRETS = os.path.expanduser("~/finance_flow/secrets.local.json")   # reused with permission
URL_RE = re.compile(rb"https://[a-z0-9-]+\.trycloudflare\.com")
RESTART_WAIT = 3          # seconds before a dead tunnel is brought back up


def _load_state():
    try:
        with open(STATE, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {"keepalive": False}


def _save_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(st, fh, indent=1)
    os.replace(tmp, STATE)


def _telegram_creds():
    """Bot token + chat id from the finance_flow secret store. Never logged."""
    try:
        with open(SECRETS, encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception:
        return None, None
    token = chat = None

    def walk(o):
        nonlocal token, chat
        if isinstance(o, dict):
            for k, v in o.items():
                ku = k.upper()
                if ku == "TELEGRAM_BOT_TOKEN" and isinstance(v, str) and v:
                    token = token or v
                elif ku == "TELEGRAM_CHAT_ID" and v:
                    chat = chat or str(v)
                elif ku == "TELEGRAM_CHAT_IDS" and isinstance(v, (list, str)) and v:
                    first = v[0] if isinstance(v, list) else v.split(",")[0]
                    chat = chat or str(first).strip()
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(data)
    return token, chat


class Tunnel:
    def __init__(self, port):
        self.port = port
        self.proc = None
        self.url = None
        self.started_at = None
        self.last_error = None
        self.keepalive = bool(_load_state().get("keepalive"))
        self._lock = threading.Lock()
        self._want_up = False
        self._sup = None

    # ---------- telegram ----------
    def notify(self, url):
        token, chat = _telegram_creds()
        if not token or not chat:
            self.last_error = "telegram credentials not found"
            return False
        text = "THE LOOKBACK 임시 링크\n%s\n(cloudflared quick tunnel · 서버가 살아 있는 동안 유효)" % url
        body = urllib.parse.urlencode({
            "chat_id": chat, "text": text, "disable_web_page_preview": "false",
        }).encode()
        req = urllib.request.Request(
            "https://api.telegram.org/bot%s/sendMessage" % token, data=body)
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return r.status == 200
        except Exception as e:
            self.last_error = "telegram send failed: %s" % e
            return False

    # ---------- process ----------
    def _spawn(self):
        cmd = ["cloudflared", "tunnel", "--no-autoupdate",
               "--url", "http://localhost:%d" % self.port]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                                     stderr=subprocess.PIPE)
        self.url = None
        self.started_at = time.time()
        threading.Thread(target=self._read_url, args=(self.proc,), daemon=True).start()

    def _read_url(self, proc):
        """cloudflared prints the hostname on stderr; announce it once we see it."""
        for line in iter(proc.stderr.readline, b""):
            m = URL_RE.search(line)
            if m and not self.url:
                self.url = m.group(0).decode()
                self.notify(self.url)

    def _supervise(self):
        while self._want_up:
            if self.proc is None or self.proc.poll() is not None:
                if self.proc is not None:
                    self.last_error = "tunnel exited (code %s), restarting" % self.proc.returncode
                if not self._want_up:
                    break
                self._spawn()
                # a tunnel that dies instantly would spin: wait before the next attempt
                for _ in range(RESTART_WAIT * 10):
                    if self.proc.poll() is not None or not self._want_up:
                        break
                    time.sleep(0.1)
            time.sleep(0.5)

    # ---------- api ----------
    def start(self):
        with self._lock:
            if self.running():
                return self.status()
            self._want_up = True
            self.last_error = None
            self._spawn()
            if self.keepalive and (self._sup is None or not self._sup.is_alive()):
                self._sup = threading.Thread(target=self._supervise, daemon=True)
                self._sup.start()
        return self.status()

    def stop(self):
        with self._lock:
            self._want_up = False
            if self.proc and self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except Exception:
                    self.proc.kill()
            self.proc = None
            self.url = None
            self.started_at = None
        return self.status()

    def set_keepalive(self, on):
        """Keep it up: restart a dead tunnel, and publish again when the server boots."""
        self.keepalive = bool(on)
        _save_state({"keepalive": self.keepalive})
        with self._lock:
            if self.keepalive:
                self._want_up = self.running() or self._want_up
                if self._want_up and (self._sup is None or not self._sup.is_alive()):
                    self._sup = threading.Thread(target=self._supervise, daemon=True)
                    self._sup.start()
        return self.status()

    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def status(self):
        return {
            "running": self.running(),
            "url": self.url,
            "keepalive": self.keepalive,
            "uptime": int(time.time() - self.started_at) if (self.started_at and self.running()) else 0,
            "error": self.last_error,
        }

    def boot(self):
        """Called at server start: an earlier 'keep alive' means publish again now."""
        if self.keepalive:
            self.start()
