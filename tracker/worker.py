"""Background sync loop: talks to Riot, updates the store and publishes live state."""
from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict

from . import constants as C
from .parser import MATCH_VERSION, parse_live_loadouts, parse_match, parse_mmr, parse_own_loadout, player_line, summarize_recent
from .riot import NotRunning, RateLimited, RiotClient, RiotError, decode_presence, presence_party, presence_phase
from .static_data import StaticData
from .storage import Store

log = logging.getLogger(__name__)


class Tracker:
    def __init__(self, store: Store, static: StaticData, riot: RiotClient | None = None, accounts=None):
        self.store = store
        self.accounts = accounts  # storage.Accounts: one database per Riot account
        self.static = static
        self.riot = riot or RiotClient()
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        self.revision = 0
        self.status = {
            "connection": "offline",  # offline | client | game
            "phase": None,            # MENUS | PREGAME | INGAME
            "region": None,
            "last_sync": None,
            "syncing": False,
            "error": None,
            "backfill": None,
        }
        self.live: dict | None = None
        self.current_loadout: dict = {}
        self.events: list[dict] = []  # small feed of recent events for toasts

        self._next_profile = 0.0
        self._next_history = 0.0
        self._history_bursts = 0
        self._last_phase: str | None = None
        self._season: str | None = None
        self._season_starts: dict[str, int] = {}
        self._player_cache: dict[str, tuple[float, dict]] = {}
        self._name_cache: dict[str, str] = {}
        self._warned: set[str] = set()
        self._recent_cache: dict[str, tuple[float, dict | None]] = {}  # puuid -> recent form of live players
        self._details_cache: OrderedDict[str, dict] = OrderedDict()   # match details shared between players
        self._season_name: str | None = None
        self._season_names: dict[str, str] = {}
        self._live_fetched: dict[str, float] = {}
        self._failures: dict[str, int] = {}
        self._backfill_target = 0
        self._catching_up = False

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="tracker-sync", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def request_sync(self) -> None:
        self._next_history = 0
        self._next_profile = 0
        self._wake.set()

    def request_backfill(self, count: int = 100) -> None:
        """Import ``count`` more matches, older than what's already been paged through."""
        cursor = self.store.data["meta"].get("backfill_cursor", 20)
        self._backfill_target = max(self._backfill_target, cursor + count)
        self._next_history = 0
        self._wake.set()

    # ------------------------------------------------------------------ public snapshot
    def snapshot(self) -> dict:
        with self._lock:
            profile = dict(self.store.data["profile"])
            return {
                "revision": self.revision,
                "matches_version": self.store.matches_version,
                "status": dict(self.status),
                "profile": profile,
                "loadout": self.current_loadout or self._last_known_loadout(),
                "live": self.live,
                "events": list(self.events[-10:]),
            }

    def _last_known_loadout(self) -> dict:
        history = self.store.data["loadout_history"]
        return history[-1]["guns"] if history else {}

    def _publish(self, **status) -> None:
        with self._lock:
            changed = any(self.status.get(k) != v for k, v in status.items())
            self.status.update(status)
            if changed:
                self.revision += 1

    def _bump(self) -> None:
        with self._lock:
            self.revision += 1

    def _event(self, kind: str, text: str, **extra) -> None:
        with self._lock:
            last = self.events[-1]["id"] if self.events else 0
            self.events.append({"id": max(int(time.time() * 1000), last + 1), "kind": kind, "text": text, **extra})
            del self.events[:-20]
            self.revision += 1

    # ------------------------------------------------------------------ loop
    def _run(self) -> None:
        if self.static.is_stale():
            self.static.refresh()
        self.static.wait_ready(timeout=30)
        self.riot.fallback_version = self.static.version
        while not self._stop.is_set():
            delay = C.TICK_OFFLINE
            try:
                delay = self._tick()
                if self.status["error"] and self.riot.connected:
                    self._publish(error=None)
            except RateLimited as exc:
                log.warning("Riot : trop de requêtes, pause de %d s", exc.retry_after)
                self._publish(error=str(exc))
                delay = max(delay, min(exc.retry_after, 60))
            except NotRunning:
                self._set_offline()
            except RiotError as exc:
                log.warning("%s", exc)
                self._publish(error=str(exc))
            except Exception as exc:  # keep the loop alive whatever happens
                log.exception("Erreur inattendue dans la boucle de synchro")
                self._publish(error=f"Erreur interne: {exc}")
            finally:
                self.store.save()
            self._wake.wait(delay)
            self._wake.clear()

    def _set_offline(self) -> None:
        with self._lock:
            if self.live:
                self.live = None
            self.current_loadout = {}
        self._last_phase = None
        self._publish(connection="offline", phase=None, syncing=False, error=None, region=None)

    def _tick(self) -> float:
        # The content cache can be refreshed later on: always use the freshest client version.
        self.riot.fallback_version = self.static.version or self.riot.fallback_version
        if not self.riot.connect():
            self._set_offline()
            return C.TICK_OFFLINE
        if self.accounts and self.riot.puuid and self.riot.puuid != self.store.owner:
            self._switch_account(self.riot.puuid)
        now = time.time()
        presences = self._safe_presences()
        mine = next((p for p in presences if (p.get("puuid") or "").lower() == self.riot.puuid), None)
        decoded = decode_presence(mine.get("private")) if mine else {}
        phase = presence_phase(decoded) if mine else None
        connection = "game" if mine else "client"
        if mine and not phase:
            phase = self._remote_phase()
        self._publish(connection=connection, phase=phase, region=self.riot.region)

        if self._season is None:
            self._load_season()

        # Refresh on every phase change so the loadout is fresh when a match starts.
        if now >= self._next_profile or phase != self._last_phase:
            self._refresh_profile()
            self._next_profile = now + C.PROFILE_REFRESH

        if phase in ("PREGAME", "INGAME"):
            self._update_live(phase, presences, decoded)
            self._fill_recent()
        elif self.live:
            with self._lock:
                self.live = None
            self._bump()

        # After a game ends, match details appear with some delay: poll a few times quickly.
        if self._last_phase == "INGAME" and phase != "INGAME":
            self._history_bursts = 4
            self._next_history = now + 15
        self._last_phase = phase

        if now >= self._next_history:
            self._catching_up = False
            new = self._sync_history()
            if self._catching_up:
                self._next_history = now + 10  # more matches to import, keep going gently
            elif self._history_bursts and not new:
                self._history_bursts -= 1
                self._next_history = now + 20
            else:
                self._history_bursts = 0
                self._next_history = now + (C.HISTORY_REFRESH_INGAME if phase == "INGAME" else C.HISTORY_REFRESH)

        return {"PREGAME": C.TICK_PREGAME, "INGAME": C.TICK_INGAME}.get(phase, C.TICK_MENUS)

    def _switch_account(self, puuid: str) -> None:
        """Another Riot account is logged in: load its own database."""
        previous = self.store.owner
        self.store.save()
        store = self.accounts.open(puuid)
        with self._lock:
            self.store = store
            self.live = None
            self.current_loadout = {}
            self.revision += 1
        self._next_profile = self._next_history = 0
        self._last_phase = None
        self._failures.clear()
        if previous:
            log.info("Changement de compte : %s -> %s", previous[:8], puuid[:8])
            self._event("account", "Autre compte détecté : ses stats sont chargées")

    def _safe_presences(self) -> list[dict]:
        try:
            return self.riot.presences()
        except RiotError:
            return []

    def _remote_phase(self) -> str:
        """Fallback when presence can't be decoded."""
        if self.riot.pregame_player():
            return "PREGAME"
        if self.riot.coregame_player():
            return "INGAME"
        return "MENUS"

    # ------------------------------------------------------------------ profile
    def _load_season(self) -> None:
        try:
            content = self.riot.content() or {}
        except RateLimited:
            raise
        except RiotError as exc:
            log.warning("Saisons Riot indisponibles (%s) : l'acte en cours sera deviné", exc)
            self._season = ""
            return
        seasons = content.get("Seasons") or []
        if not seasons:
            log.warning("Saisons Riot : réponse vide (endpoint content-service modifié ?)")
        for s in seasons:
            start = s.get("StartTime")
            if s.get("ID") and start:
                try:
                    self._season_starts[s["ID"].lower()] = int(time.mktime(time.strptime(start[:19], "%Y-%m-%dT%H:%M:%S")) * 1000)
                except ValueError:
                    pass
        # "Episode · Act" names for every act, to label the act history.
        episodes = sorted((s for s in seasons if (s.get("Type") or "").lower() == "episode" and s.get("ID")),
                          key=lambda s: self._season_starts.get(s["ID"].lower(), 0))
        for s in seasons:
            if (s.get("Type") or "").lower() != "act" or not s.get("ID"):
                continue
            start = self._season_starts.get(s["ID"].lower(), 0)
            parent = [e for e in episodes if self._season_starts.get(e["ID"].lower(), 0) <= start]
            label = f"{parent[-1].get('Name')} · {s.get('Name')}" if parent else s.get("Name")
            self._season_names[s["ID"].lower()] = (label or "").strip(" ·")
        active = [s for s in seasons if s.get("IsActive") and (s.get("Type") or "").lower() == "act"]
        self._season = active[0]["ID"].lower() if active else ""
        episode = next((s for s in seasons if s.get("IsActive") and (s.get("Type") or "").lower() == "episode"), None)
        if active:
            parts = [episode.get("Name")] if episode and episode.get("Name") else []
            self._season_name = " · ".join(parts + [active[0].get("Name") or ""]).strip(" ·")

    def _rank_of(self, puuid: str, force: bool = False) -> dict:
        """Current rank, with fallbacks: MMR API -> last competitive update -> last rank seen in a match."""
        cached = self._player_cache.get(puuid)
        if cached and not force and time.time() - cached[0] < C.PLAYER_CACHE_TTL:
            return cached[1]
        data = self.riot.mmr(puuid) or {}
        if not data.get("QueueSkills") and not data.get("LatestCompetitiveUpdate"):
            self._warn_once("mmr", "API des rangs (mmr) : réponse vide, utilisation des sources de secours")
        rank = parse_mmr(data, self._season or None, self._season_starts)
        if not rank.get("tier"):
            try:
                update = ((self.riot.competitive_updates(1, puuid=puuid) or {}).get("Matches") or [{}])[0]
            except RateLimited:
                raise
            except RiotError:
                update = {}
            if update.get("TierAfterUpdate"):
                rank.update(tier=int(update["TierAfterUpdate"]), rr=int(update.get("RankedRatingAfterUpdate") or 0))
            else:
                known = self._known_tier(puuid)
                if known:
                    rank.update(tier=known, rr=None, source="match")
        rank["peak"] = max(rank.get("peak") or 0, rank.get("tier") or 0)
        self._player_cache[puuid] = (time.time(), rank)
        return rank

    def _known_tier(self, puuid: str) -> int:
        """Rank of a player in the latest competitive match we recorded with them."""
        best, when = 0, -1
        for m in self.store.data["matches"].values():
            if m.get("queue") != "competitive" or (m.get("start") or 0) <= when:
                continue
            for s in m.get("scoreboard") or []:
                if s.get("puuid") == puuid and s.get("rank_id"):
                    best, when = s["rank_id"], m.get("start") or 0
        return best or int((self.store.data["known_players"].get(puuid) or {}).get("rank_id") or 0)

    def _warn_once(self, key: str, message: str) -> None:
        if key not in self._warned:
            self._warned.add(key)
            log.warning(message)

    def _refresh_profile(self) -> None:
        riot = self.riot
        profile = dict(self.store.data["profile"])
        profile["puuid"] = riot.puuid
        profile["region"] = riot.region
        errors = []

        def attempt(fn):
            try:
                fn()
            except RateLimited:
                raise
            except RiotError as exc:
                errors.append(str(exc))

        def name():
            found = riot.own_name()
            if found:
                profile["name"], profile["tag"] = found

        def loadout():
            data = riot.loadout() or {}
            identity = data.get("Identity") or {}
            if identity.get("PlayerCardID"):
                profile["card"] = identity["PlayerCardID"].lower()
            if identity.get("PlayerTitleID"):
                profile["title"] = identity["PlayerTitleID"].lower()
            guns = parse_own_loadout(data)
            if guns:
                with self._lock:
                    self.current_loadout = guns
                self.store.add_snapshot(guns)

        def level():
            value = ((riot.account_xp() or {}).get("Progress") or {}).get("Level")
            if value:
                profile["level"] = value

        def rank():
            profile["rank"] = dict(self._rank_of(riot.puuid, force=True))
            profile["rank"]["acts"] = [dict(a, name=self._season_names.get(a["season"], "")) for a in profile["rank"].get("acts", [])]

        for fn in (name, loadout, level, rank):
            attempt(fn)
        if errors:
            log.warning("Profil partiellement mis à jour: %s", "; ".join(errors))
        profile["season_name"] = self._season_name
        profile["season"] = self._season or profile.get("season")
        profile["updated"] = int(time.time() * 1000)
        with self.store.lock:
            if self.store.data["profile"] != profile:
                self.store.data["profile"] = profile
                self.store.mark("profile")
        self._publish(last_sync=int(time.time() * 1000))
        self._bump()

    # ------------------------------------------------------------------ live match
    def _update_live(self, phase: str, presences: list[dict], my_presence: dict) -> None:
        riot = self.riot
        player = riot.pregame_player() if phase == "PREGAME" else riot.coregame_player()
        match_id = (player or {}).get("MatchID")
        if not match_id:
            return
        match_id = match_id.lower()

        # Lock the loadout used for this match (source of truth for skin stats).
        locked = self.store.data["locked_loadouts"]
        guns = self.current_loadout or self._last_known_loadout()
        if match_id not in locked and guns:
            locked[match_id] = {w: g["skin"] for w, g in guns.items()}
            self.store.mark("locked_loadouts")
            self._event("lock", "Partie détectée : skins verrouillés pour ce match")

        key = f"{match_id}:{phase}"
        now = time.time()
        live = self.live if self.live and self.live.get("match_id") == match_id else None
        if not live:
            self._live_fetched = {k: v for k, v in self._live_fetched.items() if k.startswith(match_id)}
        # Agent select changes quickly; in game the roster is fixed.
        if live and live.get("phase") == phase and phase == "INGAME":
            incomplete = any(not p["is_me"] and ((not p["incognito"] and not p["name"]) or not (p.get("rank") or {}).get("tier"))
                             for p in live["players"])
            if now - self._live_fetched.get(key, 0) < (10 if incomplete else 60):
                return

        if phase == "PREGAME":
            match = riot.pregame_match(match_id) or {}
            ally = match.get("AllyTeam") or {}
            raw_players = [dict(p, TeamID=ally.get("TeamID", "")) for p in ally.get("Players") or []]
            enemy = match.get("EnemyTeam") or {}
            raw_players += [dict(p, TeamID=enemy.get("TeamID", "")) for p in enemy.get("Players") or []]
            queue = match.get("QueueID") or ""
            map_id = match.get("MapID") or ""
            phase_end = match.get("PhaseTimeRemainingNS")
        else:
            match = riot.coregame_match(match_id) or {}
            raw_players = match.get("Players") or []
            queue = (match.get("MatchmakingData") or {}).get("QueueID") or ""
            map_id = match.get("MapID") or ""
            phase_end = None
        if not raw_players:
            return

        players = []
        for p in raw_players:
            ident = p.get("PlayerIdentity") or {}
            pid = (p.get("Subject") or "").lower()
            players.append({
                "puuid": pid,
                "agent": (p.get("CharacterID") or "").lower(),
                "lock": (p.get("CharacterSelectionState") or "").lower(),
                "team": p.get("TeamID") or "",
                "is_me": pid == riot.puuid,
                "incognito": bool(ident.get("Incognito")) and pid != riot.puuid,
                "level": 0 if ident.get("HideAccountLevel") and pid != riot.puuid else int(ident.get("AccountLevel") or 0),
                "card": (ident.get("PlayerCardID") or "").lower(),
            })
        my_team = next((p["team"] for p in players if p["is_me"]), "")

        # Skins
        skins = {}
        loadout_key = f"{key}:loadouts"
        live_same_phase = live if live and live.get("phase") == phase else None
        if not live_same_phase or now - self._live_fetched.get(loadout_key, 0) > (15 if phase == "PREGAME" else 120):
            try:
                payload = riot.pregame_loadouts(match_id) if phase == "PREGAME" else riot.coregame_loadouts(match_id)
                skins = parse_live_loadouts(payload or {}, players, self.static.skin_ids)
                self._live_fetched[loadout_key] = now
            except RateLimited:
                raise
            except RiotError as exc:
                log.debug("loadouts indisponibles: %s", exc)
        else:
            skins = {p["puuid"]: p.get("skins", {}) for p in live_same_phase["players"]}

        # Names (never resolved for players in streamer mode)
        missing = [p["puuid"] for p in players if not p["incognito"] and p["puuid"] not in self._name_cache]
        if missing:
            try:
                for entry in riot.names(missing):
                    if entry.get("GameName"):
                        self._name_cache[entry["Subject"].lower()] = f"{entry['GameName']}#{entry.get('TagLine', '')}"
            except RateLimited:
                log.warning("name-service : limite Riot atteinte, pseudos repris du cache")
            except RiotError as exc:
                self._warn_once("names", f"name-service indisponible ({exc}) : pseudos repris du cache")

        # Parties: presences only cover friends, which is enough to spot your own premade.
        parties = {}
        for pres in presences:
            party = presence_party(decode_presence(pres.get("private")))
            if party and pres.get("puuid"):
                parties[pres["puuid"].lower()] = party
        my_party = presence_party(my_presence)
        party_ids: dict[str, int] = {}

        encounters = self._encounters({p["puuid"] for p in players if not p["is_me"]})
        known = self.store.data["known_players"]
        for p in players:
            pid = p["puuid"]
            try:
                p["rank"] = self._rank_of(pid)
            except RiotError:  # includes rate limits: keep what we know and retry on the next rebuild
                cached = (self._player_cache.get(pid) or (0, None))[1]
                known_tier = self._known_tier(pid)
                p["rank"] = cached or ({"tier": known_tier, "rr": None, "source": "match"} if known_tier else {"tier": 0})
            name = self._name_cache.get(pid, "") or (known.get(pid) or {}).get("name", "")
            if p["is_me"]:
                prof = self.store.data["profile"]
                name = f"{prof.get('name', '')}#{prof.get('tag', '')}" if prof.get("name") else name
            p["name"] = "" if p["incognito"] else name
            p["skins"] = skins.get(pid, {})
            p["is_ally"] = p["team"] == my_team
            party = parties.get(pid)
            if party and (sum(1 for q in players if parties.get(q["puuid"]) == party) > 1):
                p["party"] = party_ids.setdefault(party, len(party_ids) + 1)
                p["my_party"] = party == my_party
            p["encounters"] = encounters.get(pid)
            cached_recent = self._recent_cache.get(pid)
            p["recent"] = cached_recent[1] if cached_recent else None
            if p["name"] and not p["is_me"]:
                entry = known.setdefault(pid, {})
                before = dict(entry)
                entry["name"] = p["name"]
                if p["rank"].get("tier"):
                    entry["rank_id"] = p["rank"]["tier"]
                if entry != before or now * 1000 - entry.get("seen", 0) > 3600_000:
                    entry["seen"] = int(now * 1000)
                    self.store.mark("known_players")

        summary_key = f"{match_id}:{phase}"
        if summary_key not in self._warned:
            self._warned.add(summary_key)
            others = [p for p in players if not p["is_me"]]
            log.info("%s : %d joueurs, %d masqués (mode streamer), %d pseudos, %d rangs trouvés",
                     "Sélection d'agent" if phase == "PREGAME" else "Partie en cours", len(others),
                     sum(p["incognito"] for p in others), sum(bool(p["name"]) for p in others),
                     sum(bool((p.get("rank") or {}).get("tier")) for p in others))
        with self._lock:
            self.live = {
                "match_id": match_id,
                "phase": phase,
                "queue": queue.lower(),
                "map_id": map_id,
                "phase_end_ns": phase_end,
                "players": players,
                "has_skins": any(p["skins"] for p in players),
                "updated": int(now * 1000),
            }
            self.revision += 1
        self._live_fetched[key] = now

    # ------------------------------------------------------------------ live players' recent form
    RECENT_GAMES = 3
    RECENT_TTL = 1800
    SKIP_QUEUES = {"deathmatch", "hurm", "custom", "ggteam", "snowball"}

    def _fill_recent(self) -> None:
        """Fetch the last games of the players of the live match, enemies first (for the overlay)."""
        live = self.live
        if not live:
            return
        now = time.time()
        if now < self.riot.rate_limited_until + 90:
            return  # Riot just asked us to slow down: names and ranks come first
        pending = any(not p["is_me"] and not p["incognito"] and not p["name"] for p in live["players"])
        if pending:
            return
        todo = [p for p in sorted(live["players"], key=lambda p: p["is_ally"])
                if not p["is_me"] and now - self._recent_cache.get(p["puuid"], (0, None))[0] > self.RECENT_TTL]
        for player in todo[:1]:  # one player per tick keeps well under Riot's rate limit
            stats = self._recent_of(player["puuid"], live.get("queue") or "")
            self._recent_cache[player["puuid"]] = (time.time(), stats)
            with self._lock:
                if self.live is not live:
                    return
                for p in live["players"]:
                    if p["puuid"] == player["puuid"]:
                        p["recent"] = stats
                        if stats and stats.get("tier") and not (p.get("rank") or {}).get("tier"):
                            p["rank"] = dict(p.get("rank") or {}, tier=stats["tier"], rr=None, source="match")
                            self._player_cache[p["puuid"]] = (time.time(), p["rank"])
                live["updated"] = int(time.time() * 1000)
                self.revision += 1

    def _recent_of(self, puuid: str, queue: str) -> dict | None:
        history = (self.riot.match_history(0, 8, puuid=puuid) or {}).get("History") or []
        entries = [e for e in history if (e.get("QueueID") or "").lower() not in self.SKIP_QUEUES and e.get("MatchID")]
        same = [e for e in entries if (e.get("QueueID") or "").lower() == queue]
        picked = (same if len(same) >= 2 else entries)[: self.RECENT_GAMES]
        lines = []
        for i, entry in enumerate(picked):
            mid = entry["MatchID"].lower()
            details = self._details_cache.get(mid)
            if details is None:
                if i:
                    self._stop.wait(C.DETAILS_SPACING)
                try:
                    details = self.riot.match_details(mid) or {}
                except RateLimited:
                    raise
                except RiotError:
                    details = {}
                self._details_cache[mid] = details
                while len(self._details_cache) > 40:
                    self._details_cache.popitem(last=False)
            lines.append(player_line(details, puuid) if details else None)
        return summarize_recent(lines)

    def _encounters(self, puuids: set[str]) -> dict:
        """How many recorded matches you've shared with each player."""
        found: dict[str, dict] = {}
        if not puuids:
            return found
        for mid, m in self.store.data["matches"].items():
            board = m.get("scoreboard") or []
            my_team = next((s.get("team") for s in board if s.get("is_me")), None)
            for s in board:
                pid = (s.get("puuid") or "").lower()
                if pid in puuids:
                    e = found.setdefault(pid, {"count": 0, "with": 0, "against": 0, "wins": 0, "last": 0})
                    e["count"] += 1
                    e["with" if s.get("team") == my_team else "against"] += 1
                    e["wins"] += 1 if m.get("result") == "win" else 0
                    e["last"] = max(e["last"], int(m.get("start") or 0))
        return found

    # ------------------------------------------------------------------ history
    def _sync_history(self) -> int:
        riot = self.riot
        self._publish(syncing=True)
        added = 0
        try:
            history = riot.match_history(0, 20) or {}
            entries = history.get("History") or []
            total = int(history.get("Total") or 0)
            processed = self.store.processed_ids()
            todo = [(e["MatchID"].lower(), False) for e in entries if e.get("MatchID") and e["MatchID"].lower() not in processed]

            if self._backfill_target:
                todo += self._backfill_ids(total, processed | {t[0] for t in todo})

            legacy = [mid for mid, m in self.store.data["matches"].items() if m.get("v", 1) < MATCH_VERSION and not m.get("upgrade_failed")]
            todo = todo[: C.MAX_DETAILS_PER_SYNC]
            upgrades = legacy[: C.MAX_UPGRADES_PER_SYNC]

            for i, (match_id, backfill) in enumerate(todo):
                if i:
                    self._stop.wait(C.DETAILS_SPACING)  # stay well under Riot's rate limit
                if self._import_match(match_id, backfill=backfill):
                    added += 1
            for match_id in upgrades:
                self._stop.wait(C.DETAILS_SPACING)
                self._import_match(match_id, upgrade=True)

            if added or upgrades:
                self._merge_rr()
            if added:
                self._event("match", f"{added} nouveau{'x' if added > 1 else ''} match{'s' if added > 1 else ''} enregistré{'s' if added > 1 else ''}")
                # End-of-match recap for a game that just finished (not for backfilled history).
                fresh = [self.store.data["matches"][mid] for mid, backfill in todo
                         if not backfill and mid in self.store.data["matches"]]
                fresh = [m for m in fresh if time.time() * 1000 - (m.get("start") or 0) < 3 * 3600_000]
                if fresh:
                    latest = max(fresh, key=lambda m: m.get("start") or 0)
                    self._event("recap", "Récap de ton dernier match", match_id=latest["id"])
            self._publish(last_sync=int(time.time() * 1000))
            self._catching_up = len(todo) >= C.MAX_DETAILS_PER_SYNC or len(legacy) > len(upgrades) or bool(self._backfill_target)
        finally:
            self._publish(syncing=False)
        return added

    def _backfill_ids(self, total: int, known: set[str]) -> list[tuple[str, bool]]:
        """Page through older history into a persisted queue, and hand out the next batch."""
        meta = self.store.data["meta"]
        cursor = meta.get("backfill_cursor", 20)
        target = min(self._backfill_target, total or self._backfill_target)
        pending = [mid for mid in meta.get("backfill_pending", []) if mid not in known]
        while cursor < target and len(pending) < C.MAX_DETAILS_PER_SYNC:
            page = self.riot.match_history(cursor, min(cursor + 20, target)) or {}
            entries = page.get("History") or []
            if not entries:
                cursor = target
                break
            for e in entries:
                mid = (e.get("MatchID") or "").lower()
                if mid and mid not in known and mid not in pending:
                    pending.append(mid)
            cursor += len(entries)
        meta["backfill_cursor"] = cursor
        meta["backfill_pending"] = pending
        self.store.mark("meta")
        if cursor >= target and not pending:
            self._backfill_target = 0
            self._publish(backfill=None)
        else:
            self._publish(backfill={"cursor": cursor - len(pending), "target": target})
        return [(mid, True) for mid in pending[: C.MAX_DETAILS_PER_SYNC]]

    def _import_match(self, match_id: str, upgrade: bool = False, backfill: bool = False) -> bool:
        transient = False
        try:
            details = self.riot.match_details(match_id)  # None = 404, Riot no longer has it
        except RateLimited:
            raise
        except RiotError as exc:
            log.warning("Match %s: %s", match_id, exc)
            details, transient = None, True
        record = parse_match(details, self.riot.puuid, self.static.weapon_ids, self.store.data["known_players"]) if details else None
        with self.store.lock:
            if record is None:
                # Network errors get a few retries; anything else is final so the sync never stalls.
                self._failures[match_id] = self._failures.get(match_id, 0) + 1
                if not transient or self._failures[match_id] >= 3:
                    if upgrade:
                        self.store.data["matches"][match_id]["upgrade_failed"] = True
                        self.store.mark("matches")
                    else:
                        self.store.add_skipped(match_id)
                return False
            record["id"] = match_id
            previous = self.store.data["matches"].get(match_id) or {}
            if upgrade:
                if previous.get("v", 1) >= 2:
                    # Already tracked by v2: keep its skin attribution as is.
                    record["loadout_source"] = previous.get("loadout_source", "unknown")
                    record["loadout"] = previous.get("loadout", {})
                else:
                    # v1 skin kills live in the legacy bucket already: don't count them twice.
                    record["loadout_source"] = "legacy"
                    record["loadout"] = {}
                if previous.get("rr"):
                    record["rr"] = previous["rr"]
            else:
                locked = self.store.data["locked_loadouts"].get(match_id)
                if locked:
                    loadout, source = locked, "locked"
                elif backfill:
                    loadout, source = None, "unknown"
                else:
                    loadout, source = self.store.loadout_at(record["start"])
                record["loadout_source"] = source
                record["loadout"] = {w: loadout[w] for w in record["weapon_kills"] if loadout and w in loadout}
            self.store.data["matches"][match_id] = record
            self.store.mark("matches")
        return not upgrade

    def _merge_rr(self) -> None:
        try:
            updates = (self.riot.competitive_updates(20) or {}).get("Matches") or []
        except RiotError:
            return
        with self.store.lock:
            changed = False
            for u in updates:
                m = self.store.data["matches"].get((u.get("MatchID") or "").lower())
                if not m:
                    continue
                rr = {
                    "earned": int(u.get("RankedRatingEarned") or 0),
                    "after": int(u.get("RankedRatingAfterUpdate") or 0),
                    "tier_before": int(u.get("TierBeforeUpdate") or 0),
                    "tier_after": int(u.get("TierAfterUpdate") or 0),
                }
                if m.get("rr") != rr:
                    m["rr"] = rr
                    changed = True
            if changed:
                self.store.mark("matches")
