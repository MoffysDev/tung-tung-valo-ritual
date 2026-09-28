import { map as mapInfo } from "../content.js";
import { html, pctS } from "../format.js";
import { earlyShare, mapEvents, nearestCallout, project, zoneCounts } from "../map-stats.js";

const local = { map: "", kind: "deaths", side: "all", lines: false };
const SIDES = { a: "Attaque", d: "Défense", "": "" };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Minimap with heat + dots. Reused by the match detail. */
export function minimap(mapId, groups, { lines = false, size = 640, heat = true } = {}) {
  const m = mapInfo(mapId);
  if (!m.minimap || m.xm == null) return html`<div class="empty">Pas de minimap disponible pour cette carte.</div>`;
  const P = (x, y) => project(m, x, y).map((v) => v * 1000);
  const layers = groups.map(({ events, color, label }) => {
    const pts = events.map((e) => ({ e, p: P(e.x, e.y), o: P(e.ox, e.oy) }));
    return html`<g>
      ${heat ? html`<g filter="url(#blur)" opacity=".55">${pts.map(({ p }) => html`<circle cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="34" fill="${color}" fill-opacity=".35"/>`)}</g>` : ""}
      ${lines ? pts.map(({ p, o }) => html`<line x1="${p[0].toFixed(0)}" y1="${p[1].toFixed(0)}" x2="${o[0].toFixed(0)}" y2="${o[1].toFixed(0)}" stroke="${color}" stroke-opacity=".45" stroke-width="2"/><circle cx="${o[0].toFixed(0)}" cy="${o[1].toFixed(0)}" r="4" fill="#ece8e1" fill-opacity=".7"/>`) : ""}
      ${pts.map(({ e, p }) => html`<circle class="pos-dot" cx="${p[0].toFixed(0)}" cy="${p[1].toFixed(0)}" r="8" fill="${color}" data-match="${e.matchId || ""}"
        data-tip="${label} · round ${e.round + 1}${e.side ? ` · ${SIDES[e.side]}` : ""} · ${clock(e.t)}\n${nearestCallout(m, e.x, e.y) || ""}${e.matchId ? "\nClique pour ouvrir le match" : ""}"/>`)}
    </g>`;
  });
  return html`<svg class="minimap" viewBox="0 0 1000 1000" style="max-width:${size}px">
    <defs><filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter></defs>
    <image href="${m.minimap}" x="0" y="0" width="1000" height="1000" opacity=".9"/>
    ${layers}
  </svg>`;
}

