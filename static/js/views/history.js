import { agent, map } from "../content.js";
import { clock, dayLabel, html, n0, n2, pctS, queueName, RESULT } from "../format.js";
import { sortByDate, summarize } from "../stats.js";

const PAGE = 40;
const local = { result: "all", agent: "all", map: "all", query: "", limit: PAGE };

export function reset() { local.limit = PAGE; }

const resultOf = (m) => m.result || (m.won ? "win" : "loss");

function matchesQuery(m, q) {
  if (!q) return true;
  const hay = [map(m.map_id).name, agent(m.agent).name, queueName(m.queue), ...(m.scoreboard || []).map((p) => p.name || "")].join(" ").toLowerCase();
  return hay.includes(q);
}

export function render(ctx) {
  const all = sortByDate(ctx.matches);
  const agents = [...new Set(all.map((m) => m.agent))].sort((a, b) => agent(a).name.localeCompare(agent(b).name));
  const maps = [...new Set(all.map((m) => m.map_id))].sort((a, b) => map(a).name.localeCompare(map(b).name));
  if (!agents.includes(local.agent)) local.agent = "all";
  if (!maps.includes(local.map)) local.map = "all";
  const q = local.query.trim().toLowerCase();

  const list = all.filter((m) =>
    (local.result === "all" || resultOf(m) === local.result) &&
    (local.agent === "all" || m.agent === local.agent) &&
    (local.map === "all" || m.map_id === local.map) &&
    matchesQuery(m, q));
  const shown = list.slice(0, local.limit);
  const s = summarize(list);
  const rrNet = list.reduce((a, m) => a + (m.rr?.earned || 0), 0);
  const hasRr = list.some((m) => m.rr);

  const groups = [];
  for (const m of shown) {
    const label = dayLabel(m.start);
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, items: [] });
    groups[groups.length - 1].items.push(m);
  }
  const seg = (value, label) => html`<button type="button" data-hfilter="result" data-value="${value}" class="${local.result === value ? "active" : ""}">${label}</button>`;
  const backfill = ctx.server.status?.backfill;

  return html`<section class="view">
    <div class="card toolbar-card">
      <div class="seg" role="group" aria-label="Résultat">${seg("all", "Tous")}${seg("win", "Victoires")}${seg("loss", "Défaites")}</div>
      <label class="select"><select data-hselect="agent" aria-label="Agent"><option value="all">Tous les agents</option>${agents.map((a) => html`<option value="${a}" ${a === local.agent ? "selected" : ""}>${agent(a).name}</option>`)}</select></label>
      <label class="select"><select data-hselect="map" aria-label="Carte"><option value="all">Toutes les cartes</option>${maps.map((m) => html`<option value="${m}" ${m === local.map ? "selected" : ""}>${map(m).name}</option>`)}</select></label>
      <label class="search" style="margin-left:auto">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
        <input type="search" data-hsearch placeholder="Joueur, carte, agent…" value="${local.query}" aria-label="Rechercher">
      </label>
    </div>

    ${list.length ? html`<div class="summary-strip">
      <div><b>${list.length}</b><span>Matchs</span></div>
      <div><b class="${s.winrate >= 0.5 ? "win" : "loss"}">${pctS(s.winrate)}</b><span>Winrate · ${s.wins}V ${s.losses}D</span></div>
      <div><b>${n2(s.kd)}</b><span>K/D</span></div>
      <div><b>${n0(s.acs)}</b><span>ACS moyen</span></div>
      <div><b>${pctS(s.hsRate)}</b><span>Headshot</span></div>
      <div data-tip="Somme des RR gagnés et perdus sur la sélection"><b class="${rrNet > 0 ? "win" : rrNet < 0 ? "loss" : ""}">${hasRr ? `${rrNet > 0 ? "+" : ""}${rrNet}` : "–"}</b><span>RR net</span></div>
    </div>` : ""}

    <div>
      ${groups.length ? groups.map((g) => html`
        <div class="day"><span>${g.label}</span>${dayRecord(g.items)}</div>
        ${g.items.map((m) => row(m))}`) : html`<div class="card"><div class="empty"><strong>Aucun match</strong>Aucun match ne correspond à ces filtres.</div></div>`}
      <div class="more">
        ${list.length > shown.length ? html`<button class="btn" type="button" data-action="more">Afficher plus (${list.length - shown.length})</button>` : ""}
        ${backfill ? html`<span class="muted">Import de l'historique ancien… ${backfill.cursor}/${backfill.target}</span>`
          : list.length === all.length && !q ? html`<button class="btn" type="button" data-action="backfill" data-tip="Récupère jusqu'à 100 matchs plus anciens auprès de Riot">Importer des matchs plus anciens</button>` : ""}
      </div>
    </div>
  </section>`;
}

function dayRecord(items) {
  const w = items.filter((m) => resultOf(m) === "win").length;
  const rr = items.reduce((a, m) => a + (m.rr?.earned || 0), 0);
  return html`<span class="day-rec"><span class="pill green">${w} V</span><span class="pill red">${items.length - w} D</span>${items.some((m) => m.rr) ? html`<span class="pill ${rr >= 0 ? "green" : "red"}">${rr > 0 ? "+" : ""}${rr} RR</span>` : ""}</span>`;
}

export function row(m, { compact = false } = {}) {
  const r = resultOf(m);
  const a = agent(m.agent);
  const mp = map(m.map_id);
  const kd = m.kills / Math.max(1, m.deaths);
  const rr = m.rr ? m.rr.earned : null;
  const me = (m.scoreboard || []).find((p) => p.is_me);
  const board = [...(m.scoreboard || [])].sort((x, y) => (y.acs ?? y.score) - (x.acs ?? x.score));
  const place = me ? board.indexOf(me) + 1 : 0;
  return html`<button type="button" class="match r-${r} ${compact ? "compact" : ""}" data-match="${m.id}">
    <div class="map-bg" style="background-image:url('${mp.list_icon || mp.splash}')"></div>
    <span class="edge"></span>
    <img class="agent" src="${a.icon}" alt="${a.name}">
    <div style="min-width:0">
      <div class="match-result ${r}">${RESULT[r]}${m.my_score || m.enemy_score ? html`<span class="score">${m.my_score}–${m.enemy_score}</span>` : ""}</div>
      <div class="match-meta">${mp.name} <span class="muted">· ${queueName(m.queue)} · ${clock(m.start)}</span></div>
    </div>
    <div class="stat"><b>${m.kills}/${m.deaths}/${m.assists}</b><span>KDA</span></div>
    <div class="stat"><b class="${kd >= 1 ? "win" : "loss"}">${n2(kd)}</b><span>K/D</span></div>
    <div class="stat" ${place ? html`data-tip="${place === 1 ? "MVP du match" : `${place}e au score sur ${board.length}`}"` : ""}><b class="${place === 1 ? "mvp" : ""}">${Number.isFinite(m.acs) ? n0(m.acs) : "–"}${place === 1 ? " ★" : ""}</b><span>ACS</span></div>
    <div class="stat opt"><b>${m.hs_percent ? `${m.hs_percent}%` : "–"}</b><span>HS</span></div>
    <div class="stat opt-xl"><b>${Number.isFinite(m.adr) ? n0(m.adr) : "–"}</b><span>ADR</span></div>
    ${rr !== null ? html`<span class="rr ${rr > 0 ? "up" : rr < 0 ? "down" : "flat"}">${rr > 0 ? "+" : ""}${rr} RR</span>` : html`<span></span>`}
  </button>`;
}

export function handle(e, rerender) {
  const f = e.target.closest("[data-hfilter]");
  if (f && e.type === "click") { local.result = f.dataset.value; local.limit = PAGE; rerender(); return true; }
  const s = e.target.closest("[data-hselect]");
  if (s && e.type === "change") { local[s.dataset.hselect] = s.value; local.limit = PAGE; rerender(); return true; }
  const search = e.target.closest("[data-hsearch]");
  if (search && e.type === "input") {
    local.query = search.value;
    local.limit = PAGE;
    const pos = search.selectionStart;
    rerender();
    const again = document.querySelector("[data-hsearch]");
    again?.focus();
    again?.setSelectionRange(pos, pos);
    return true;
  }
  const more = e.target.closest("[data-action='more']");
  if (more && e.type === "click") { local.limit += PAGE; rerender(); return true; }
  return false;
}
