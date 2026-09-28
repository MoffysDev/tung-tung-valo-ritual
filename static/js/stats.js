// Pure aggregation functions over match records (unit-tested with `node --test`).

const DAY = 86400000;

export function sortByDate(matches) {
  return [...matches].sort((a, b) => (b.start || 0) - (a.start || 0));
}

export function filterMatches(matches, { queue = "all", period = "all", season = null } = {}, now = Date.now()) {
  return matches.filter((m) => {
    if (queue !== "all" && m.queue !== queue) return false;
    if (period === "act") return !!season && m.season === season;
    if (period !== "all") {
      const days = Number(period);
      if (days === 1) {
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        return (m.start || 0) >= today.getTime();
      }
      return (m.start || 0) >= now - days * DAY;
    }
    return true;
  });
}

const resultOf = (m) => m.result || (m.won ? "win" : "loss");

export function summarize(matches) {
  const s = {
    matches: matches.length, wins: 0, losses: 0, draws: 0,
    kills: 0, deaths: 0, assists: 0, rounds: 0, score: 0, scoreRounds: 0,
    damage: 0, damageRounds: 0, hs: 0, hits: 0, legacyHs: [], kastSum: 0, kastRounds: 0,
    playtime: 0, firstBloods: 0, firstDeaths: 0, plants: 0, defuses: 0,
    clutches: 0, aces: 0, multikills: 0, roundsWon: 0,
  };
  for (const m of matches) {
    const r = resultOf(m);
    if (r === "win") s.wins++;
    else if (r === "draw") s.draws++;
    else s.losses++;
    s.kills += m.kills || 0;
    s.deaths += m.deaths || 0;
    s.assists += m.assists || 0;
    s.playtime += m.duration || 0;
    const rounds = m.rounds || 0;
    s.rounds += rounds;
    s.roundsWon += m.my_score || 0;
    if (m.score != null && rounds) {
      s.score += m.score;
      s.scoreRounds += rounds;
    }
    if (m.v >= 2) {
      s.damage += m.damage || 0;
      s.damageRounds += rounds;
      s.hs += m.headshots || 0;
      s.hits += (m.headshots || 0) + (m.bodyshots || 0) + (m.legshots || 0);
      if (m.kast != null) { s.kastSum += m.kast * rounds; s.kastRounds += rounds; }
      s.firstBloods += m.first_bloods || 0;
      s.firstDeaths += m.first_deaths || 0;
      s.plants += m.plants || 0;
      s.defuses += m.defuses || 0;
      for (const [k, n] of Object.entries(m.clutches || {})) if (Number(k) >= 1) s.clutches += n;
      for (const [k, n] of Object.entries(m.multikills || {})) {
        s.multikills += n;
        if (Number(k) >= 5) s.aces += n;
      }
    } else if (m.hs_percent) {
      s.legacyHs.push(m.hs_percent);
    }
  }
  const decided = s.wins + s.losses;
  s.winrate = s.matches ? s.wins / Math.max(1, s.matches) : NaN;
  s.decidedWinrate = decided ? s.wins / decided : NaN;
  s.kd = s.deaths ? s.kills / s.deaths : s.kills || NaN;
  s.kda = s.deaths ? (s.kills + s.assists) / s.deaths : NaN;
  s.acs = s.scoreRounds ? s.score / s.scoreRounds : NaN;
  s.adr = s.damageRounds ? s.damage / s.damageRounds : NaN;
  s.hsRate = s.hits ? s.hs / s.hits : s.legacyHs.length ? s.legacyHs.reduce((a, b) => a + b, 0) / s.legacyHs.length / 100 : NaN;
  s.kast = s.kastRounds ? s.kastSum / s.kastRounds / 100 : NaN;
  s.killsPerMatch = s.matches ? s.kills / s.matches : NaN;
  delete s.legacyHs;
  return s;
}

