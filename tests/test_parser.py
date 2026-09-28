import base64
import json

from tracker.constants import SOCKET_CHROMA, SOCKET_SKIN, WEAPON_MELEE, WEAPON_VANDAL
from tracker.parser import extract_item_skins, parse_live_loadouts, parse_match, parse_mmr, parse_own_loadout, queue_of
from tracker.riot import decode_presence, presence_party, presence_phase, resolve_region

ME, A2, E1, E2 = "me", "ally", "enemy1", "enemy2"
SHERIFF = "e336c6b8-418d-9340-d77f-7a9e4cfe0702"
WEAPONS = {WEAPON_VANDAL, SHERIFF, WEAPON_MELEE}


def kill(killer, victim, t, weapon=WEAPON_VANDAL, assistants=(), dtype="Weapon"):
    return {"killer": killer, "victim": victim, "roundTime": t, "assistants": list(assistants),
            "finishingDamage": {"damageType": dtype, "damageItem": weapon.upper()}}


def make_match(queue="competitive", rounds=None):
    players = [
        {"subject": ME.upper(), "teamId": "Blue", "characterId": "AGENT-A", "gameName": "Moi", "tagLine": "EUW",
         "partyId": "p1", "competitiveTier": 15, "stats": {"kills": 4, "deaths": 1, "assists": 1, "score": 900, "roundsPlayed": 3}},
        {"subject": A2, "teamId": "Blue", "characterId": "agent-b", "gameName": "", "partyId": "p1",
         "competitiveTier": 14, "stats": {"kills": 1, "deaths": 2, "assists": 2, "score": 400, "roundsPlayed": 3}},
        {"subject": E1, "teamId": "Red", "characterId": "agent-c", "gameName": "Opp", "tagLine": "1",
         "competitiveTier": 16, "stats": {"kills": 2, "deaths": 3, "assists": 0, "score": 500, "roundsPlayed": 3}},
        {"subject": E2, "teamId": "Red", "characterId": "agent-d", "competitiveTier": 0,
         "stats": {"kills": 1, "deaths": 2, "assists": 0, "score": 300, "roundsPlayed": 3}},
    ]
    if rounds is None:
        rounds = [
            # R1: I get first blood + 2 more kills?? only 2 enemies -> I kill both, win
            {"winningTeam": "Blue", "bombPlanter": ME.upper(), "playerStats": [
                {"subject": ME.upper(), "kills": [kill(ME, E1, 1000), kill(ME, E2, 3000)],
                 "damage": [{"receiver": E1, "damage": 150, "headshots": 1, "bodyshots": 1, "legshots": 0},
                            {"receiver": E2, "damage": 150, "headshots": 0, "bodyshots": 2, "legshots": 1},
                            {"receiver": A2, "damage": 10, "headshots": 0, "bodyshots": 1, "legshots": 0}]},
            ]},
            # R2: ally dies first, I clutch 1v2 with knife + sheriff
            {"winningTeam": "Blue", "playerStats": [
                {"subject": E1, "kills": [kill(E1, A2, 500)]},
                {"subject": ME.upper(), "kills": [kill(ME, E1, 2000, dtype="Melee", weapon=""), kill(ME, E2, 2500, weapon=SHERIFF)],
                 "damage": [{"receiver": E1, "damage": 150, "headshots": 1, "bodyshots": 0, "legshots": 0},
                            {"receiver": E2, "damage": 150, "headshots": 1, "bodyshots": 0, "legshots": 0}]},
            ]},
            # R3: I die, traded by ally within 5s; we lose
            {"winningTeam": "Red", "playerStats": [
                {"subject": E1, "kills": [kill(E1, ME, 1000)]},
                {"subject": A2, "kills": [kill(A2, E1, 3000)]},
                {"subject": E2, "kills": [kill(E2, A2, 9000)]},
            ]},
        ]
    return {
        "matchInfo": {"queueID": queue, "mapId": "/Game/Maps/Ascent/Ascent", "gameStartMillis": 1000,
                      "gameLengthMillis": 60000, "isRanked": True, "seasonId": "S1"},
        "players": players,
        "teams": [{"teamId": "Blue", "won": True, "roundsWon": 2}, {"teamId": "Red", "won": False, "roundsWon": 1}],
        "roundResults": rounds,
    }


def test_parse_match_core_stats():
    rec = parse_match(make_match(), "ME", WEAPONS, {A2: {"name": "Pote#1", "rank_id": 20}})
    assert rec["result"] == "win" and rec["won"]
    assert (rec["my_score"], rec["enemy_score"], rec["rounds"]) == (2, 1, 3)
    assert rec["agent"] == "agent-a"
    assert rec["acs"] == 300
    # team damage excluded
    assert rec["damage"] == 600 and rec["adr"] == 200
    assert (rec["headshots"], rec["bodyshots"], rec["legshots"]) == (3, 3, 1)
    assert rec["hs_percent"] == 43
    assert rec["first_bloods"] == 1 and rec["first_deaths"] == 1
    assert rec["plants"] == 1
    assert rec["kast"] == 100  # R1/R2 kills, R3 traded
    assert rec["weapon_kills"] == {WEAPON_VANDAL: 2, WEAPON_MELEE: 1, SHERIFF: 1}
    assert rec["clutches"] == {"2": 1}


