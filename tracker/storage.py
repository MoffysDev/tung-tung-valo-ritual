"""Local JSON database: one file per collection, atomic writes, automatic migrations."""
from __future__ import annotations

import json
import logging
import os
import shutil
import threading
import time

log = logging.getLogger(__name__)

SCHEMA = 2
MAX_SNAPSHOTS = 300

COLLECTIONS = {
    "meta": dict,             # schema, skipped match ids, backfill cursor
    "matches": dict,          # match_id -> match record (source of truth for every stat)
    "profile": dict,          # last known player profile (offline mode)
    "known_players": dict,    # puuid -> {name, rank_id, seen}
    "locked_loadouts": dict,  # match_id -> {weapon_id: skin_id} captured while the match was live
    "loadout_history": list,  # [{ts, guns: {weapon_id: {skin, chroma}}}]
    "legacy": dict,           # aggregates from v1 that can't be rebuilt per match
}

# v1 files that are replaced by computed stats
V1_ONLY = ("processed_matches", "agents", "skins", "player_stats")


class Store:
    def __init__(self, directory: str):
        self.dir = directory
        self.owner: str | None = None  # puuid of the account this database belongs to
        self.lock = threading.RLock()
        self.data: dict = {name: factory() for name, factory in COLLECTIONS.items()}
        self._dirty: set[str] = set()
        self.matches_version = 0
        os.makedirs(directory, exist_ok=True)
        self._load()
        self._migrate()

    # ------------------------------------------------------------------ io
    def _path(self, name: str) -> str:
        return os.path.join(self.dir, f"{name}.json")

    def _read(self, name: str):
        path = self._path(name)
        if not os.path.exists(path):
            return None
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError) as exc:
            # Never silently drop a corrupted file: keep a copy for manual recovery.
            backup = f"{path}.corrupt-{int(time.time())}"
            log.error("Fichier %s illisible (%s), copie dans %s", path, exc, backup)
            shutil.copyfile(path, backup)
            return None

    def _load(self) -> None:
        for name, factory in COLLECTIONS.items():
            value = self._read(name)
            if isinstance(value, factory):
                self.data[name] = value

    def mark(self, *names: str) -> None:
        with self.lock:
            self._dirty.update(names)
            if "matches" in names:
                self.matches_version += 1

    def save(self) -> None:
        with self.lock:
            dirty, self._dirty = self._dirty, set()
            payloads = {name: json.dumps(self.data[name], ensure_ascii=False, separators=(",", ":")) for name in dirty}
        for name, payload in payloads.items():
            tmp = self._path(name) + ".tmp"
            try:
                with open(tmp, "w", encoding="utf-8") as f:
                    f.write(payload)
                os.replace(tmp, self._path(name))
            except OSError as exc:
                log.error("Sauvegarde de %s impossible: %s", name, exc)
                with self.lock:
                    self._dirty.add(name)

    # ------------------------------------------------------------------ migrations
    def _migrate(self) -> None:
        meta = self.data["meta"]
        if meta.get("schema") == SCHEMA:
            return
        legacy_single = os.path.join(os.path.dirname(os.path.abspath(self.dir)), "database.json")
        old = {name: self._read(name) for name in V1_ONLY}
        if not any(v is not None for v in old.values()) and os.path.exists(legacy_single):
            try:
                with open(legacy_single, encoding="utf-8") as f:
                    single = json.load(f)
                old = {name: single.get(name) for name in V1_ONLY}
                for name in ("matches", "known_players", "locked_loadouts"):
                    if isinstance(single.get(name), dict) and not self.data[name]:
                        self.data[name] = single[name]
                os.replace(legacy_single, legacy_single + ".bak")
            except (OSError, ValueError) as exc:
                log.error("Migration de database.json impossible: %s", exc)

        if any(v is not None for v in old.values()) or self.data["matches"]:
            log.info("Migration de la base vers le schéma v%d", SCHEMA)
            migrate_v1(self.data, old)
            backup = os.path.join(self.dir, f"backup-v1-{int(time.time())}")
            for name in V1_ONLY:
                if os.path.exists(self._path(name)):
                    os.makedirs(backup, exist_ok=True)
                    shutil.move(self._path(name), os.path.join(backup, f"{name}.json"))

        meta["schema"] = SCHEMA
        self.mark(*COLLECTIONS)
        self.save()

    # ------------------------------------------------------------------ helpers
    def processed_ids(self) -> set[str]:
        return set(self.data["matches"]) | set(self.data["meta"].get("skipped", []))

    def add_skipped(self, match_id: str) -> None:
        skipped = self.data["meta"].setdefault("skipped", [])
        if match_id not in skipped:
            skipped.append(match_id)
            self.mark("meta")

    def add_snapshot(self, guns: dict, ts: float | None = None) -> bool:
        """Record the equipped loadout if it changed. Returns True when a snapshot was added."""
        history = self.data["loadout_history"]
        if history and history[-1]["guns"] == guns:
            return False
        history.append({"ts": int((ts or time.time()) * 1000), "guns": guns})
        del history[:-MAX_SNAPSHOTS]
        self.mark("loadout_history")
        return True

    def loadout_at(self, ts_ms: int) -> tuple[dict | None, str]:
        """Best known loadout at a given time -> (weapon->skin map, source)."""
        history = self.data["loadout_history"]
        before = [s for s in history if s["ts"] <= ts_ms]
        if before:
            return {w: g["skin"] for w, g in before[-1]["guns"].items()}, "snapshot"
        if history:
            return {w: g["skin"] for w, g in history[0]["guns"].items()}, "estimated"
        return None, "unknown"