export function render(ctx) {
  const withPos = ctx.matches.filter((m) => m.positions);
  const counts = {};
  for (const m of withPos) counts[m.map_id] = (counts[m.map_id] || 0) + 1;
  const maps = Object.keys(counts).filter((id) => mapInfo(id).minimap).sort((a, b) => counts[b] - counts[a]);
  if (!maps.length) {
    return html`<section class="view"><div class="card"><div class="empty"><strong>Pas encore de positions</strong>
      Les positions des kills et des morts arrivent avec la prochaine synchro (Riot Client ouvert) : tes matchs récents seront mis à jour automatiquement.</div></div></section>`;
  }
  if (!maps.includes(local.map)) local.map = maps[0];
  const m = mapInfo(local.map);
  const games = counts[local.map];
  const deaths = mapEvents(withPos, local.map, "deaths", local.side);
  const kills = mapEvents(withPos, local.map, "kills", local.side);
  const shown = local.kind === "deaths" ? deaths : local.kind === "kills" ? kills : [...deaths, ...kills];
  const zones = zoneCounts(m, local.kind === "kills" ? kills : deaths);
  const killZones = zoneCounts(m, kills);
  const early = earlyShare(deaths);
  const seg = (key, value, label) => html`<button type="button" data-pos="${key}" data-value="${value}" class="${local[key] === value ? "active" : ""}">${label}</button>`;
  const groups = [];
  if (local.kind !== "kills") groups.push({ events: deaths, color: "#ff4655", label: "Mort" });
  if (local.kind !== "deaths") groups.push({ events: kills, color: "#20d9a6", label: "Kill" });

  return html`<section class="view">
    <div class="card toolbar-card">
      <label class="select"><select data-posmap aria-label="Carte">${maps.map((id) => html`<option value="${id}" ${id === local.map ? "selected" : ""}>${mapInfo(id).name} (${counts[id]})</option>`)}</select></label>
      <div class="seg">${seg("kind", "deaths", "Mes morts")}${seg("kind", "kills", "Mes kills")}${seg("kind", "both", "Les deux")}</div>
      <div class="seg">${seg("side", "all", "Tous les côtés")}${seg("side", "a", "Attaque")}${seg("side", "d", "Défense")}</div>
      <label class="switch" style="width:auto;padding:6px 10px"><input type="checkbox" data-poslines ${local.lines ? "checked" : ""}><span>Relier à l'adversaire</span></label>
    </div>
    <div class="row row-21">
      <div class="card map-card">
        <div class="card-head"><span class="card-title">${m.name} · ${games} match${games > 1 ? "s" : ""} · ${shown.length} événement${shown.length > 1 ? "s" : ""}</span>
          <span class="legend">${local.kind !== "kills" ? html`<span><i style="background:#ff4655;border-radius:50%"></i>Où tu es mort</span>` : ""}${local.kind !== "deaths" ? html`<span><i style="background:#20d9a6;border-radius:50%"></i>D'où tu as tué</span>` : ""}${local.lines ? html`<span><i style="background:#ece8e1;border-radius:50%"></i>Adversaire</span>` : ""}</span>
        </div>
        <div class="map-wrap">${minimap(local.map, groups, { lines: local.lines, size: 760 })}</div>
      </div>
      <div class="row" style="align-content:start">
        <div class="card">
          <div class="card-head"><span class="card-title">Où tu meurs le plus</span><span class="muted small">${deaths.length} morts</span></div>
          ${zoneList(zones, deaths.length, "#ff4655")}
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">Où tu fais tes kills</span><span class="muted small">${kills.length} kills</span></div>
          ${zoneList(killZones, kills.length, "#20d9a6")}
        </div>
        <div class="card">
          <div class="card-head"><span class="card-title">À retenir</span></div>
          <div class="tips">
            ${Number.isFinite(early) ? html`<div class="tip-item ${early > 0.3 ? "warn" : "good"}"><span class="tip-icon">${early > 0.3 ? "!" : "▲"}</span><div><b>${pctS(early)} de tes morts avant 20 s</b><p>${early > 0.3 ? "Tu meurs souvent en tout début de round : évite les peeks secs sans info ni utilitaire." : "Tu survis bien aux débuts de round."}</p></div></div>` : ""}
            ${zones[0] ? html`<div class="tip-item info"><span class="tip-icon">i</span><div><b>Zone à risque : ${zones[0].zone}</b><p>${pctS(zones[0].n / Math.max(1, deaths.length))} de tes morts sur ${m.name}${local.side !== "all" ? ` en ${SIDES[local.side].toLowerCase()}` : ""}. Change d'angle ou joue-la avec un coéquipier pour le trade.</p></div></div>` : ""}
            <div class="tip-item info"><span class="tip-icon">i</span><div><b>${(deaths.length / games).toFixed(1).replace(".", ",")} morts · ${(kills.length / games).toFixed(1).replace(".", ",")} kills par match</b><p>Sur ${m.name}${local.side !== "all" ? `, côté ${SIDES[local.side].toLowerCase()}` : ""}.</p></div></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function zoneList(zones, total, color) {
  if (!zones.length) return html`<div class="empty" style="padding:16px">Rien sur ce filtre.</div>`;
  const max = zones[0].n;
  return html`<div class="zones">${zones.slice(0, 7).map((z) => html`<div class="zone">
    <span>${z.zone}</span><b>${z.n}</b>
    <div class="bar-track"><span style="width:${(z.n / max) * 100}%;background:${color}"></span></div>
    <small>${pctS(z.n / Math.max(1, total))}</small>
  </div>`)}</div>`;
}

export function handle(e, rerender) {
  const b = e.target.closest("[data-pos]");
  if (b && e.type === "click") { local[b.dataset.pos] = b.dataset.value; rerender(); return true; }
  const s = e.target.closest("[data-posmap]");
  if (s && e.type === "change") { local.map = s.value; rerender(); return true; }
  const l = e.target.closest("[data-poslines]");
  if (l && e.type === "change") { local.lines = l.checked; rerender(); return true; }
  return false;
}