def test_scoreboard_names_and_known_players():
    rec = parse_match(make_match(), "me", WEAPONS, {A2: {"name": "Pote#1", "rank_id": 20}})
    board = {p["puuid"]: p for p in rec["scoreboard"]}
    assert board["me"]["is_me"] and board["me"]["name"] == "Moi#EUW"
    assert board[A2]["name"] == "Pote#1" and board[A2]["rank_id"] == 14  # match rank wins over cache
    assert board[E2]["name"] == ""
    assert board["me"]["party"] == board[A2]["party"] == "p1"


def test_custom_and_missing_player_are_skipped():
    custom = make_match(queue="")
    custom["matchInfo"]["provisioningFlowID"] = "CustomGame"
    assert parse_match(custom, "me", WEAPONS) is None
    assert parse_match(make_match(), "stranger", WEAPONS) is None


def test_draw_and_queue_fallbacks():
    m = make_match()
    m["teams"] = [{"teamId": "Blue", "won": False, "roundsWon": 1}, {"teamId": "Red", "won": False, "roundsWon": 1}]
    assert parse_match(m, "me", WEAPONS)["result"] == "draw"
    assert queue_of({"queueID": "", "gameMode": "/Game/GameModes/Deathmatch/X"}) == "deathmatch"
    assert queue_of({"queueID": "Swiftplay"}) == "swiftplay"


def test_multikill_counted():
    rounds = [{"winningTeam": "Blue", "playerStats": [{"subject": "me", "kills": [
        kill("me", E1, 1), kill("me", E2, 2), kill("me", "x", 3)]}]}]
    rec = parse_match(make_match(rounds=rounds), "me", WEAPONS)
    assert rec["multikills"] == {"3": 1}


def test_loadout_parsers():
    own = parse_own_loadout({"Guns": [{"ID": "W1", "SkinID": "S1", "ChromaID": "C1"}]})
    assert own == {"w1": {"skin": "s1", "chroma": "c1"}}

    items = {"W1": {"Sockets": {SOCKET_SKIN.upper(): {"Item": {"ID": "S1"}}, SOCKET_CHROMA: {"Item": {"ID": "C1"}}}},
             "W2": {"Sockets": {"other": {"Item": {"ID": "S2"}}}}}
    assert extract_item_skins(items) == {"w1": {"skin": "s1", "chroma": "c1"}}
    assert extract_item_skins(items, {"s2"})["w2"]["skin"] == "s2"

    players = [{"puuid": "a", "agent": "x"}, {"puuid": "b", "agent": "y"}]
    core = {"Loadouts": [{"CharacterID": "Y", "Loadout": {"Items": items}}]}
    assert set(parse_live_loadouts(core, players)) == {"b"}
    by_subject = {"Loadouts": [{"Loadout": {"Subject": "A", "Items": items}}]}
    assert set(parse_live_loadouts(by_subject, players)) == {"a"}


def test_parse_mmr_current_and_peak():
    data = {"QueueSkills": {"competitive": {"SeasonalInfoBySeasonID": {
        "old": {"CompetitiveTier": 22, "WinsByTier": {"22": 3}},
        "cur": {"CompetitiveTier": 18, "RankedRating": 42, "NumberOfGames": 10, "NumberOfWinsWithPlacements": 6,
                "WinsByTier": {"17": 2, "18": 4}},
    }}}}
    rank = parse_mmr(data, "cur", {"old": 1500000000000, "cur": 1700000000000})
    assert rank == {"tier": 18, "rr": 42, "peak": 25, "peak_season": "old", "act_games": 10, "act_wins": 6}
    # Unknown current season: fall back to latest update
    latest = {"LatestCompetitiveUpdate": {"TierAfterUpdate": 12, "RankedRatingAfterUpdate": 5, "SeasonID": "x"}}
    assert parse_mmr(latest, None)["tier"] == 12
    assert parse_mmr({}, "cur")["tier"] == 0


def test_presence_decoding_both_formats():
    def enc(obj):
        return base64.b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    old = decode_presence(enc({"sessionLoopState": "INGAME", "partyId": "p"}))
    new = decode_presence(enc({"matchPresenceData": {"sessionLoopState": "PREGAME"}, "partyPresenceData": {"partyId": "q"}}))
    assert presence_phase(old) == "INGAME" and presence_party(old) == "p"
    assert presence_phase(new) == "PREGAME" and presence_party(new) == "q"
    assert decode_presence("%%%") == {} and presence_phase({}) is None


def test_region_resolution():
    assert resolve_region("EU") == ("eu", "eu")
    assert resolve_region("latam") == ("latam", "na")
    assert resolve_region("br") == ("br", "na")
