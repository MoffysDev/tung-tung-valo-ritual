"""Game content (agents, weapons, skins, maps, ranks) from valorant-api.com, cached on disk."""
from __future__ import annotations

import json
import logging
import os
import threading
import time

import requests

log = logging.getLogger(__name__)

API = "https://valorant-api.com/v1"
LANGUAGE = "fr-FR"
MAX_AGE = 12 * 3600
CACHE_FORMAT = 6
# Non-playable agent variants get their own name so they are never confused with the real agent.
SPECIAL_AGENTS = {"773f0c78-4486-752b-68ef-4585d7f4b848": "Robot Ability Draft"}


def _get(path: str, params: dict | None = None):
    res = requests.get(f"{API}{path}", params={"language": LANGUAGE, **(params or {})}, timeout=20)
    res.raise_for_status()
    return res.json()["data"]


def _skin_icon(skin: dict) -> str | None:
    levels = skin.get("levels") or [{}]
    chromas = skin.get("chromas") or [{}]
    return skin.get("displayIcon") or levels[0].get("displayIcon") or chromas[0].get("fullRender")


def build_content() -> dict:
    """Download and trim everything the tracker needs."""
    content_tiers = {
        t["uuid"].lower(): {"color": "#" + (t.get("highlightColor") or "ffffff33")[:6], "icon": t.get("displayIcon"), "rank": t.get("rank", 0)}
        for t in _get("/contenttiers")
    }

    agents = {}
    # Non-playable variants exist too (e.g. the KAY/O used in Ability Draft): keep them, playable ones win.
    for a in sorted(_get("/agents"), key=lambda x: not x.get("isPlayableCharacter")):
        colors = a.get("backgroundGradientColors") or []
        playable = a.get("isPlayableCharacter")
        agents.setdefault(a["uuid"].lower(), {
            "name": a["displayName"] if playable else SPECIAL_AGENTS.get(a["uuid"].lower(), "Agent spécial"),
            "icon": a.get("displayIconSmall") or a.get("displayIcon"),
            "portrait": a.get("fullPortrait") or a.get("displayIcon"),
            "role": (a.get("role") or {}).get("displayName") if playable else "Mode spécial",
            "color": "#" + colors[0][:6] if colors else None,
        })

    weapons, skin_index = {}, {}
    for w in _get("/weapons"):
        wid = w["uuid"].lower()
        skins = {}
        for s in w.get("skins", []):
            sid = s["uuid"].lower()
            tier = content_tiers.get((s.get("contentTierUuid") or "").lower())
            chromas = {
                c["uuid"].lower(): {"name": c["displayName"], "icon": c.get("fullRender") or c.get("displayIcon")}
                for c in s.get("chromas", [])
            }
            skins[sid] = {
                "name": s["displayName"],
                "icon": _skin_icon(s),
                "tier": tier["color"] if tier else None,
                "chromas": chromas,
            }
            skin_index[sid] = wid
        stats = w.get("weaponStats") or {}
        weapons[wid] = {
            "name": w["displayName"],
            "category": (w.get("category") or "").split("::")[-1],
            "icon": w.get("displayIcon"),
            "kill_icon": w.get("killStreamIcon"),
            "cost": (w.get("shopData") or {}).get("cost", 0),
            "fire_rate": stats.get("fireRate"),
            "skins": skins,
        }

    maps = {}
    for m in _get("/maps"):
        if not m.get("mapUrl"):
            continue
        maps[m["mapUrl"]] = {
            "name": m["displayName"],
            "splash": m.get("splash"),
            "list_icon": m.get("listViewIcon"),
            "tall_icon": m.get("listViewIconTall"),
        }

    tiers = {}
    tier_sets = _get("/competitivetiers")
    if tier_sets:
        for t in tier_sets[-1]["tiers"]:
            name = t.get("tierName") or ""
            if "UNUSED" in (t.get("divisionName") or "") or name.upper().startswith("UNUSED"):
                continue
            tiers[str(t["tier"])] = {
                "name": name.title() if name.isupper() else name,
                "icon": t.get("largeIcon"),
                "small": t.get("smallIcon"),
                "color": "#" + (t.get("color") or "ffffffff")[:6],
            }

    titles = {t["uuid"].lower(): t.get("titleText") for t in _get("/playertitles") if t.get("titleText")}

    version = None
    try:
        version = _get("/version").get("riotClientVersion")
    except (requests.RequestException, KeyError, ValueError):
        pass

    return {
        "format": CACHE_FORMAT,
        "fetched": time.time(),
        "language": LANGUAGE,
        "version": version,
        "agents": agents,
        "weapons": weapons,
        "maps": maps,
        "tiers": tiers,
        "titles": titles,
        "skin_index": skin_index,
    }


class StaticData:
    """Loads the cache instantly, refreshes it in the background when stale."""

    def __init__(self, cache_path: str):
        self.cache_path = cache_path
        self.data: dict = {}
        self.etag = "0"
        self._lock = threading.Lock()
        self._ready = threading.Event()
        self._load_cache()

    @property
    def ready(self) -> bool:
        return bool(self.data.get("weapons"))

    def wait_ready(self, timeout: float | None = None) -> bool:
        return self._ready.wait(timeout)

    def _set(self, data: dict) -> None:
        with self._lock:
            self.data = data
            self.etag = str(int(data.get("fetched", 0)))
        if data.get("weapons"):
            self._ready.set()

    def _load_cache(self) -> None:
        try:
            with open(self.cache_path, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("format") == CACHE_FORMAT:
                self._set(data)
        except (OSError, ValueError):
            pass

    def is_stale(self) -> bool:
        return not self.ready or time.time() - self.data.get("fetched", 0) > MAX_AGE

    def refresh(self) -> bool:
        try:
            data = build_content()
        except (requests.RequestException, KeyError, ValueError, TypeError) as exc:
            log.warning("valorant-api.com indisponible (%s), utilisation du cache", exc)
            return False
        self._set(data)
        tmp = self.cache_path + ".tmp"
        try:
            os.makedirs(os.path.dirname(self.cache_path) or ".", exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, self.cache_path)
        except OSError as exc:
            log.warning("Impossible d'écrire le cache statique: %s", exc)
        log.info("Contenu du jeu mis à jour (%d agents, %d armes)", len(data["agents"]), len(data["weapons"]))
        return True

    # Helpers used by the parser/worker
    @property
    def weapon_ids(self) -> set[str]:
        return set(self.data.get("weapons", {}))

    @property
    def skin_ids(self) -> set[str]:
        return set(self.data.get("skin_index", {}))

    @property
    def version(self) -> str | None:
        return self.data.get("version")

    def public(self) -> dict:
        """Payload served to the browser."""
        with self._lock:
            return {k: v for k, v in self.data.items() if k not in ("skin_index", "format")}
