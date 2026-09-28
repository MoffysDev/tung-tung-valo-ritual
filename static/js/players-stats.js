// Players you've shared matches with (pure, unit-tested).

const resultOf = (m) => m.result || (m.won ? "win" : "loss");

/**
 * Everyone from your scoreboards, keyed by puuid. `known` are the names/ranks collected in live games.
 */
export function encounteredPlayers(matches, known = {}) {
  const out = new Map();
  for (const m of matches) {
    const board = m.scoreboard || [];
    const me = board.find((p) => p.is_me);
    if (!me) continue;
    for (const p of board) {
      if (p.is_me || !p.puuid) continue;
      let e = out.get(p.puuid);
      if (!e) {
        e = { puuid: p.puuid, name: "", count: 0, with: 0, against: 0, winsWith: 0, winsAgainst: 0, last: 0,
          agents: {}, kills: 0, deaths: 0, score: 0, rounds: 0, rank: 0, rankAt: 0, matchIds: [] };
        out.set(p.puuid, e);
      }
      const ally = p.team === me.team;
      const won = resultOf(m) === "win";
      e.count++;
      if (ally) { e.with++; e.winsWith += won; } else { e.against++; e.winsAgainst += won; }
      e.agents[p.agent] = (e.agents[p.agent] || 0) + 1;
      e.kills += p.kills || 0;
      e.deaths += p.deaths || 0;
      e.score += p.score || 0;
      e.rounds += m.rounds || 0;
      if ((m.start || 0) >= e.rankAt && p.rank_id) { e.rank = p.rank_id; e.rankAt = m.start || 0; }
      if (p.name && (m.start || 0) >= e.last) e.name = p.name;
      e.last = Math.max(e.last, m.start || 0);
      e.matchIds.push(m.id);
    }
  }
  for (const e of out.values()) {
    const k = known[e.puuid];
    if (k?.name && !e.name) e.name = k.name;
    if (k?.rank_id && !e.rank) e.rank = k.rank_id;
    e.kd = e.deaths ? e.kills / e.deaths : e.kills;
    e.acs = e.rounds ? e.score / e.rounds : NaN;
    e.wrWith = e.with ? e.winsWith / e.with : NaN;
    e.wrAgainst = e.against ? e.winsAgainst / e.against : NaN; // your winrate when facing them
    e.mainAgent = Object.entries(e.agents).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }
  return [...out.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
