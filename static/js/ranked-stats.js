// Competitive analytics: hidden-MMR estimate, RR, sides, parties, sessions and tips.
// Pure functions (no DOM), unit-tested with `node --test`.
//
// "Points" put every rank on one scale: tier * 100 + RR (e.g. Platinum 2 at 40 RR = 16 * 100 + 40 = 1640).

import { summarize } from "./stats.js";

const resultOf = (m) => m.result || (m.won ? "win" : "loss");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const points = (tier, rr = 0) => tier * 100 + rr;

/** Competitive matches, oldest first. */
export function competitive(matches) {
  return matches.filter((m) => m.queue === "competitive").sort((a, b) => (a.start || 0) - (b.start || 0));
}

/** Average rank of the other 9 players (ranked ones only), as points in the middle of their division. */
export function lobbyPoints(m) {
  const tiers = (m.scoreboard || []).filter((p) => !p.is_me && (p.rank_id || 0) >= 3).map((p) => p.rank_id);
  return tiers.length >= 3 ? mean(tiers) * 100 + 50 : NaN;
}

/** Your displayed rank after the match, in points. */
export function visibleAfter(m) {
  return m.rr ? points(m.rr.tier_after, m.rr.after) : NaN;
}

// ------------------------------------------------------------------ RR
export function rrStats(comp) {
  const withRr = comp.filter((m) => m.rr);
  const gains = withRr.filter((m) => resultOf(m) === "win").map((m) => m.rr.earned);
  const losses = withRr.filter((m) => resultOf(m) === "loss").map((m) => m.rr.earned);
  let best = null, worst = null;
  for (const m of withRr) {
    if (!best || m.rr.earned > best.rr.earned) best = m;
    if (!worst || m.rr.earned < worst.rr.earned) worst = m;
  }
  // Streaks (oldest -> newest)
  let cur = { type: null, len: 0 }, longestWin = 0, longestLoss = 0;
  for (const m of comp) {
    const r = resultOf(m);
    if (r === "draw") { cur = { type: null, len: 0 }; continue; }
    cur = cur.type === r ? { type: r, len: cur.len + 1 } : { type: r, len: 1 };
    if (r === "win") longestWin = Math.max(longestWin, cur.len);
    else longestLoss = Math.max(longestLoss, cur.len);
  }
  return {
    matches: withRr.length,
    avgGain: mean(gains),
    avgLoss: mean(losses),
    net: withRr.reduce((a, m) => a + m.rr.earned, 0),
    best, worst,
    streak: cur, longestWin, longestLoss,
    gains: gains.length, losses: losses.length,
  };
}

// ------------------------------------------------------------------ hidden MMR
/**
 * Estimate hidden MMR from two signals:
 *  1. lobby strength: matchmaking uses MMR, so the average rank of the other players tracks it;
 *  2. RR asymmetry: winning more RR than you lose means MMR above your rank (and vice versa).
 * Returns null when there is no competitive data.
 */
