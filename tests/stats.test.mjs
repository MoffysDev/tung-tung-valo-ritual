// Run with: node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import { byAgent, bestAgent, filterMatches, rankSkins, skinStats, summarize, highlights } from "../static/js/stats.js";

const m = (o) => ({ v: 2, rounds: 20, kills: 10, deaths: 10, assists: 5, score: 4000, result: "win", queue: "competitive", start: 0, ...o });

test("summarize weights ACS/KAST by rounds and handles legacy HS", () => {
  const s = summarize([
    m({ score: 6000, rounds: 20, kast: 80, headshots: 10, bodyshots: 30, legshots: 0, duration: 1000 }),
    m({ score: 2000, rounds: 10, kast: 50, headshots: 0, bodyshots: 10, legshots: 0, result: "loss", duration: 500 }),
  ]);
  assert.equal(s.matches, 2);
  assert.equal(s.wins, 1);
  assert.equal(Math.round(s.acs), 267); // 8000 / 30
  assert.equal(Math.round(s.kast * 100), 70); // (80*20 + 50*10) / 30
  assert.equal(s.hsRate, 10 / 50);
  assert.equal(s.playtime, 1500);
  const legacy = summarize([{ v: 1, kills: 1, deaths: 1, hs_percent: 30 }, { v: 1, kills: 1, deaths: 1, hs_percent: 10 }]);
  assert.equal(Math.round(legacy.hsRate * 100), 20);
  assert.ok(Number.isNaN(legacy.adr));
});

test("filterMatches by queue, days and act", () => {
  const now = Date.UTC(2026, 8, 28, 12);
  const list = [m({ queue: "unrated", start: now - 2 * 864e5 }), m({ start: now - 10 * 864e5, season: "act" })];
  assert.equal(filterMatches(list, { queue: "unrated" }, now).length, 1);
  assert.equal(filterMatches(list, { period: "7" }, now).length, 1);
  assert.equal(filterMatches(list, { period: "act", season: "act" }, now).length, 1);
  assert.equal(filterMatches(list, { period: "act", season: null }, now).length, 0);
});

test("best agent needs a real sample", () => {
  const rows = byAgent([
    m({ agent: "fluke", score: 9000 }),
    ...Array.from({ length: 5 }, () => m({ agent: "main", score: 5000 })),
  ]);
  assert.equal(rows[0].id, "main"); // most played first
  assert.equal(bestAgent(rows).id, "main"); // 1-match agent ignored when a 3+ sample exists
});

test("skin stats merge v2 loadouts with the legacy bucket and skip upgraded legacy matches", () => {
  const matches = [
    m({ weapon_kills: { w: 5 }, loadout: { w: "a" }, loadout_source: "locked" }),
    m({ weapon_kills: { w: 3 }, loadout: { w: "a" }, loadout_source: "estimated", result: "loss" }),
    m({ weapon_kills: { w: 9 }, loadout: {}, loadout_source: "legacy" }),
  ];
  const legacy = { skins: { w: { b: { competitive: { kills: 4, matches: 2, wins: 1 } }, a: { unrated: { kills: 1, matches: 1, wins: 0 } } } } };
  const all = skinStats(matches, legacy, "all");
  assert.deepEqual(all.w.a, { kills: 9, matches: 3, wins: 1, estimated: 1 });
  assert.deepEqual(all.w.b, { kills: 4, matches: 2, wins: 1, estimated: 0 });
  assert.equal(skinStats(matches, legacy, "competitive").w.a.kills, 8);
});

test("rankSkins puts reliable samples first", () => {
  const ranked = rankSkins({ lucky: { kills: 10, matches: 1, wins: 0 }, main: { kills: 59, matches: 7, wins: 3 } });
  assert.deepEqual(ranked.map((r) => r.id), ["main", "lucky"]);
});

test("highlights find best ACS match and win streak", () => {
  const h = highlights([m({ id: 1, start: 1, acs: 200 }), m({ id: 2, start: 2, acs: 300 }), m({ id: 3, start: 3, result: "loss", acs: 100 })]);
  assert.equal(h.best.id, 2);
  assert.equal(h.bestStreak, 2);
});
