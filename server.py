#!/usr/bin/env python3
"""Wargame Presenter - local web server.

Runs entirely on the presenting machine, uses only the Python standard library
and stores everything as JSON files in ./data.

    python server.py                 # http://127.0.0.1:8765 and opens the browser
    python server.py --port 9000 --no-browser
"""
from __future__ import annotations

import argparse
import base64
import binascii
import ipaddress
import json
import os
import re
import secrets
import shutil
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
SAMPLES = ROOT / "samples"

MAX_BODY = 60 * 1024 * 1024  # 60 MB (imports with embedded images)
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
FILE_RE = re.compile(r"^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,120}$")

# Explicit MIME types: on Windows the registry can map .js to text/plain,
# which breaks ES modules.
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
}
IMAGE_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def new_id(n: int = 10) -> str:
    return secrets.token_hex(n // 2 + 1)[:n]


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class Store:
    """JSON file storage. All writes are atomic (temp file + rename)."""

    def __init__(self, data_dir: Path):
        self.root = data_dir
        self.wargames = data_dir / "wargames"
        self.media = data_dir / "media"
        self.runs = data_dir / "runs"
        self.trash = data_dir / "trash"
        self.lock = threading.RLock()
        for d in (self.wargames, self.media, self.runs, self.trash):
            d.mkdir(parents=True, exist_ok=True)

    # ---------- helpers ----------
    @staticmethod
    def _check_id(value: str) -> str:
        if not isinstance(value, str) or not ID_RE.match(value):
            raise ApiError(400, "invalid id")
        return value

    @staticmethod
    def _read(path: Path):
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)

    def _write(self, path: Path, data) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

    # ---------- wargames ----------
    def wargame_path(self, wid: str) -> Path:
        return self.wargames / f"{self._check_id(wid)}.json"

    def list_wargames(self):
        items = []
        for p in sorted(self.wargames.glob("*.json")):
            try:
                wg = self._read(p)
            except (OSError, json.JSONDecodeError):
                continue
            pages = wg.get("pages") or []
            items.append({
                "id": wg.get("id", p.stem),
                "meta": wg.get("meta", {}),
                "settings": wg.get("settings", {}),
                "pageCount": len(pages),
                "decisionCount": sum(1 for pg in pages if pg.get("type") == "decision"),
                "attributeCount": len(wg.get("attributes") or []),
                "runCount": self.count_runs(wg.get("id", p.stem)),
            })
        items.sort(key=lambda w: (w["meta"].get("updated") or ""), reverse=True)
        return items

    def get_wargame(self, wid: str):
        path = self.wargame_path(wid)
        if not path.exists():
            raise ApiError(404, "wargame not found")
        return self._read(path)

    def save_wargame(self, wid: str, wg: dict):
        if not isinstance(wg, dict) or not isinstance(wg.get("pages"), list):
            raise ApiError(400, "invalid wargame")
        with self.lock:
            wg["id"] = wid
            meta = wg.setdefault("meta", {})
            meta.setdefault("created", now_iso())
            meta["updated"] = now_iso()
            self._write(self.wargame_path(wid), wg)
        return wg

    def create_wargame(self, wg: dict | None):
        wg = dict(wg or {})
        wg.setdefault("schema", 1)
        wg.setdefault("pages", [])
        wg.setdefault("attributes", [])
        wid = new_id()
        while self.wargame_path(wid).exists():
            wid = new_id()
        meta = wg.setdefault("meta", {})
        meta["created"] = now_iso()
        return self.save_wargame(wid, wg)

    def delete_wargame(self, wid: str):
        path = self.wargame_path(wid)
        if not path.exists():
            raise ApiError(404, "wargame not found")
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        with self.lock:
            target = self.trash / f"{wid}-{stamp}"
            target.mkdir(parents=True, exist_ok=True)
            shutil.move(str(path), str(target / "wargame.json"))
            media = self.media / wid
            if media.exists():
                shutil.move(str(media), str(target / "media"))

    def duplicate_wargame(self, wid: str):
        wg = self.get_wargame(wid)
        for lang in ("en", "de"):
            title = (wg.get("meta", {}).get("title") or {})
            if isinstance(title, dict) and title.get(lang):
                title[lang] = f"{title[lang]} ({'copy' if lang == 'en' else 'Kopie'})"
        copy = self.create_wargame(wg)
        src, dst = self.media / wid, self.media / copy["id"]
        if src.exists():
            shutil.copytree(src, dst, dirs_exist_ok=True)
        return copy

    # ---------- media ----------
    def media_dir(self, wid: str) -> Path:
        return self.media / self._check_id(wid)

    def save_media(self, wid: str, name: str, data_url: str) -> str:
        self.get_wargame(wid)  # 404 if missing
        mime, raw = decode_data_url(data_url)
        ext = IMAGE_EXT.get(mime)
        if not ext:
            raise ApiError(415, f"unsupported image type: {mime}")
        stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(name or "image").stem).strip("-")[:40] or "image"
        filename = f"{stem}-{new_id(6)}{ext}"
        d = self.media_dir(wid)
        d.mkdir(parents=True, exist_ok=True)
        (d / filename).write_bytes(raw)
        return filename

    def media_file(self, wid: str, filename: str) -> Path:
        if not FILE_RE.match(filename) or ".." in filename:
            raise ApiError(400, "invalid file name")
        path = self.media_dir(wid) / filename
        if not path.is_file():
            raise ApiError(404, "file not found")
        return path

    def list_media(self, wid: str):
        d = self.media_dir(wid)
        if not d.exists():
            return []
        return sorted(p.name for p in d.iterdir() if p.is_file())

    # ---------- export / import ----------
    def export_wargame(self, wid: str):
        wg = self.get_wargame(wid)
        text = json.dumps(wg, ensure_ascii=False)
        media = {}
        d = self.media_dir(wid)
        if d.exists():
            for p in d.iterdir():
                # only embed files that are referenced somewhere in the wargame
                if p.is_file() and p.name in text:
                    mime = MIME.get(p.suffix.lower(), "application/octet-stream")
                    media[p.name] = f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode("ascii")
        return {
            "format": "wargame-export",
            "version": 1,
            "exportedAt": now_iso(),
            "wargame": wg,
            "media": media,
        }

    def import_wargame(self, payload: dict):
        if not isinstance(payload, dict):
            raise ApiError(400, "invalid import file")
        if payload.get("format") == "wargame-export":
            wg, media = payload.get("wargame"), payload.get("media") or {}
        else:  # plain wargame JSON is accepted as well
            wg, media = payload, {}
        if not isinstance(wg, dict) or not isinstance(wg.get("pages"), list):
            raise ApiError(400, "file does not contain a wargame")
        created = self.create_wargame(wg)
        d = self.media_dir(created["id"])
        image_exts = set(IMAGE_EXT.values()) | {".jpeg"}
        for name, data_url in media.items():
            if not isinstance(name, str) or not FILE_RE.match(name) or ".." in name:
                continue
            if Path(name).suffix.lower() not in image_exts:
                continue  # only images, like regular uploads
            try:
                mime, raw = decode_data_url(data_url)
            except ApiError:
                continue
            if mime not in IMAGE_EXT:
                continue
            d.mkdir(parents=True, exist_ok=True)
            (d / name).write_bytes(raw)
        return created

    # ---------- runs (presentation sessions) ----------
    def run_path(self, rid: str) -> Path:
        return self.runs / f"{self._check_id(rid)}.json"

    def count_runs(self, wid: str) -> int:
        return sum(1 for r in self._iter_runs() if r.get("wargameId") == wid)

    def _iter_runs(self):
        for p in self.runs.glob("*.json"):
            try:
                yield self._read(p)
            except (OSError, json.JSONDecodeError):
                continue

    def list_runs(self, wid: str | None):
        out = []
        for r in self._iter_runs():
            if wid and r.get("wargameId") != wid:
                continue
            out.append({
                "runId": r.get("runId"),
                "wargameId": r.get("wargameId"),
                "title": ((r.get("wargame") or {}).get("meta") or {}).get("title"),
                "started": r.get("started"),
                "updated": r.get("updated"),
                "finished": r.get("finished", False),
                "decisionCount": len(r.get("decisions") or []),
            })
        out.sort(key=lambda r: r.get("updated") or "", reverse=True)
        return out

    def get_run(self, rid: str):
        path = self.run_path(rid)
        if not path.exists():
            raise ApiError(404, "session not found")
        return self._read(path)

    def save_run(self, rid: str, run: dict):
        if not isinstance(run, dict):
            raise ApiError(400, "invalid session")
        with self.lock:
            run["runId"] = rid
            run["updated"] = now_iso()
            self._write(self.run_path(rid), run)
        return {"ok": True, "updated": run["updated"]}

    def delete_run(self, rid: str):
        path = self.run_path(rid)
        if path.exists():
            path.unlink()

    # ---------- first start ----------
    def seed_samples(self):
        marker = self.root / ".seeded"
        if marker.exists() or not SAMPLES.exists():
            return
        for p in sorted(SAMPLES.glob("*.json")):
            try:
                self.import_wargame(self._read(p))
                print(f"  imported sample: {p.name}")
            except (OSError, json.JSONDecodeError, ApiError) as e:
                print(f"  could not import sample {p.name}: {e}")
        marker.write_text(now_iso(), encoding="utf-8")