export function estimateMmr(comp, { window = 20 } = {}) {
  const recent = comp.filter((m) => m.rr || Number.isFinite(lobbyPoints(m))).slice(-window);
  if (!recent.length) return null;

  // Match-by-match series: exponentially weighted lobby average (recent games weigh more).
  const series = [];
  let ewma = NaN;
  for (const m of comp) {
    const lobby = lobbyPoints(m);
    if (Number.isFinite(lobby)) ewma = Number.isFinite(ewma) ? ewma * 0.7 + lobby * 0.3 : lobby;
    series.push({ id: m.id, start: m.start, result: resultOf(m), earned: m.rr?.earned ?? null,
      visible: visibleAfter(m), lobby, mmr: ewma, agent: m.agent, map: m.map_id });
  }

  const last = [...comp].reverse().find((m) => m.rr);
  const visible = last ? visibleAfter(last) : NaN;
  const rr = rrStats(recent);
  const decided = rr.gains + rr.losses;
  // Each RR of asymmetry between wins and losses ≈ 8 points of MMR gap (heuristic, capped).
  const asym = decided >= 4 && Number.isFinite(rr.avgGain) && Number.isFinite(rr.avgLoss) ? rr.avgGain + rr.avgLoss : NaN;
  const offset = Number.isFinite(asym) ? clamp(asym * 8, -250, 250) : 0;
  const lobbies = recent.map(lobbyPoints).filter(Number.isFinite);
  const lobbyNow = series.length ? series[series.length - 1].mmr : NaN;

  let estimate;
  if (Number.isFinite(lobbyNow) && Number.isFinite(visible)) estimate = 0.65 * lobbyNow + 0.35 * (visible + offset);
  else if (Number.isFinite(lobbyNow)) estimate = lobbyNow;
  else estimate = visible + offset;

  const diff = estimate - visible;
  const spread = lobbies.length > 1 ? Math.sqrt(mean(lobbies.map((l) => (l - mean(lobbies)) ** 2))) : 200;
  // Capped at 90 %: this is an estimate, never the real hidden value.
  const confidence = clamp((Math.min(lobbies.length, 20) / 20) * 0.7 + (decided >= 4 ? 0.2 : 0) - clamp((spread - 150) / 600, 0, 0.3), 0, 0.9);

  return {
    estimate, visible, diff,
    verdict: !Number.isFinite(diff) ? "inconnu" : diff > 40 ? "au-dessus" : diff < -40 ? "en dessous" : "aligné",
    lobby: mean(lobbies), lobbyNow, asym, offset,
    avgGain: rr.avgGain, avgLoss: rr.avgLoss,
    matches: recent.length, withLobby: lobbies.length,
    confidence, confidenceLabel: confidence >= 0.7 ? "Élevée" : confidence >= 0.4 ? "Moyenne" : "Faible",
    series,
  };
}

// ------------------------------------------------------------------ rounds
export function roundStats(matches) {
  const out = { atk: [0, 0], def: [0, 0], pistols: [0, 0], fb: 0, fbWon: 0, fd: 0, fdWon: 0, matches: 0 };
  for (const m of matches) {
    if (m.sides) {
      out.matches++;
      out.atk[0] += m.sides.atk[0]; out.atk[1] += m.sides.atk[1];
      out.def[0] += m.sides.def[0]; out.def[1] += m.sides.def[1];
    }
    if (m.pistols) { out.pistols[0] += m.pistols[0]; out.pistols[1] += m.pistols[1]; }
    if (m.opening) {
      out.fb += m.opening.fb; out.fbWon += m.opening.fb_won;
      out.fd += m.opening.fd; out.fdWon += m.opening.fd_won;
    }
  }
  const rate = ([w, p]) => (p ? w / p : NaN);
  return { ...out, atkRate: rate(out.atk), defRate: rate(out.def), pistolRate: rate(out.pistols),
    fbConv: out.fb ? out.fbWon / out.fb : NaN, fdConv: out.fd ? out.fdWon / out.fd : NaN };
}

// ------------------------------------------------------------------ parties
export function partySize(m) {
  const board = m.scoreboard || [];
  const me = board.find((p) => p.is_me);
  if (!me || !me.party) return 0;
  return board.filter((p) => p.team === me.team && p.party === me.party).length;
}

export function partyStats(matches) {
  const groups = { 1: [], 2: [], 3: [], 5: [] };
  for (const m of matches) {
    const n = partySize(m);
    if (n) groups[n >= 4 ? 5 : n].push(m);
  }
  return [
    { key: "solo", label: "Solo", list: groups[1] },
    { key: "duo", label: "Duo", list: groups[2] },
    { key: "trio", label: "Trio", list: groups[3] },
    { key: "stack", label: "Groupe (4-5)", list: groups[5] },
  ].map((g) => ({ ...g, ...summarize(g.list), rr: g.list.reduce((a, m) => a + (m.rr?.earned || 0), 0) }));
}

// ------------------------------------------------------------------ sessions & tilt
const SESSION_GAP = 60 * 60 * 1000;