def migrate_v1(data: dict, old: dict) -> None:
    """Convert v1 aggregates into v2 structures. Per-match records are kept and upgraded later."""
    processed = old.get("processed_matches") or []
    matches = data["matches"]
    for match_id, record in matches.items():
        if not isinstance(record, dict) or record.get("v") == SCHEMA:
            continue
        record["v"] = 1
        record["id"] = match_id
        if "start_time" in record and "start" not in record:
            record["start"] = record.pop("start_time")
        record.setdefault("result", "win" if record.get("won") else "loss")
        record.setdefault("rounds", (record.get("my_score") or 0) + (record.get("enemy_score") or 0))
        # ACS can be rebuilt from the saved scoreboard.
        rounds = record["rounds"] or 0
        board = record.get("scoreboard") or []
        for p in board:
            if p.get("name") == "Anonyme":
                p["name"] = ""  # v2 leaves hidden names empty
            if rounds and "acs" not in p and p.get("score") is not None:
                p["acs"] = round(p["score"] / rounds)
        me = next((p for p in board if p.get("is_me")), None)
        if me and rounds and "score" not in record:
            record["score"] = me.get("score", 0)
            record["acs"] = round(record["score"] / rounds)
            record.setdefault("team", me.get("team"))

    meta = data["meta"]
    skipped = set(meta.get("skipped", []))
    skipped.update(mid for mid in processed if mid not in matches)
    meta["skipped"] = sorted(skipped)

    # Skin stats from v1 can't be traced back to individual matches: keep them as a legacy bucket.
    skins = old.get("skins")
    if isinstance(skins, dict) and skins and "skins" not in data["legacy"]:
        clean = {}
        for wid, per_skin in skins.items():
            for sid, stats in (per_skin or {}).items():
                queues = {}
                for q, qs in ((stats or {}).get("queues") or {}).items():
                    queues[q] = {k: int(qs.get(k, 0) or 0) for k in ("kills", "matches", "wins")}
                if queues:
                    clean.setdefault(wid.lower(), {})[sid.lower()] = queues
        data["legacy"]["skins"] = clean

    stats = old.get("player_stats") or {}
    profile = stats.get("user_profile")
    if isinstance(profile, dict) and not data["profile"]:
        name, _, tag = (profile.get("name") or "").partition("#")
        if name in ("Hors Ligne", "Joueur", "Moi"):
            name, tag = "", ""
        data["profile"] = {"name": name, "tag": tag, "level": profile.get("level"), "rank": {"tier": profile.get("rank", 0)}}