function groupBy(matches, key) {
  const groups = new Map();
  for (const m of matches) {
    const k = key(m);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return groups;
}

/** Shrink a rate toward a prior so 1-match wonders don't top the charts. */
export const shrink = (value, n, prior, weight = 3) => (value * n + prior * weight) / (n + weight);

export function byAgent(matches) {
  const overall = summarize(matches);
  const rows = [...groupBy(matches, (m) => m.agent)].map(([id, list]) => ({ id, list, ...summarize(list) }));
  for (const r of rows) {
    const acs = Number.isFinite(r.acs) ? r.acs : overall.acs || 200;
    const wr = Number.isFinite(r.winrate) ? r.winrate : 0.5;
    r.perf = shrink(acs, r.matches, overall.acs || 200) * (0.5 + shrink(wr, r.matches, overall.winrate || 0.5));
  }
  return rows.sort((a, b) => b.matches - a.matches || b.perf - a.perf);
}

export function bestAgent(rows) {
  const pool = rows.filter((r) => r.matches >= 3);
  return [...(pool.length ? pool : rows)].sort((a, b) => b.perf - a.perf)[0] || null;
}

export function byMap(matches) {
  return [...groupBy(matches, (m) => m.map_id)]
    .map(([id, list]) => ({ id, ...summarize(list) }))
    .sort((a, b) => b.matches - a.matches);
}

export function weaponKills(matches) {
  const out = {};
  for (const m of matches) for (const [w, k] of Object.entries(m.weapon_kills || {})) out[w] = (out[w] || 0) + k;
  return out;
}

/**
 * Per-weapon, per-skin performance: {weaponId: {skinId: {kills, matches, wins, estimated}}}
 * v2 matches use their own loadout; v1 kills come from the legacy bucket (queue-filtered).
 */
export function skinStats(matches, legacy = {}, queue = "all") {
  const out = {};
  const add = (w, s, kills, matches, wins, estimated = 0) => {
    const e = ((out[w] ||= {})[s] ||= { kills: 0, matches: 0, wins: 0, estimated: 0 });
    e.kills += kills; e.matches += matches; e.wins += wins; e.estimated += estimated;
  };
  for (const m of matches) {
    if (!m.loadout || m.loadout_source === "legacy") continue;
    for (const [w, kills] of Object.entries(m.weapon_kills || {})) {
      const skin = m.loadout[w];
      if (!skin) continue;
      add(w, skin, kills, 1, resultOf(m) === "win" ? 1 : 0, m.loadout_source === "estimated" ? 1 : 0);
    }
  }
  for (const [w, skins] of Object.entries(legacy.skins || {})) {
    for (const [s, queues] of Object.entries(skins)) {
      for (const [q, st] of Object.entries(queues)) {
        if (queue === "all" || queue === q) add(w, s, st.kills || 0, st.matches || 0, st.wins || 0);
      }
    }
  }
  return out;
}

export function rankSkins(perSkin) {
  const entries = Object.entries(perSkin || {}).filter(([, s]) => s.kills > 0);
  const totalK = entries.reduce((a, [, s]) => a + s.kills, 0);
  const totalM = entries.reduce((a, [, s]) => a + s.matches, 0);
  const prior = totalM ? totalK / totalM : 0;
  return entries
    .map(([id, s]) => ({ id, ...s, kpm: s.matches ? s.kills / s.matches : 0, winrate: s.matches ? s.wins / s.matches : 0, score: shrink(s.matches ? s.kills / s.matches : 0, s.matches, prior) }))
    // Reliable samples (3+ matches) first, then by shrunk kills/match.
    .sort((a, b) => (b.matches >= 3) - (a.matches >= 3) || b.score - a.score || b.kills - a.kills);
}

export function highlights(matches) {
  let best = null;
  for (const m of matches) if (m.v >= 2 && (!best || (m.acs || 0) > (best.acs || 0))) best = m;
  let mostKills = null;
  for (const m of matches) if (!mostKills || (m.kills || 0) > (mostKills.kills || 0)) mostKills = m;
  let streak = 0, bestStreak = 0;
  for (const m of sortByDate(matches).reverse()) {
    streak = resultOf(m) === "win" ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }
  return { best, mostKills, bestStreak };
}

export function queuesPresent(matches) {
  const counts = {};
  for (const m of matches) counts[m.queue] = (counts[m.queue] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([q]) => q);
}

/** Matches with a given player (encounters), newest first. */
export function withPlayer(matches, puuid) {
  return sortByDate(matches.filter((m) => (m.scoreboard || []).some((p) => p.puuid === puuid && !p.is_me)));
}