export function sessions(comp) {
  const out = [];
  let cur = null;
  for (const m of comp) {
    if (!cur || (m.start || 0) - cur.end > SESSION_GAP) {
      cur = { start: m.start, end: 0, matches: [] };
      out.push(cur);
    }
    cur.matches.push(m);
    cur.end = (m.start || 0) + (m.duration || 40 * 60000);
  }
  return out.map((s) => ({ ...s, net: s.matches.reduce((a, m) => a + (m.rr?.earned || 0), 0),
    wins: s.matches.filter((m) => resultOf(m) === "win").length }));
}

function wr(list) {
  const decided = list.filter((m) => resultOf(m) !== "draw");
  return { games: decided.length, wins: decided.filter((m) => resultOf(m) === "win").length,
    rate: decided.length ? decided.filter((m) => resultOf(m) === "win").length / decided.length : NaN,
    rr: list.reduce((a, m) => a + (m.rr?.earned || 0), 0) };
}

export function tiltStats(comp) {
  const afterWin = [], afterLoss = [], afterTwoLosses = [];
  const byIndex = [[], [], [], []];
  for (const s of sessions(comp)) {
    s.matches.forEach((m, i) => {
      byIndex[Math.min(i, 3)].push(m);
      if (!i) return;
      const prev = resultOf(s.matches[i - 1]);
      if (prev === "win") afterWin.push(m);
      if (prev === "loss") afterLoss.push(m);
      if (i >= 2 && prev === "loss" && resultOf(s.matches[i - 2]) === "loss") afterTwoLosses.push(m);
    });
  }
  const buckets = [
    { label: "Matin", test: (h) => h >= 6 && h < 12 },
    { label: "Après-midi", test: (h) => h >= 12 && h < 18 },
    { label: "Soirée", test: (h) => h >= 18 && h < 23 },
    { label: "Nuit", test: (h) => h >= 23 || h < 6 },
  ].map((b) => ({ label: b.label, ...wr(comp.filter((m) => m.start && b.test(new Date(m.start).getHours()))) }));
  return {
    afterWin: wr(afterWin), afterLoss: wr(afterLoss), afterTwoLosses: wr(afterTwoLosses),
    byIndex: byIndex.map((list, i) => ({ label: i === 3 ? "4e partie et +" : `${i + 1}${i ? "e" : "re"} partie`, ...wr(list) })),
    byHour: buckets,
  };
}

