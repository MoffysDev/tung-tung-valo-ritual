"""Read-only client for the local Riot Client API and Valorant's remote endpoints.

Every call is a GET, except ``name-service`` which Riot exposes as a PUT that only
*reads* display names (it's what the game client itself does).
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from dataclasses import dataclass

import requests
import urllib3

from .constants import CLIENT_PLATFORM, REGIONS

log = logging.getLogger(__name__)

# The local Riot Client uses a self-signed certificate bound to 127.0.0.1.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

LOCAL_TIMEOUT = 3
REMOTE_TIMEOUT = 10
TOKEN_TTL = 300
VERSION_RE = re.compile(r"^release-\d+\.\d+-shipping-\d+-\d+$")


class RiotError(Exception):
    """A Riot request failed."""


class NotRunning(RiotError):
    """The Riot Client is closed or not logged in."""


class RateLimited(RiotError):
    def __init__(self, retry_after: float):
        super().__init__(f"Limite de requêtes Riot atteinte, nouvel essai dans {int(retry_after)} s")
        self.retry_after = retry_after


@dataclass(frozen=True)
class Lockfile:
    name: str
    pid: str
    port: int
    password: str
    protocol: str

    @classmethod
    def parse(cls, text: str) -> "Lockfile":
        parts = text.strip().split(":")
        if len(parts) < 5:
            raise NotRunning("lockfile invalide")
        return cls(parts[0], parts[1], int(parts[2]), parts[3], parts[4])

    @property
    def base_url(self) -> str:
        return f"{self.protocol}://127.0.0.1:{self.port}"


def default_lockfile_path() -> str | None:
    base = os.getenv("LOCALAPPDATA")
    return os.path.join(base, "Riot Games", "Riot Client", "Config", "lockfile") if base else None


def resolve_region(region: str) -> tuple[str, str]:
    """Return (glz_region, shard) for a Riot region string."""
    region = (region or "").lower()
    if region in REGIONS:
        return REGIONS[region]
    for key, value in REGIONS.items():
        if key in region:
            return value
    return region, region


def decode_presence(private: str | None) -> dict:
    """Decode the base64 JSON blob of a Valorant chat presence."""
    if not private:
        return {}
    try:
        return json.loads(base64.b64decode(private + "=" * (-len(private) % 4)).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def presence_phase(presence: dict) -> str | None:
    """Return MENUS / PREGAME / INGAME from a decoded presence (old and new formats)."""
    match = presence.get("matchPresenceData") or {}
    phase = match.get("sessionLoopState") or presence.get("sessionLoopState")
    return phase.upper() if isinstance(phase, str) and phase else None


def presence_party(presence: dict) -> str | None:
    party = presence.get("partyPresenceData") or {}
    return party.get("partyId") or presence.get("partyId") or None


class RiotClient:
    def __init__(self, lockfile_path: str | None = None):
        self.lockfile_path = lockfile_path or default_lockfile_path()
        self.fallback_version: str | None = None
        self._lockfile_mtime: float | None = None
        self._lock: Lockfile | None = None
        self.local = requests.Session()
        self.local.verify = False
        self.remote = requests.Session()
        self._reset()

    # ------------------------------------------------------------------ session
    def _reset(self) -> None:
        self.puuid: str | None = None
        self.access_token: str | None = None
        self.entitlement: str | None = None
        self.token_time = 0.0
        self.region: str | None = None
        self.glz_region: str | None = None
        self.shard: str | None = None
        self.version: str | None = None
        self.rate_limited_until = 0.0

    @property
    def connected(self) -> bool:
        return self._lock is not None and self.access_token is not None

    def connect(self) -> bool:
        """Make sure we have a live session. Returns False when the Riot Client isn't running."""
        path = self.lockfile_path
        if not path or not os.path.exists(path):
            self._disconnect()
            return False
        try:
            mtime = os.path.getmtime(path)
            if mtime != self._lockfile_mtime or self._lock is None:
                self._reset()
                with open(path, encoding="utf-8") as f:
                    self._lock = Lockfile.parse(f.read())
                self._lockfile_mtime = mtime
                auth = base64.b64encode(f"riot:{self._lock.password}".encode()).decode()
                self.local.headers["Authorization"] = f"Basic {auth}"
            if not self.access_token or time.time() - self.token_time > TOKEN_TTL:
                self._refresh_tokens()
            if not self.shard:
                self._detect_region()
            return True
        except (OSError, NotRunning, ValueError) as exc:
            log.debug("Riot Client unavailable: %s", exc)
            self._disconnect()
            return False

    def _disconnect(self) -> None:
        self._lock = None
        self._lockfile_mtime = None
        self._reset()

    def _refresh_tokens(self) -> None:
        data = self.local_get("/entitlements/v1/token")
        if not data or not data.get("accessToken") or not data.get("subject"):
            raise NotRunning("pas de session Riot active")
        self.access_token = data["accessToken"]
        self.entitlement = data.get("token")
        self.puuid = data["subject"].lower()
        self.token_time = time.time()

    def _detect_region(self) -> None:
        region = None
        # 1. Valorant launch arguments (only present while the game runs)
        try:
            sessions = self.local_get("/product-session/v1/external-sessions") or {}
            for session in sessions.values():
                if not isinstance(session, dict) or session.get("productId") != "valorant":
                    continue
                for arg in (session.get("launchConfiguration") or {}).get("arguments") or []:
                    if isinstance(arg, str) and arg.startswith("-ares-deployment="):
                        region = arg.split("=", 1)[1]
                version = session.get("version")
                if isinstance(version, str) and VERSION_RE.match(version):
                    self.version = version
        except RiotError:
            pass
        # 2. Riot Client locale
        if not region:
            data = self.local_get("/riotclient/region-locale") or {}
            region = data.get("region") or "eu"
        self.region = region.lower()
        self.glz_region, self.shard = resolve_region(self.region)

    # ------------------------------------------------------------------ http
    def local_get(self, path: str):
        if not self._lock:
            raise NotRunning("Riot Client fermé")
        try:
            res = self.local.get(f"{self._lock.base_url}{path}", timeout=LOCAL_TIMEOUT)
        except requests.RequestException as exc:
            raise NotRunning(str(exc)) from exc
        if res.status_code == 404:
            return None
        if res.status_code != 200:
            raise RiotError(f"API locale {path}: HTTP {res.status_code}")
        try:
            return res.json()
        except ValueError:
            return None

    def _headers(self) -> dict:
        headers = {
            "Authorization": f"Bearer {self.access_token}",
            "X-Riot-Entitlements-JWT": self.entitlement or "",
            "X-Riot-ClientPlatform": CLIENT_PLATFORM,
        }
        version = self.version or self.fallback_version
        if version:
            headers["X-Riot-ClientVersion"] = version
        return headers

    def _remote(self, method: str, url: str, **kwargs):
        wait = self.rate_limited_until - time.time()
        if wait > 0:
            raise RateLimited(wait)
        for attempt in range(2):
            try:
                res = self.remote.request(method, url, headers=self._headers(), timeout=REMOTE_TIMEOUT, **kwargs)
            except requests.RequestException as exc:
                raise RiotError(f"Réseau indisponible ({exc.__class__.__name__})") from exc
            if res.status_code in (400, 401, 403) and attempt == 0:
                # Expired token: re-read entitlements once and retry.
                self._refresh_tokens()
                continue
            if res.status_code == 429:
                retry = float(res.headers.get("Retry-After") or 30)
                self.rate_limited_until = time.time() + min(max(retry, 5), 120)
                raise RateLimited(retry)
            if res.status_code == 404:
                return None
            if res.status_code >= 400:
                raise RiotError(f"{url.split('.net', 1)[-1].split('?')[0]}: HTTP {res.status_code}")
            try:
                return res.json()
            except ValueError:
                return None
        return None

    def pd(self, path: str) -> str:
        return f"https://pd.{self.shard}.a.pvp.net{path}"

    def glz(self, path: str) -> str:
        return f"https://glz-{self.glz_region}-1.{self.shard}.a.pvp.net{path}"

    def shared(self, path: str) -> str:
        return f"https://shared.{self.shard}.a.pvp.net{path}"

    # ------------------------------------------------------------------ local endpoints
    def own_name(self) -> tuple[str, str] | None:
        data = self.local_get("/chat/v1/session") or {}
        if data.get("game_name"):
            return data["game_name"], data.get("game_tag", "")
        return None

    def presences(self) -> list[dict]:
        data = self.local_get("/chat/v4/presences") or {}
        return [p for p in data.get("presences", []) if p.get("product") == "valorant"]

    # ------------------------------------------------------------------ remote endpoints
    def loadout(self):
        # Riot moved the loadout to v3 in 2026; keep v2 as a fallback for older deployments.
        for version in ("v3", "v2"):
            data = self._remote("GET", self.pd(f"/personalization/{version}/players/{self.puuid}/playerloadout"))
            if data:
                return data
        return None

    def account_xp(self):
        return self._remote("GET", self.pd(f"/account-xp/v1/players/{self.puuid}"))

    def mmr(self, puuid: str):
        return self._remote("GET", self.pd(f"/mmr/v1/players/{puuid}"))

    def competitive_updates(self, count: int = 20):
        return self._remote(
            "GET", self.pd(f"/mmr/v1/players/{self.puuid}/competitiveupdates?startIndex=0&endIndex={count}&queue=competitive")
        )

    def match_history(self, start: int = 0, end: int = 20):
        return self._remote("GET", self.pd(f"/match-history/v1/history/{self.puuid}?startIndex={start}&endIndex={end}"))

    def match_details(self, match_id: str):
        return self._remote("GET", self.pd(f"/match-details/v1/matches/{match_id}"))

    def names(self, puuids: list[str]) -> list[dict]:
        if not puuids:
            return []
        return self._remote("PUT", self.pd("/name-service/v2/players"), json=puuids) or []

    def content(self):
        return self._remote("GET", self.shared("/content-service/v3/content"))

    def pregame_player(self):
        return self._remote("GET", self.glz(f"/pregame/v1/players/{self.puuid}"))

    def pregame_match(self, match_id: str):
        return self._remote("GET", self.glz(f"/pregame/v1/matches/{match_id}"))

    def pregame_loadouts(self, match_id: str):
        return self._remote("GET", self.glz(f"/pregame/v1/matches/{match_id}/loadouts"))

    def coregame_player(self):
        return self._remote("GET", self.glz(f"/core-game/v1/players/{self.puuid}"))

    def coregame_match(self, match_id: str):
        return self._remote("GET", self.glz(f"/core-game/v1/matches/{match_id}"))

    def coregame_loadouts(self, match_id: str):
        return self._remote("GET", self.glz(f"/core-game/v1/matches/{match_id}/loadouts"))
