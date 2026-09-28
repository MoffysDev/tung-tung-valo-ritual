// Minimap projection and zones (pure, unit-tested).

/** Game coordinates -> [u, v] in 0..1 of the minimap image (valorant-api transform). */
export function project(map, x, y) {
  if (!map || map.xm == null) return null;
  return [y * map.xm + map.xa, x * map.ym + map.ya];
}

export function nearestCallout(map, x, y) {
  let best = null, dist = Infinity;
  for (const c of map?.callouts || []) {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < dist) { dist = d; best = c; }
  }
  return best ? best.n : "";
}

/**
 * Collect kill/death events for one map. side: "all" | "a" | "d".
 * Each event: { x, y, ox, oy, round, side, t, matchId }  (x/y = where you were).
 */
export function mapEvents(matches, mapId, kind, side = "all") {
  const out = [];
  for (const m of matches) {
    if (m.map_id !== mapId || !m.positions) continue;
    for (const [x, y, ox, oy, round, s, t] of m.positions[kind] || []) {
      if (side !== "all" && s !== side) continue;
      out.push({ x, y, ox, oy, round, side: s, t, matchId: m.id });
    }
  }
  return out;
}

export function zoneCounts(map, events) {
  const counts = {};
  for (const e of events) {
    const zone = nearestCallout(map, e.x, e.y) || "Zone inconnue";
    counts[zone] = (counts[zone] || 0) + 1;
  }
  return Object.entries(counts).map(([zone, n]) => ({ zone, n })).sort((a, b) => b.n - a.n);
}

/** Early deaths (first 20 s of the round) are the costly ones. */
export function earlyShare(events, seconds = 20) {
  return events.length ? events.filter((e) => e.t <= seconds).length / events.length : NaN;
}