class Accounts:
    """One database per Riot account: <root>/accounts/<puuid>/. Older single-account layouts
    (JSON files directly in <root>) are moved into the folder of the account they belong to."""

    def __init__(self, root: str):
        self.root = root
        self.dir = os.path.join(root, "accounts")
        os.makedirs(self.dir, exist_ok=True)

    # -- layout helpers
    def _flat_present(self) -> bool:
        names = [f"{n}.json" for n in COLLECTIONS] + [f"{n}.json" for n in V1_ONLY] + ["database.json"]
        return any(os.path.exists(os.path.join(self.root, n)) for n in names if n != "meta.json") or \
            os.path.exists(os.path.join(os.path.dirname(os.path.abspath(self.root)), "database.json"))

    def _flat_owner(self) -> str | None:
        try:
            with open(os.path.join(self.root, "profile.json"), encoding="utf-8") as f:
                return (json.load(f).get("puuid") or "").lower() or None
        except (OSError, ValueError):
            return None

    def _adopt_flat(self, puuid: str) -> None:
        """Move a legacy single-account database into this account's folder."""
        target = os.path.join(self.dir, puuid)
        os.makedirs(target, exist_ok=True)
        # v1 kept everything in a database.json next to the db folder: Store's migration looks for it
        # next to the account folder, i.e. in accounts/.
        legacy_single = os.path.join(os.path.dirname(os.path.abspath(self.root)), "database.json")
        if os.path.exists(legacy_single):
            shutil.move(legacy_single, os.path.join(self.dir, "database.json"))
        for entry in os.listdir(self.root):
            path = os.path.join(self.root, entry)
            if entry == "accounts" or entry in ("content-cache.json", "tracker.log", "instance.lock", "instance.json", "last_account.txt"):
                continue
            if entry.endswith(".json") or entry.startswith("backup-v1-") or entry.endswith(".bak") or ".corrupt-" in entry:
                shutil.move(path, os.path.join(target, entry))
        log.info("Base existante rattachée au compte %s", puuid[:8])

    def _remember(self, puuid: str) -> None:
        try:
            with open(os.path.join(self.root, "last_account.txt"), "w", encoding="utf-8") as f:
                f.write(puuid)
        except OSError:
            pass

    # -- public API
    def open(self, puuid: str) -> Store:
        puuid = puuid.lower()
        target = os.path.join(self.dir, puuid)
        if not os.path.isdir(target) and self._flat_present():
            owner = self._flat_owner()
            if owner in (None, puuid):
                self._adopt_flat(puuid)
        store = Store(target)
        store.owner = puuid
        self._remember(puuid)
        return store

    def initial(self) -> Store:
        """Store to show before the Riot Client tells us who is logged in."""
        owner = self._flat_owner()
        if owner and self._flat_present():
            return self.open(owner)
        try:
            with open(os.path.join(self.root, "last_account.txt"), encoding="utf-8") as f:
                last = f.read().strip()
            if last and os.path.isdir(os.path.join(self.dir, last)):
                return self.open(last)
        except OSError:
            pass
        if self._flat_present():
            store = Store(self.root)  # legacy data of an unknown account, adopted on first connection
            store.owner = None
            return store
        store = Store(os.path.join(self.dir, "_waiting"))
        store.owner = None
        return store

    def list(self) -> list[dict]:
        out = []
        for puuid in sorted(os.listdir(self.dir)):
            if puuid.startswith("_"):
                continue
            try:
                with open(os.path.join(self.dir, puuid, "profile.json"), encoding="utf-8") as f:
                    prof = json.load(f)
            except (OSError, ValueError):
                prof = {}
            out.append({"puuid": puuid, "name": prof.get("name"), "tag": prof.get("tag")})
        return out