def host_name(value: str) -> str:
    """Host header value without the port, lower case ("[::1]:8765" -> "::1")."""
    value = value.strip().lower()
    if value.startswith("["):
        return value[1:value.find("]")] if "]" in value else value
    if value.count(":") == 1:
        return value.split(":", 1)[0]
    return value


def host_allowed(value: str, extra: set[str]) -> bool:
    """Accept localhost, IP addresses and names given with --allow-host.

    DNS rebinding needs a domain name that the attacker controls, so refusing
    every other name in the Host header stops it."""
    name = host_name(value)
    if name == "localhost" or name in extra:
        return True
    try:
        ipaddress.ip_address(name)
        return True
    except ValueError:
        return False


def decode_data_url(data_url: str):
    m = re.match(r"^data:([\w.+/-]+)?(;[^,]*)?,(.*)$", data_url or "", re.S)
    if not m:
        raise ApiError(400, "invalid data URL")
    mime = (m.group(1) or "application/octet-stream").lower()
    params, body = m.group(2) or "", m.group(3)
    try:
        raw = base64.b64decode(body) if ";base64" in params else unquote(body).encode("utf-8")
    except (binascii.Error, ValueError):
        raise ApiError(400, "invalid base64 data")
    return mime, raw


class Handler(BaseHTTPRequestHandler):
    server_version = "WargamePresenter/1.0"
    store: Store = None  # set in main()
    allowed_hosts: set[str] = set()  # extra host names from --allow-host

    # ---------- plumbing ----------
    def log_request(self, code="-", size="-"):  # only log failed requests
        try:
            status = int(code)
        except (TypeError, ValueError):
            status = 0
        if status >= 400:
            sys.stderr.write(f"  {self.command} {self.path} -> {status}\n")

    def log_message(self, fmt, *args):
        sys.stderr.write("  " + (fmt % args) + "\n")

    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200, extra: dict | None = None):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(status, body, MIME[".json"], extra)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "request too large")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "invalid JSON")

    def _file(self, path: Path):
        ctype = MIME.get(path.suffix.lower(), "application/octet-stream")
        self._send(200, path.read_bytes(), ctype)

    def _check_request(self, method: str):
        """Block requests that a web page in the same browser could forge."""
        host = self.headers.get("Host")
        if host is not None and not host_allowed(host, self.allowed_hosts):
            raise ApiError(403, "host not allowed")
        if method in ("GET", "HEAD"):
            return
        # Browsers send Origin on cross-origin writes; it must be this server.
        origin = self.headers.get("Origin")
        if origin is not None and urlparse(origin).netloc.lower() != (host or "").strip().lower():
            raise ApiError(403, "cross-origin request rejected")
        # application/json is not a CORS "simple" content type, so a foreign
        # page has to send a preflight first, and OPTIONS is not supported.
        if method in ("POST", "PUT"):
            ctype = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if ctype != "application/json":
                raise ApiError(415, "expected Content-Type: application/json")

    def _dispatch(self, method: str):
        url = urlparse(self.path)
        path = unquote(url.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            self._check_request(method)
            if path.startswith("/api/"):
                return self._api(method, path[5:].strip("/").split("/"), query)
            if method in ("GET", "HEAD"):
                if path.startswith("/media/"):
                    parts = path[7:].split("/")
                    if len(parts) == 2:
                        return self._file(self.store.media_file(parts[0], parts[1]))
                    raise ApiError(404, "not found")
                return self._static(path)
            raise ApiError(405, "method not allowed")
        except ApiError as e:
            self._json({"error": e.message}, e.status)
        except (ConnectionAbortedError, BrokenPipeError):
            pass
        except Exception as e:  # pragma: no cover - last resort
            sys.stderr.write(f"  ERROR {method} {path}: {e!r}\n")
            try:
                self._json({"error": "internal error"}, 500)
            except OSError:
                pass

    def _static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if STATIC.resolve() not in target.parents and target != STATIC.resolve():
            raise ApiError(403, "forbidden")
        if not target.is_file():
            raise ApiError(404, "not found")
        self._file(target)

    # ---------- API routes ----------
    def _api(self, method: str, parts: list[str], query: dict):
        s = self.store
        head = parts[0] if parts else ""
        n = len(parts)

        if head == "wargames":
            if n == 1 and method == "GET":
                return self._json(s.list_wargames())
            if n == 1 and method == "POST":
                return self._json(s.create_wargame(self._body()), 201)
            wid = parts[1] if n > 1 else ""
            if n == 2 and method == "GET":
                return self._json(s.get_wargame(wid))
            if n == 2 and method == "PUT":
                wg = s.save_wargame(wid, self._body())
                return self._json({"ok": True, "updated": wg["meta"]["updated"]})
            if n == 2 and method == "DELETE":
                s.delete_wargame(wid)
                return self._json({"ok": True})
            if n == 3 and parts[2] == "duplicate" and method == "POST":
                return self._json(s.duplicate_wargame(wid), 201)
            if n == 3 and parts[2] == "export" and method == "GET":
                data = s.export_wargame(wid)
                title = ((data["wargame"].get("meta") or {}).get("title") or {})
                name = (title.get("en") or title.get("de") or "wargame") if isinstance(title, dict) else "wargame"
                slug = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()[:50] or "wargame"
                return self._json(data, extra={
                    "Content-Disposition": f'attachment; filename="{slug}.wargame.json"'})
            if n == 3 and parts[2] == "media":
                if method == "GET":
                    return self._json(s.list_media(wid))
                if method == "POST":
                    body = self._body() or {}
                    filename = s.save_media(wid, body.get("name", "image"), body.get("data", ""))
                    return self._json({"file": filename, "url": f"/media/{wid}/{filename}"}, 201)

        if head == "import" and method == "POST":
            return self._json(s.import_wargame(self._body()), 201)

        if head == "runs":
            if n == 1 and method == "GET":
                return self._json(s.list_runs(query.get("wargame")))
            rid = parts[1] if n > 1 else ""
            if n == 2 and method == "GET":
                return self._json(s.get_run(rid))
            if n == 2 and method == "PUT":
                return self._json(s.save_run(rid, self._body()))
            if n == 2 and method == "DELETE":
                s.delete_run(rid)
                return self._json({"ok": True})

        if head == "health":
            return self._json({"ok": True, "time": now_iso()})

        raise ApiError(404, "unknown endpoint")

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")


def main():
    ap = argparse.ArgumentParser(description="Wargame Presenter - local web server")
    ap.add_argument("--host", default="127.0.0.1",
                    help="interface to bind (default 127.0.0.1 = this computer only)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data", default=str(ROOT / "data"), help="data folder (default ./data)")
    ap.add_argument("--no-browser", action="store_true", help="do not open the browser")
    ap.add_argument("--allow-host", action="append", default=[], metavar="NAME",
                    help="also accept this host name in requests, e.g. the laptop's name "
                         "when using --host 0.0.0.0 (localhost and IP addresses always work)")
    args = ap.parse_args()

    store = Store(Path(args.data).resolve())
    store.seed_samples()
    Handler.store = store
    Handler.allowed_hosts = {host_name(h) for h in args.allow_host if h.strip()}
    if args.host not in ("0.0.0.0", "::", ""):
        Handler.allowed_hosts.add(host_name(args.host))

    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        print(f"Cannot start on {args.host}:{args.port} ({e}). Try another port with --port.")
        sys.exit(1)
    httpd.daemon_threads = True

    shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "") else args.host
    url = f"http://{shown_host}:{args.port}/"
    print("\n  Wargame Presenter")
    print(f"  running at  {url}")
    print(f"  data folder {store.root}")
    print("  stop with   Ctrl+C\n")

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
