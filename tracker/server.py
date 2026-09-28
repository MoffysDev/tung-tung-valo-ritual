"""Local HTTP API + static frontend."""
from __future__ import annotations

import gzip
import json
import os
import uuid

from flask import Flask, Response, abort, request, send_from_directory

from . import __version__
from .worker import Tracker

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]"}


def create_app(tracker: Tracker, static_dir: str, hooks: dict | None = None) -> Flask:
    """``hooks`` lets the desktop shell react to the page: {"show": fn, "overlay_hide": fn}."""
    hooks = hooks if hooks is not None else {}
    app = Flask(__name__, static_folder=None)
    # Version counters restart at 0 with the process: prefix ETags so browser caches never collide.
    boot = uuid.uuid4().hex[:8]

    gzip_cache: dict[str, tuple[str, bytes]] = {}

    def json_response(payload, etag: str | None = None, cache: bool = False) -> Response:
        if etag and request.if_none_match.contains(etag):
            return Response(status=304, headers={"ETag": f'"{etag}"'})
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers = {"Vary": "Accept-Encoding"}
        if len(body) > 4096 and "gzip" in request.headers.get("Accept-Encoding", ""):
            cached = gzip_cache.get(request.path)  # latest (etag, bytes) per endpoint
            if etag and cached and cached[0] == etag:
                compressed = cached[1]
            else:
                compressed = gzip.compress(body, compresslevel=5)
                if etag:
                    gzip_cache[request.path] = (etag, compressed)
            body = compressed
            headers["Content-Encoding"] = "gzip"
        res = Response(body, mimetype="application/json", headers=headers)
        if etag:
            res.set_etag(etag)
        res.headers["Cache-Control"] = "no-cache" if cache else "no-store"
        return res

    @app.before_request
    def guard():
        # Block DNS-rebinding: only answer requests addressed to localhost.
        host = (request.host or "").rsplit(":", 1)[0]
        if host not in ALLOWED_HOSTS:
            abort(403)
        # Mutating endpoints must come from our own page.
        if request.method == "POST" and request.headers.get("X-Tracker") != "1":
            abort(403)

    @app.after_request
    def security_headers(res: Response):
        res.headers["X-Content-Type-Options"] = "nosniff"
        res.headers["X-Frame-Options"] = "DENY"
        res.headers["Referrer-Policy"] = "no-referrer"
        return res

    @app.get("/")
    def index():
        return send_from_directory(static_dir, "index.html")

    @app.get("/overlay")
    def overlay():
        return send_from_directory(static_dir, "overlay.html")

    @app.get("/static/<path:path>")
    def static_files(path: str):
        res = send_from_directory(static_dir, path)
        res.headers["Cache-Control"] = "no-cache"
        return res

    @app.get("/api/state")
    def state():
        payload = tracker.snapshot()
        payload["app_version"] = __version__
        payload["matches_version"] = f"{boot}-{payload['matches_version']}"
        return json_response(payload)

    @app.get("/api/matches")
    def matches():
        store = tracker.store
        with store.lock:
            version = f"{boot}-{store.matches_version}"
            if request.if_none_match.contains(version):
                return Response(status=304, headers={"ETag": f'"{version}"'})
            payload = {
                "matches": list(store.data["matches"].values()),
                "legacy": store.data["legacy"],
                # Names/ranks of players seen in live games (never players in streamer mode)
                "players": store.data["known_players"],
                "version": version,
            }
        return json_response(payload, etag=version, cache=True)

    @app.get("/api/content")
    def content():
        static = tracker.static
        if not static.ready:
            return json_response({"error": "Contenu du jeu en cours de téléchargement"}), 503
        return json_response(static.public(), etag=static.etag, cache=True)

    @app.post("/api/sync")
    def sync():
        tracker.request_sync()
        return json_response({"ok": True})

    @app.post("/api/show")
    def show():
        """Used by a second launch of the exe to bring the running window to the front."""
        hooks.get("show", lambda: None)()
        return json_response({"ok": True})

    @app.post("/api/overlay/hide")
    def overlay_hide():
        hooks.get("overlay_hide", lambda: None)()
        return json_response({"ok": True})

    @app.post("/api/backfill")
    def backfill():
        tracker.request_backfill(100)
        return json_response({"ok": True})

    @app.get("/favicon.ico")
    def favicon():
        return send_from_directory(os.path.join(static_dir, "img"), "favicon.svg", mimetype="image/svg+xml")

    return app
