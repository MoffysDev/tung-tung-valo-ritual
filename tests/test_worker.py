import base64
import json

import pytest

from tracker import constants as C
from tracker.constants import WEAPON_VANDAL
from tracker.riot import RiotError
from tracker.storage import Store
from tracker.worker import Tracker
from tests.test_parser import make_match

SKIN_A, SKIN_B = "skin-a", "skin-b"


def presence(puuid, phase, party):
    blob = base64.b64encode(json.dumps({"matchPresenceData": {"sessionLoopState": phase},
                                        "partyPresenceData": {"partyId": party}}).encode()).decode()
    return {"puuid": puuid, "product": "valorant", "private": blob}


class FakeStatic:
    ready = True
    version = "release-1"
    weapon_ids = {WEAPON_VANDAL}
    skin_ids = {SKIN_A, SKIN_B}

    def is_stale(self):
        return False

    def wait_ready(self, timeout=None):
        return True


class FakeRiot:
    def __init__(self):
        self.puuid = "me"
        self.region = "eu"
        self.connected = True
        self.phase = "MENUS"
        self.history = []
        self.details = {}
        self.name_calls = []
        self.fallback_version = None

    def connect(self):
        return self.connected

    def presences(self):
        return [presence("me", self.phase, "party1"), presence("friend", self.phase, "party1")]

    def own_name(self):
        return ("Moi", "EUW")

    def loadout(self):
        return {"Guns": [{"ID": WEAPON_VANDAL, "SkinID": SKIN_B}], "Identity": {"PlayerCardID": "CARD"}}

    def account_xp(self):
        return {"Progress": {"Level": 42}}

    def mmr(self, puuid):
        return {"LatestCompetitiveUpdate": {"TierAfterUpdate": 15, "RankedRatingAfterUpdate": 40, "SeasonID": "s"}}

    def content(self):
        return {"Seasons": []}

    def match_history(self, start=0, end=20):
        return {"History": [{"MatchID": m} for m in self.history[start:end]], "Total": len(self.history)}

    def match_details(self, match_id):
        detail = {k.lower(): v for k, v in self.details.items()}.get(match_id.lower())
        if isinstance(detail, Exception):
            raise detail
        return detail

    def competitive_updates(self, count=20):
        return {"Matches": [{"MatchID": "M1", "RankedRatingEarned": 18, "RankedRatingAfterUpdate": 58,
                             "TierBeforeUpdate": 15, "TierAfterUpdate": 15}]}

    def names(self, puuids):
        self.name_calls.append(list(puuids))
        return [{"Subject": p, "GameName": p.title(), "TagLine": "1"} for p in puuids]

    def pregame_player(self):
        return {"MatchID": "LIVE"} if self.phase == "PREGAME" else None

    def coregame_player(self):
        return None

    def pregame_match(self, match_id):
        ident = {"AccountLevel": 10}
        return {"MapID": "/Game/Maps/Ascent/Ascent", "QueueID": "competitive",
                "AllyTeam": {"TeamID": "Blue", "Players": [
                    {"Subject": "me", "CharacterID": "A1", "CharacterSelectionState": "locked", "PlayerIdentity": ident},
                    {"Subject": "friend", "CharacterID": "A2", "CharacterSelectionState": "selected", "PlayerIdentity": ident},
                    {"Subject": "ghost", "CharacterID": "", "PlayerIdentity": {"Incognito": True, "AccountLevel": 99, "HideAccountLevel": True}},
                ]}, "EnemyTeam": None}

    def pregame_loadouts(self, match_id):
        items = {WEAPON_VANDAL: {"Sockets": {"bcef87d6-209b-46c6-8b19-fbe40bd95abc": {"Item": {"ID": SKIN_A}}}}}
        return {"Loadouts": [{"Loadout": {"Subject": "friend", "Items": items}}]}


def details(match_id, start):
    m = make_match()
    m["matchInfo"]["gameStartMillis"] = start
    return m


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "DETAILS_SPACING", 0)
    store = Store(str(tmp_path / "db"))
    riot = FakeRiot()
    tracker = Tracker(store, FakeStatic(), riot)
    return store, riot, tracker