// ------------------------------------------------------------------ tips
/** Plain-language tips, most important first. `maps`/`agents` are byMap/byAgent rows. */
export function insights({ mmr, rr, rounds, tilt, parties, maps = [], agents = [], overall }) {
  const tips = [];
  const add = (level, title, text, weight) => tips.push({ level, title, text, weight });
  const pct = (v) => `${Math.round(v * 100)} %`;

  if (mmr && mmr.verdict === "au-dessus") add("good", "Ton MMR tire vers le haut", `Tes lobbies et tes gains de RR indiquent un MMR au-dessus de ton rang : chaque victoire rapporte plus. Continue, tu devrais monter vite.`, 90);
  if (mmr && mmr.verdict === "en dessous") add("warn", "Ton MMR est sous ton rang", `Tu perds plus de RR que tu n'en gagnes (${Math.round(mmr.avgGain)} / ${Math.round(mmr.avgLoss)}). Une série de victoires rééquilibrera les gains : vise la régularité plutôt que le volume de parties.`, 95);

  if (tilt.afterLoss.games >= 5 && tilt.afterWin.games >= 3 && tilt.afterLoss.rate < tilt.afterWin.rate - 0.12)
    add("warn", "Attention au tilt", `Après une défaite tu gagnes ${pct(tilt.afterLoss.rate)} de tes parties, contre ${pct(tilt.afterWin.rate)} après une victoire. Fais une pause après une défaite frustrante.`, 85);
  if (tilt.afterTwoLosses.games >= 3 && tilt.afterTwoLosses.rate < 0.4)
    add("warn", "Stop après 2 défaites", `Après deux défaites d'affilée, ton winrate tombe à ${pct(tilt.afterTwoLosses.rate)} (${tilt.afterTwoLosses.rr > 0 ? "+" : ""}${tilt.afterTwoLosses.rr} RR). C'est le moment de couper.`, 88);
  const late = tilt.byIndex[3], first = tilt.byIndex[0];
  if (late.games >= 4 && first.games >= 4 && late.rate < first.rate - 0.15)
    add("warn", "Sessions trop longues", `Ton winrate passe de ${pct(first.rate)} en début de session à ${pct(late.rate)} à partir de la 4e partie. Limite-toi à 3 parties classées d'affilée.`, 70);

  const bestHour = [...tilt.byHour].filter((b) => b.games >= 4).sort((a, b) => b.rate - a.rate);
  if (bestHour.length >= 2 && bestHour[0].rate - bestHour[bestHour.length - 1].rate > 0.2)
    add("info", "Ton meilleur créneau", `${bestHour[0].label} : ${pct(bestHour[0].rate)} de victoires, contre ${pct(bestHour[bestHour.length - 1].rate)} en ${bestHour[bestHour.length - 1].label.toLowerCase()}.`, 50);

  if (rounds.atk[1] >= 40 && rounds.def[1] >= 40) {
    if (rounds.atkRate < rounds.defRate - 0.08) add("warn", "Travaille ton attaque", `Tu gagnes ${pct(rounds.atkRate)} des rounds en attaque contre ${pct(rounds.defRate)} en défense. Revois tes exécutions et ton utilitaire d'entrée.`, 65);
    if (rounds.defRate < rounds.atkRate - 0.08) add("warn", "Travaille ta défense", `Tu gagnes ${pct(rounds.defRate)} des rounds en défense contre ${pct(rounds.atkRate)} en attaque. Revois tes placements et tes rotations.`, 65);
  }
  if (rounds.pistols[1] >= 8 && rounds.pistolRate < 0.4) add("warn", "Rounds pistol", `Seulement ${pct(rounds.pistolRate)} de pistols gagnés. Un pistol perdu coûte souvent 3 rounds : entraîne-toi au Classic/Ghost et prépare un plan pour chaque carte.`, 60);
  if (rounds.fd >= 15 && overall.firstDeaths > overall.firstBloods * 1.4)
    add("warn", "Trop de premières morts", `${overall.firstDeaths} first deaths pour ${overall.firstBloods} first bloods. Ton équipe ne gagne que ${pct(rounds.fdConv)} des rounds où tu meurs en premier : joue plus en retrait ou avec un trade.`, 75);
  if (rounds.fb >= 15 && rounds.fbConv >= 0.65) add("good", "Ton entry fait gagner", `Quand tu fais le premier kill, ton équipe gagne ${pct(rounds.fbConv)} des rounds. Continue à prendre ces duels.`, 40);

  const solo = parties.find((p) => p.key === "solo"), duo = parties.find((p) => p.key === "duo");
  if (solo && duo && solo.matches >= 4 && duo.matches >= 4 && Math.abs(solo.winrate - duo.winrate) > 0.15)
    add("info", duo.winrate > solo.winrate ? "Joue en duo" : "Tu es meilleur en solo",
      `Solo : ${pct(solo.winrate)} de victoires (${solo.rr > 0 ? "+" : ""}${solo.rr} RR). Duo : ${pct(duo.winrate)} (${duo.rr > 0 ? "+" : ""}${duo.rr} RR).`, 55);

  const reliableMaps = maps.filter((r) => r.matches >= 3);
  if (reliableMaps.length >= 2) {
    const sorted = [...reliableMaps].sort((a, b) => b.winrate - a.winrate);
    const bestMap = sorted[0], worstMap = sorted[sorted.length - 1];
    if (worstMap.winrate <= 0.35) add("warn", `Carte à travailler : ${worstMap.name}`, `${pct(worstMap.winrate)} de victoires sur ${worstMap.matches} matchs. Regarde des guides de setups sur cette carte ou utilise ton dodge.`, 58);
    if (bestMap.winrate >= 0.6) add("good", `Ta meilleure carte : ${bestMap.name}`, `${pct(bestMap.winrate)} de victoires sur ${bestMap.matches} matchs.`, 35);
  }
  const reliableAgents = agents.filter((r) => r.matches >= 3).sort((a, b) => b.perf - a.perf);
  if (reliableAgents.length >= 2) add("info", `Ton agent le plus rentable : ${reliableAgents[0].name}`, `${pct(reliableAgents[0].winrate)} de victoires, ${Math.round(reliableAgents[0].acs)} ACS de moyenne sur ${reliableAgents[0].matches} matchs.`, 45);

  if (rr.streak.type === "loss" && rr.streak.len >= 3) add("warn", `${rr.streak.len} défaites d'affilée en cours`, "Pause conseillée avant la prochaine classée : un Deathmatch ou un peu de Range pour te remettre dedans.", 99);
  if (rr.streak.type === "win" && rr.streak.len >= 3) add("good", `${rr.streak.len} victoires d'affilée en cours`, "Tu es en forme, c'est le moment de jouer.", 80);

  return tips.sort((a, b) => b.weight - a.weight);
}

