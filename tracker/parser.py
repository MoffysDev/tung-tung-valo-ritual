"""Pure functions turning Riot payloads into compact records (no I/O, fully unit-tested)."""
from __future__ import annotations

from collections import Counter

from .constants import ASCENDANT_RELEASE_MS, SOCKET_CHROMA, SOCKET_SKIN, WEAPON_MELEE

TRADE_WINDOW_MS = 5000
MATCH_VERSION = 4
# Queues with 12-round halves (pistol rounds are rounds 1 and 13).
SIDED_QUEUES = {"competitive", "unrated", "premier", "newmap"}
# Team buy, from the average loadout value of the 5 players.
BUY_ECO, BUY_FULL = 1500, 3500


def buy_type(round_index: int, avg_loadout: float, sided: bool) -> str:
    if sided and round_index in (0, 12):
        return "pistol"
    if avg_loadout < BUY_ECO:
        return "eco"
    return "full" if avg_loadout >= BUY_FULL else "force"


def _xy(loc) -> tuple[int, int] | None:
    if isinstance(loc, dict) and loc.get("x") is not None and loc.get("y") is not None:
        return int(loc["x"]), int(loc["y"])
    return None


def attacking_team(round_index: int) -> str:
    """Red attacks first; sides swap at round 12 and every round in overtime."""
    if round_index < 12:
        return "Red"
    if round_index < 24:
        return "Blue"
    return "Red" if (round_index - 24) % 2 == 0 else "Blue"


def _t(kill: dict) -> int:
    for key in ("roundTime", "timeSinceRoundStartMillis", "gameTime", "timeSinceGameStartMillis"):
        if kill.get(key) is not None:
            return int(kill[key])
    return 0


def _low(value) -> str:
    return value.lower() if isinstance(value, str) else ""


def queue_of(info: dict) -> str:
    if info.get("provisioningFlowID") == "CustomGame":
        return "custom"
    queue = _low(info.get("queueID"))
    if queue:
        return queue
    mode = _low(info.get("gameMode"))
    if "deathmatch" in mode:
        return "deathmatch"
    if "hurm" in mode:
        return "hurm"
    return "unrated"