def test_history_sync_attributes_skins(setup):
    store, riot, tracker = setup
    riot.history = ["M1", "M2", "CUSTOM"]
    riot.details = {"M1": details("M1", 10_000), "M2": details("M2", 20_000), "CUSTOM": make_match(queue="")}
    riot.details["CUSTOM"]["matchInfo"]["provisioningFlowID"] = "CustomGame"
    store.data["locked_loadouts"]["m1"] = {WEAPON_VANDAL: SKIN_A}
    store.add_snapshot({WEAPON_VANDAL: {"skin": SKIN_B, "chroma": ""}}, ts=15)  # 15_000 ms

    assert tracker._sync_history() == 2
    m1, m2 = store.data["matches"]["m1"], store.data["matches"]["m2"]
    assert (m1["loadout_source"], m1["loadout"]) == ("locked", {WEAPON_VANDAL: SKIN_A})
    assert (m2["loadout_source"], m2["loadout"]) == ("snapshot", {WEAPON_VANDAL: SKIN_B})
    assert m1["rr"]["earned"] == 18
    assert "custom" in store.data["meta"]["skipped"]
    assert tracker._sync_history() == 0  # nothing new the second time


def test_failed_details_are_skipped_after_retries(setup):
    store, riot, tracker = setup
    riot.history = ["BAD"]
    riot.details = {"BAD": RiotError("boom")}
    for _ in range(3):
        tracker._sync_history()
    assert "bad" in store.data["meta"]["skipped"]


def test_backfill_imports_every_older_match(setup):
    store, riot, tracker = setup
    riot.history = [f"M{i}" for i in range(45)]
    riot.details = {m: details(m, i) for i, m in enumerate(riot.history)}
    for m in riot.history[:20]:
        store.add_skipped(m.lower())  # recent ones already known
    tracker.request_backfill(100)
    for _ in range(5):
        tracker._sync_history()
    assert len(store.data["matches"]) == 25
    assert tracker.status["backfill"] is None and not store.data["meta"]["backfill_pending"]


def test_missing_match_is_skipped_immediately(setup):
    store, riot, tracker = setup
    riot.history = ["GONE"]  # match_details returns None (HTTP 404)
    tracker._sync_history()
    assert "gone" in store.data["meta"]["skipped"]


def test_legacy_matches_are_upgraded_without_double_counting(setup):
    store, riot, tracker = setup
    store.data["matches"]["old"] = {"v": 1, "id": "old", "kills": 1}
    riot.details = {"old": details("old", 1)}
    tracker._sync_history()
    rec = store.data["matches"]["old"]
    assert rec["v"] == 3 and rec["loadout_source"] == "legacy" and rec["loadout"] == {}
    assert rec["acs"] == 300


def test_v2_matches_keep_their_skins_when_upgraded(setup):
    store, riot, tracker = setup
    store.data["matches"]["m2"] = {"v": 2, "id": "m2", "loadout_source": "locked", "loadout": {WEAPON_VANDAL: SKIN_A},
                                   "rr": {"earned": 12}}
    riot.details = {"m2": details("m2", 1)}
    tracker._sync_history()
    rec = store.data["matches"]["m2"]
    assert rec["v"] == 3 and rec["sides"] is not None
    assert (rec["loadout_source"], rec["loadout"], rec["rr"]) == ("locked", {WEAPON_VANDAL: SKIN_A}, {"earned": 12})


def test_pregame_live_view(setup):
    store, riot, tracker = setup
    store.data["matches"]["past"] = {"v": 2, "id": "past", "result": "win", "start": 5, "scoreboard": [
        {"puuid": "me", "team": "Blue", "is_me": True}, {"puuid": "friend", "team": "Blue"}]}
    riot.phase = "PREGAME"
    tracker._tick()

    live = tracker.live
    assert live and live["phase"] == "PREGAME" and live["queue"] == "competitive"
    players = {p["puuid"]: p for p in live["players"]}
    assert all(p["is_ally"] for p in players.values())  # pregame players inherit AllyTeam.TeamID
    assert players["me"]["name"] == "Moi#EUW" and players["me"]["lock"] == "locked"
    assert players["friend"]["name"] == "Friend#1"
    assert players["friend"]["skins"][WEAPON_VANDAL]["skin"] == SKIN_A
    assert players["friend"]["party"] == players["me"]["party"] and players["friend"]["my_party"]
    assert players["friend"]["encounters"]["with"] == 1
    # Streamer mode is respected: no name lookup, no name, hidden level
    ghost = players["ghost"]
    assert ghost["name"] == "" and ghost["level"] == 0 and ghost["incognito"]
    assert all("ghost" not in call for call in riot.name_calls)
    # Loadout locked for the match, and profile refreshed
    assert store.data["locked_loadouts"]["live"] == {WEAPON_VANDAL: SKIN_B}
    assert store.data["profile"]["level"] == 42 and store.data["profile"]["rank"]["tier"] == 15
    assert tracker.status["phase"] == "PREGAME" and tracker.status["connection"] == "game"


def test_offline_state(setup):
    store, riot, tracker = setup
    riot.connected = False
    tracker._tick()
    assert tracker.status["connection"] == "offline" and tracker.live is None
