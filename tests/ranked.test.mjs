// Run with: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { competitive, estimateMmr, insights, lobbyPoints, partySize, partyStats, roundStats, rrStats, sessions, tiltStats } from "../static/js/ranked-stats.js";
import { summarize } from "../static/js/stats.js";

const H = 3600000;
let t = 0;
function match({ result = "win", earned = 20, tier = 15, after = 50, lobby = 15, party = "", mates = 0, start, sides, pistols, opening } = {}) {
  t += 45 * 60000;
  const board = [{ puuid: "me", is_me: true, team: "Blue", party, rank_id: tier }];
  for (let i = 0; i < 9; i++) board.push({ puuid: `p${i}`, team: i < 4 ? "Blue" : "Red", party: i < mates ? party : `x${i}`, rank_id: lobby });
  return { id: `m${t}`, v: 3, queue: "competitive", result, won: result === "win", start: start ?? t, duration: 40 * 60000,
    kills: 10, deaths: 10, rounds: 20, score: 4000, rr: { earned, after, tier_after: tier, tier_before: tier }, scoreboard: board, sides, pistols, opening };
}

test("lobby points ignore unranked players and need 3 ranked", () => {
  const m = match({ lobby: 16 });
  assert.equal(lobbyPoints(m), 1650);
  m.scoreboard.forEach((p, i) => { if (i > 2) p.rank_id = 0; });
  assert.ok(Number.isNaN(lobbyPoints(m)));
});

test("MMR above rank when lobbies are higher and wins pay more", () => {
  const comp = Array.from({ length: 12 }, (_, i) => match({ result: i % 2 ? "loss" : "win", earned: i % 2 ? -14 : 26, lobby: 17, tier: 15, after: 50 }));
  const mmr = estimateMmr(comp);
  assert.equal(mmr.visible, 1550);
  assert.ok(mmr.estimate > mmr.visible + 40, `estimate ${mmr.estimate}`);
  assert.equal(mmr.verdict, "au-dessus");
  assert.equal(mmr.series.length, 12);
  assert.ok(mmr.confidence > 0.4);
});

test("MMR below rank and aligned cases", () => {
  const low = Array.from({ length: 10 }, (_, i) => match({ result: i % 2 ? "loss" : "win", earned: i % 2 ? -26 : 14, lobby: 13, tier: 15, after: 50 }));
  assert.equal(estimateMmr(low).verdict, "en dessous");
  const even = Array.from({ length: 10 }, (_, i) => match({ result: i % 2 ? "loss" : "win", earned: i % 2 ? -20 : 20, lobby: 15, tier: 15, after: 50 }));
  assert.equal(estimateMmr(even).verdict, "aligné");
  assert.equal(estimateMmr([]), null);
});

test("rr stats and streaks", () => {
  const comp = [match({ earned: 20 }), match({ result: "loss", earned: -18 }), match({ earned: 22 }), match({ earned: 19 })];
  const s = rrStats(comp);
  assert.equal(s.net, 43);
  assert.equal(s.avgGain, 61 / 3);
  assert.equal(s.avgLoss, -18);
  assert.deepEqual(s.streak, { type: "win", len: 2 });
  assert.equal(s.longestWin, 2);
  assert.equal(s.best.rr.earned, 22);
});

test("rounds, parties and sessions", () => {
  const a = match({ sides: { atk: [5, 12], def: [8, 12] }, pistols: [1, 2], opening: { fb: 3, fb_won: 2, fd: 4, fd_won: 1 }, party: "p", mates: 1 });
  const b = match({ sides: { atk: [7, 10], def: [6, 12] }, pistols: [2, 2], opening: { fb: 1, fb_won: 1, fd: 0, fd_won: 0 } });
  const r = roundStats([a, b]);
  assert.deepEqual(r.atk, [12, 22]);
  assert.equal(r.pistolRate, 0.75);
  assert.equal(r.fbConv, 0.75);
  assert.equal(partySize(a), 2);
  assert.equal(partySize(b), 0); // no party id -> unknown
  const solo = match({ party: "solo" });
  assert.equal(partySize(solo), 1);
  assert.equal(partyStats([a, solo]).find((g) => g.key === "duo").matches, 1);

  const s1 = match({ start: 0 }), s2 = match({ start: 45 * 60000 }), s3 = match({ start: 10 * H });
  assert.equal(sessions([s1, s2, s3]).length, 2);
});

test("tilt stats and tips", () => {
  const comp = [];
  for (let i = 0; i < 6; i++) {
    const base = i * 10 * H;
    // Each session: L L L L W
    for (let j = 0; j < 5; j++) comp.push(match({ start: base + (j * H) / 2, result: j === 4 ? "win" : "loss", earned: j === 4 ? 20 : -20 }));
  }
  const tilt = tiltStats(comp);
  assert.equal(tilt.afterLoss.games, 24);
  assert.equal(tilt.afterTwoLosses.games, 18);
  assert.ok(tilt.afterTwoLosses.rate < 0.4);
  assert.equal(tilt.byIndex[3].games, 12);
  const tips = insights({ mmr: estimateMmr(comp), rr: rrStats(comp), rounds: roundStats(comp), tilt, parties: partyStats(comp), overall: summarize(comp) });
  assert.ok(tips.some((x) => x.title === "Stop après 2 défaites"));
  assert.ok(tips.every((x) => x.title && x.text && x.level));
});

test("competitive() keeps only comp matches in order", () => {
  const list = competitive([{ queue: "unrated", start: 1 }, { queue: "competitive", start: 5 }, { queue: "competitive", start: 2 }]);
  assert.deepEqual(list.map((m) => m.start), [2, 5]);
});