def parse_match(data: dict, puuid: str, weapon_ids: set[str], known_players: dict | None = None) -> dict | None:
    """Build a v2 match record for ``puuid``. Returns None for custom games or if the player isn't found."""
    puuid = puuid.lower()
    info = data.get("matchInfo") or {}
    queue = queue_of(info)
    if queue == "custom":
        return None

    players = [p for p in data.get("players") or [] if p.get("subject")]
    me = next((p for p in players if _low(p["subject"]) == puuid), None)
    if not me:
        return None

    team_of = {_low(p["subject"]): p.get("teamId") for p in players}
    my_team = me.get("teamId")
    teams = data.get("teams") or []
    mine = next((t for t in teams if t.get("teamId") == my_team), {})
    others = [t for t in teams if t.get("teamId") != my_team]

    score_key = "roundsWon"
    if not any(t.get("roundsWon") for t in teams) and any(t.get("numPoints") for t in teams):
        score_key = "numPoints"
    my_score = int(mine.get(score_key) or 0)
    enemy_score = max((int(t.get(score_key) or 0) for t in others), default=0)
    won = bool(mine.get("won"))
    if won:
        result = "win"
    elif others and not any(t.get("won") for t in others) and my_score == enemy_score:
        result = "draw"
    else:
        result = "loss"

    stats = me.get("stats") or {}
    rounds = data.get("roundResults") or []
    n_rounds = len(rounds) or int(stats.get("roundsPlayed") or 0)
    team_mode = len({t for t in team_of.values() if t and t != "Neutral"}) == 2

    hs = body = legs = damage = kast = fb = fd = plants = defuses = 0
    multikills: Counter = Counter()
    clutches: Counter = Counter()
    weapon_kills: Counter = Counter()
    sided = queue in SIDED_QUEUES and team_mode
    sides = {"atk": [0, 0], "def": [0, 0]}  # [won, played]
    pistols = [0, 0]
    opening = {"fb": 0, "fb_won": 0, "fd": 0, "fd_won": 0}  # rounds won after I got / gave the first kill
    round_log: list = []  # [won, side a/d, my team buy, enemy buy, my loadout value, my credits spent]
    kill_pos: list = []
    death_pos: list = []
    spent = 0

    for idx, rd in enumerate(rounds):
        kills = []
        for ps in rd.get("playerStats") or []:
            kills.extend(ps.get("kills") or [])
            if _low(ps.get("subject")) != puuid:
                continue
            for d in ps.get("damage") or []:
                if team_mode and team_of.get(_low(d.get("receiver"))) == my_team:
                    continue  # team damage
                damage += int(d.get("damage") or 0)
                hs += int(d.get("headshots") or 0)
                body += int(d.get("bodyshots") or 0)
                legs += int(d.get("legshots") or 0)
        kills.sort(key=_t)

        my_kills = [k for k in kills if _low(k.get("killer")) == puuid]
        assisted = any(puuid in {_low(a) for a in k.get("assistants") or []} for k in kills)
        death = next((k for k in kills if _low(k.get("victim")) == puuid), None)
        traded = bool(death) and any(
            _low(k.get("victim")) == _low(death.get("killer"))
            and team_of.get(_low(k.get("killer"))) == my_team
            and 0 <= _t(k) - _t(death) <= TRADE_WINDOW_MS
            for k in kills
        )
        if my_kills or assisted or not death or traded:
            kast += 1
        won_round = rd.get("winningTeam") == my_team
        if kills and team_mode:
            if _low(kills[0].get("killer")) == puuid:
                fb += 1
                opening["fb"] += 1
                opening["fb_won"] += won_round
            if _low(kills[0].get("victim")) == puuid:
                fd += 1
                opening["fd"] += 1
                opening["fd_won"] += won_round
        number = int(rd.get("roundNum", idx))
        side_key = ""
        if team_mode:
            role = rd.get("winningTeamRole")
            i_attack = None
            if role in ("Attacker", "Defender"):
                # Riot tells us the winner's role: we attacked if we won as attacker or lost to defenders.
                i_attack = (role == "Attacker") == won_round
            elif sided:
                planter = _low(rd.get("bombPlanter"))
                attackers = team_of[planter] if planter in team_of else attacking_team(number)
                i_attack = attackers == my_team
            if i_attack is not None:
                side_key = "atk" if i_attack else "def"
                sides[side_key][0] += won_round
                sides[side_key][1] += 1
        if sided and number in (0, 12):
            pistols[0] += won_round
            pistols[1] += 1

        # Economy: team buys from the players' loadout values at the start of the round.
        if team_mode:
            values = {"mine": [], "theirs": []}
            my_eco = None
            for ps in rd.get("playerStats") or []:
                eco = ps.get("economy") or {}
                subject = _low(ps.get("subject"))
                if subject not in team_of or eco.get("loadoutValue") is None:
                    continue
                values["mine" if team_of[subject] == my_team else "theirs"].append(int(eco["loadoutValue"]))
                if subject == puuid:
                    my_eco = eco
            if values["mine"] and values["theirs"]:
                avg = {k: sum(v) / len(v) for k, v in values.items()}
                round_log.append([
                    int(won_round), side_key[:1],
                    buy_type(number, avg["mine"], sided), buy_type(number, avg["theirs"], sided),
                    int((my_eco or {}).get("loadoutValue") or 0), int((my_eco or {}).get("spent") or 0),
                ])
            if my_eco:
                spent += int(my_eco.get("spent") or 0)

        # Positions (game coordinates) of my kills and deaths: [my_x, my_y, other_x, other_y, round, side, second]
        for k in kills:
            killer, victim = _low(k.get("killer")), _low(k.get("victim"))
            if puuid not in (killer, victim):
                continue
            locs = {_low(p.get("subject")): _xy(p.get("location")) for p in k.get("playerLocations") or []}
            victim_at = _xy(k.get("victimLocation"))
            if killer == puuid and killer != victim and locs.get(puuid) and victim_at:
                kill_pos.append([*locs[puuid], *victim_at, number, side_key[:1], _t(k) // 1000])
            elif victim == puuid and victim_at:
                killer_at = locs.get(killer) or victim_at
                death_pos.append([*victim_at, *killer_at, number, side_key[:1], _t(k) // 1000])
        if len(my_kills) >= 3:
            multikills[str(min(len(my_kills), 5))] += 1
        if _low(rd.get("bombPlanter")) == puuid:
            plants += 1
        if _low(rd.get("bombDefuser")) == puuid:
            defuses += 1

        for k in my_kills:
            finishing = k.get("finishingDamage") or {}
            item = _low(finishing.get("damageItem"))
            if finishing.get("damageType") == "Melee":
                weapon_kills[WEAPON_MELEE] += 1
            elif item in weapon_ids:
                weapon_kills[item] += 1

        # Clutch: my team won the round after I was left alone against >= 1 enemy.
        if team_mode and rd.get("winningTeam") == my_team:
            alive = {p for p, t in team_of.items() if t and t != "Neutral"}
            for k in kills:
                alive.discard(_low(k.get("victim")))
                allies = {p for p in alive if team_of[p] == my_team}
                if allies == {puuid}:
                    enemies = sum(1 for p in alive if team_of[p] != my_team)
                    if enemies:
                        clutches[str(enemies)] += 1
                    break

    known_players = known_players or {}
    scoreboard = []
    for p in players:
        if p.get("teamId") == "Neutral":
            continue
        pid = _low(p["subject"])
        ps = p.get("stats") or {}
        rounds_played = int(ps.get("roundsPlayed") or n_rounds or 1)
        name = f"{p['gameName']}#{p.get('tagLine', '')}" if p.get("gameName") else ""
        known = known_players.get(pid) or {}
        scoreboard.append({
            "puuid": pid,
            "name": name or known.get("name") or "",
            "agent": _low(p.get("characterId")),
            "team": p.get("teamId"),
            "party": p.get("partyId") or "",
            "rank_id": int(p.get("competitiveTier") or 0) or int(known.get("rank_id") or 0),
            "level": int(p.get("accountLevel") or 0),
            "kills": int(ps.get("kills") or 0),
            "deaths": int(ps.get("deaths") or 0),
            "assists": int(ps.get("assists") or 0),
            "score": int(ps.get("score") or 0),
            "acs": round(int(ps.get("score") or 0) / max(rounds_played, 1)),
            "is_me": pid == puuid,
        })

    hits = hs + body + legs
    rounds_div = max(n_rounds, 1)
    return {
        "v": MATCH_VERSION,
        "queue": queue,
        "map_id": info.get("mapId", ""),
        "season": _low(info.get("seasonId")),
        "start": int(info.get("gameStartMillis") or 0),
        "duration": int(info.get("gameLengthMillis") or 0),
        "ranked": bool(info.get("isRanked")),
        "completion": info.get("completionState") or "",
        "agent": _low(me.get("characterId")),
        "team": my_team,
        "result": result,
        "won": won,
        "my_score": my_score,
        "enemy_score": enemy_score,
        "rounds": n_rounds,
        "kills": int(stats.get("kills") or 0),
        "deaths": int(stats.get("deaths") or 0),
        "assists": int(stats.get("assists") or 0),
        "score": int(stats.get("score") or 0),
        "acs": round(int(stats.get("score") or 0) / rounds_div),
        "damage": damage,
        "adr": round(damage / rounds_div),
        "kast": round(kast / rounds_div * 100) if rounds else None,
        "headshots": hs,
        "bodyshots": body,
        "legshots": legs,
        "hs_percent": round(hs / hits * 100) if hits else 0,
        "first_bloods": fb,
        "first_deaths": fd,
        "plants": plants,
        "defuses": defuses,
        "multikills": dict(multikills),
        "clutches": dict(clutches),
        "sides": sides if sides["atk"][1] + sides["def"][1] else None,
        "pistols": pistols if sided else None,
        "opening": opening if team_mode else None,
        "round_log": round_log or None,
        "spent": spent,
        "positions": {"kills": kill_pos, "deaths": death_pos} if team_mode else None,
        "weapon_kills": dict(weapon_kills),
        "scoreboard": scoreboard,
    }


# ---------------------------------------------------------------------- loadouts
def parse_own_loadout(data: dict) -> dict:
    """personalization playerloadout -> {weapon_id: {skin, chroma}}"""
    guns = {}
    for gun in (data or {}).get("Guns") or []:
        if gun.get("ID") and gun.get("SkinID"):
            guns[gun["ID"].lower()] = {"skin": gun["SkinID"].lower(), "chroma": _low(gun.get("ChromaID"))}
    return guns


def extract_item_skins(items: dict, skin_ids: set[str] | None = None) -> dict:
    """Live loadout ``Items`` (sockets format) -> {weapon_id: {skin, chroma}}"""
    guns = {}
    for wid, item in (items or {}).items():
        sockets = {_low(k): v for k, v in ((item or {}).get("Sockets") or {}).items()}
        skin = _low(((sockets.get(SOCKET_SKIN) or {}).get("Item") or {}).get("ID"))
        if not skin and skin_ids:
            skin = next((_low((s.get("Item") or {}).get("ID")) for s in sockets.values()
                         if _low((s.get("Item") or {}).get("ID")) in skin_ids), "")
        if skin:
            chroma = _low(((sockets.get(SOCKET_CHROMA) or {}).get("Item") or {}).get("ID"))
            guns[wid.lower()] = {"skin": skin, "chroma": chroma}
    return guns


def parse_live_loadouts(payload: dict, players: list[dict], skin_ids: set[str] | None = None) -> dict:
    """Map live loadouts to players. ``players`` items need ``puuid`` and ``agent``."""
    result = {}
    entries = (payload or {}).get("Loadouts") or []
    for i, entry in enumerate(entries):
        loadout = entry.get("Loadout") if isinstance(entry.get("Loadout"), dict) else entry
        subject = _low(loadout.get("Subject") or entry.get("Subject"))
        if not subject:
            char = _low(entry.get("CharacterID"))
            same = [p for p in players if char and p["agent"] == char]
            if len(same) == 1:
                subject = same[0]["puuid"]
            elif i < len(players):
                subject = players[i]["puuid"]
        if subject:
            result[subject] = extract_item_skins(loadout.get("Items") or {}, skin_ids)
    return result


# ---------------------------------------------------------------------- mmr
def parse_mmr(data: dict, current_season: str | None, season_starts: dict[str, int] | None = None) -> dict:
    """mmr/v1/players -> {tier, rr, peak, peak_season, act_games, act_wins}"""
    data = data or {}
    season_starts = season_starts or {}
    comp = ((data.get("QueueSkills") or {}).get("competitive") or {})
    seasons = comp.get("SeasonalInfoBySeasonID") or {}
    latest = data.get("LatestCompetitiveUpdate") or {}

    tier, rr, games, wins = 0, 0, 0, 0
    current = seasons.get(current_season) if current_season else None
    if current:
        tier = int(current.get("CompetitiveTier") or 0)
        rr = int(current.get("RankedRating") or 0)
        games = int(current.get("NumberOfGames") or 0)
        wins = int(current.get("NumberOfWinsWithPlacements") or current.get("NumberOfWins") or 0)
    elif latest and (not current_season or _low(latest.get("SeasonID")) == current_season):
        tier = int(latest.get("TierAfterUpdate") or 0)
        rr = int(latest.get("RankedRatingAfterUpdate") or 0)

    def modern(t: int, sid: str) -> int:
        start = season_starts.get(_low(sid))
        return t + 3 if t >= 21 and start is not None and start < ASCENDANT_RELEASE_MS else t

    peak, peak_season = 0, ""
    acts = []
    for sid, info in seasons.items():
        info = info or {}
        by_tier = info.get("WinsByTier") or {}
        best = modern(max((int(t) for t in by_tier if str(t).isdigit()), default=0), sid)
        if best > peak:
            peak, peak_season = best, _low(sid)
        played = int(info.get("NumberOfGames") or 0)
        if played:
            acts.append({
                "season": _low(sid),
                "tier": modern(int(info.get("CompetitiveTier") or 0), sid),
                "peak": best,
                "games": played,
                "wins": int(info.get("NumberOfWinsWithPlacements") or info.get("NumberOfWins") or 0),
                "start": season_starts.get(_low(sid)),
            })
    acts.sort(key=lambda a: a["start"] or 0)
    peak = max(peak, tier)
    return {"tier": tier, "rr": rr, "peak": peak, "peak_season": peak_season, "act_games": games, "act_wins": wins, "acts": acts}