// ------------------------------------------------------------------ economy
export const BUYS = [
  { key: "pistol", label: "Rounds pistol" },
  { key: "eco", label: "Éco" },
  { key: "force", label: "Force-buy" },
  { key: "full", label: "Full buy" },
];

/** Round win rate by your team's buy, plus the classic "lost vs an eco" leak. */
export function economyStats(matches) {
  const by = Object.fromEntries(BUYS.map((b) => [b.key, [0, 0]]));
  const antiEco = [0, 0]; // [lost, played] full buy vs enemy eco
  const bonus = [0, 0];   // our eco/force against their full buy: [won, played]
  let spent = 0, kills = 0, rounds = 0;
  for (const m of matches) {
    if (!m.round_log) continue;
    rounds += m.round_log.length;
    spent += m.spent || 0;
    kills += m.kills || 0;
    for (const [won, , mine, theirs] of m.round_log) {
      by[mine][0] += won;
      by[mine][1] += 1;
      if (mine === "full" && theirs === "eco") { antiEco[0] += 1 - won; antiEco[1] += 1; }
      if ((mine === "eco" || mine === "force") && theirs === "full") { bonus[0] += won; bonus[1] += 1; }
    }
  }
  return {
    rounds,
    buys: BUYS.map((b) => ({ ...b, won: by[b.key][0], played: by[b.key][1], rate: by[b.key][1] ? by[b.key][0] / by[b.key][1] : NaN })),
    antiEco: { lost: antiEco[0], played: antiEco[1], rate: antiEco[1] ? antiEco[0] / antiEco[1] : NaN },
    upsets: { won: bonus[0], played: bonus[1], rate: bonus[1] ? bonus[0] / bonus[1] : NaN },
    creditsPerKill: kills ? spent / kills : NaN,
    creditsPerRound: rounds ? spent / rounds : NaN,
  };
}

// ------------------------------------------------------------------ rank goal
/**
 * How far is the target rank, and how many games at the current pace.
 * `targetTier` is a tier number (e.g. 18 = Diamond 1), `visible` your current points.
 */
export function rankGoal(comp, visible, targetTier) {
  const needed = targetTier * 100 - visible;
  const recent = comp.filter((m) => m.rr && (m.result || (m.won ? "win" : "loss")) !== "draw").slice(-20);
  const wins = recent.filter((m) => (m.result || (m.won ? "win" : "loss")) === "win");
  const losses = recent.filter((m) => (m.result || (m.won ? "win" : "loss")) === "loss");
  const gain = wins.length ? mean(wins.map((m) => m.rr.earned)) : 20;
  const loss = losses.length ? mean(losses.map((m) => m.rr.earned)) : -20;
  const wr = recent.length ? wins.length / recent.length : 0.5;
  const perGame = wr * gain + (1 - wr) * loss;
  const breakEven = -loss / (gain - loss); // winrate that keeps you flat
  return {
    needed, reached: needed <= 0, sample: recent.length,
    gain, loss, winrate: wr, perGame, breakEven,
    games: needed <= 0 ? 0 : perGame > 0.5 ? Math.ceil(needed / perGame) : Infinity,
    // Winrate needed to get there within 50 games
    wrFor50: needed > 0 ? clamp((needed / 50 - loss) / (gain - loss), 0, 1) : 0,
  };
}
