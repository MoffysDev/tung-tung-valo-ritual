// Run with: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { economyStats, rankGoal } from "../static/js/ranked-stats.js";
import { encounteredPlayers } from "../static/js/players-stats.js";
import { earlyShare, mapEvents, nearestCallout, project, zoneCounts } from "../static/js/map-stats.js";

test("economy win rates, anti-eco leaks and credits per kill", () => {
  const m = {
    kills: 10, spent: 20000,
    round_log: [
      [1, "a", "pistol", "pistol", 800, 800],
      [0, "a", "full", "eco", 3900, 3900],   // lost a full buy vs eco
      [1, "a", "full", "eco", 3900, 0],
      [1, "d", "eco", "full", 500, 0],       // upset
      [0, "d", "force", "full", 2400, 2400],
    ],
  };
  const e = economyStats([m, { kills: 5 }]);
  assert.equal(e.rounds, 5);
  const full = e.buys.find((b) => b.key === "full");
  assert.deepEqual([full.won, full.played], [1, 2]);
  assert.deepEqual([e.antiEco.lost, e.antiEco.played], [1, 2]);
  assert.deepEqual([e.upsets.won, e.upsets.played], [1, 2]);
  assert.equal(e.creditsPerKill, 2000);
});

test("rank goal: games needed at the current pace and break-even winrate", () => {
  const mk = (result, earned) => ({ result, rr: { earned } });
  const comp = [...Array(6).fill(mk("win", 20)), ...Array(4).fill(mk("loss", -20))];
  const g = rankGoal(comp, 1650, 18); // Plat 2 50 RR -> Diamond 1 = 150 pts
  assert.equal(g.needed, 150);
  assert.equal(g.perGame, 4); // 0.6*20 + 0.4*-20
  assert.equal(g.games, 38);
  assert.equal(g.breakEven, 0.5);
  assert.ok(g.wrFor50 > 0.5 && g.wrFor50 < 0.6);
  assert.equal(rankGoal(comp, 1900, 18).reached, true);
  const losing = [...Array(3).fill(mk("win", 15)), ...Array(7).fill(mk("loss", -25))];
  assert.equal(rankGoal(losing, 1600, 18).games, Infinity);
});

test("encountered players aggregate with/against and names", () => {
  const board = (friendTeam, name = "") => [
    { puuid: "me", is_me: true, team: "Blue" },
    { puuid: "f", team: friendTeam, agent: "jett", kills: 20, deaths: 10, score: 5000, rank_id: 16, name },
  ];
  const matches = [
    { id: "a", start: 1, result: "win", rounds: 20, scoreboard: board("Blue") },
    { id: "b", start: 2, result: "loss", rounds: 20, scoreboard: board("Red", "Pote#1") },
    { id: "c", start: 3, result: "win", rounds: 20, scoreboard: board("Blue") },
  ];
  const [p] = encounteredPlayers(matches, { f: { name: "Ignored#0" } });
  assert.equal(p.count, 3);
  assert.deepEqual([p.with, p.against, p.winsWith, p.winsAgainst], [2, 1, 2, 0]);
  assert.equal(p.name, "Pote#1"); // name from a scoreboard wins over the live cache
  assert.equal(p.kd, 2);
  assert.equal(p.mainAgent, "jett");
  assert.deepEqual(p.matchIds, ["a", "b", "c"]);
  const [anon] = encounteredPlayers([matches[0]], { f: { name: "Live#2", rank_id: 20 } });
  assert.equal(anon.name, "Live#2");
});

test("map projection, zones and early deaths", () => {
  const map = { xm: 7e-05, ym: -7e-05, xa: 0.8, ya: 0.5, callouts: [{ n: "A Main", x: 5000, y: -4700 }, { n: "B Site", x: -3000, y: -7000 }] };
  const [u, v] = project(map, 1000, 2000);
  assert.ok(Math.abs(u - 0.94) < 1e-9 && Math.abs(v - 0.43) < 1e-9);
  assert.equal(project({}, 1, 1), null);
  assert.equal(nearestCallout(map, 4900, -4600), "A Main");
  const matches = [{ id: "m", map_id: "asc", positions: { deaths: [[4900, -4600, 0, 0, 1, "a", 10], [-2900, -7100, 0, 0, 2, "d", 40], [5100, -4800, 0, 0, 3, "a", 5]] } }];
  const all = mapEvents(matches, "asc", "deaths");
  assert.equal(all.length, 3);
  assert.equal(mapEvents(matches, "asc", "deaths", "d").length, 1);
  assert.deepEqual(zoneCounts(map, all)[0], { zone: "A Main", n: 2 });
  assert.equal(earlyShare(all), 2 / 3);
});
