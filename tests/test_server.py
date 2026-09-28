import gzip
import json
import os

import pytest

from tracker.server import create_app
from tracker.storage import Store
from tracker.worker import Tracker
from tests.test_worker import FakeRiot, FakeStatic

STATIC = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")


class ServedStatic(FakeStatic):
    etag = "42"

    def public(self):
        return {"agents": {"a": {"name": "X" * 5000}}}


@pytest.fixture
def client(tmp_path):
    store = Store(str(tmp_path / "db"))
    store.data["matches"]["m"] = {"id": "m", "v": 2}
    tracker = Tracker(store, ServedStatic(), FakeRiot())
    return create_app(tracker, STATIC).test_client()


def test_rejects_foreign_host(client):
    assert client.get("/api/state", headers={"Host": "evil.example:5000"}).status_code == 403
    assert client.get("/api/state", headers={"Host": "127.0.0.1:5000"}).status_code == 200


def test_post_requires_custom_header(client):
    assert client.post("/api/sync").status_code == 403
    client.get("/")  # loading our own page grants the session used by mutating calls
    assert client.post("/api/sync").status_code == 200


def test_matches_etag_and_no_cors(client):
    res = client.get("/api/matches")
    assert res.status_code == 200 and "Access-Control-Allow-Origin" not in res.headers
    etag = res.headers["ETag"].strip('"')
    assert json.loads(res.data)["version"] == etag
    assert client.get("/api/matches", headers={"If-None-Match": f'"{etag}"'}).status_code == 304
    state = json.loads(client.get("/api/state").data)
    assert state["matches_version"] == etag


def test_content_is_gzipped(client):
    res = client.get("/api/content", headers={"Accept-Encoding": "gzip"})
    assert res.headers["Content-Encoding"] == "gzip"
    assert json.loads(gzip.decompress(res.data))["agents"]["a"]["name"].startswith("X")


def test_index_and_static_served(client):
    assert b"Tung Tung Tracker" in client.get("/").data
    assert client.get("/static/js/main.js").status_code == 200
    assert client.get("/static/../app.py").status_code == 404


def test_overlay_page_and_hooks(tmp_path):
    calls = []
    store = Store(str(tmp_path / "db"))
    app = create_app(Tracker(store, ServedStatic(), FakeRiot()), STATIC,
                     {"show": lambda: calls.append("show"), "overlay_hide": lambda: calls.append("hide")})
    client = app.test_client()
    assert b"Tung Tung Overlay" in client.get("/overlay").data
    assert client.post("/api/show").status_code == 200  # session from the /overlay load above
    assert client.post("/api/overlay/hide").status_code == 200
    assert calls == ["show", "hide"]


def test_show_requires_ipc_token(tmp_path):
    """The desktop app's self-wake call has no session, so it must present the random IPC token."""
    store = Store(str(tmp_path / "db"))
    app = create_app(Tracker(store, ServedStatic(), FakeRiot()), STATIC)
    client = app.test_client()
    assert client.post("/api/show").status_code == 403
    token = app.config["IPC_SECRET"]
    assert client.post("/api/show", headers={"X-Tracker": token}).status_code == 200
