import { agent, tier } from "../content.js";
import { ago, html, n0, n2, pctS, riotName } from "../format.js";
import { encounteredPlayers } from "../players-stats.js";
import { sortByDate } from "../stats.js";
import { row as matchRow } from "./history.js";

const local = { query: "", filter: "often" };

function displayName(p) {
  return p.name ? riotName(p.name) : html`<span class="hidden-name">Joueur masqué · ${agent(p.mainAgent).name}</span>`;
}

export function render(ctx) {
  const all = encounteredPlayers(ctx.matches, ctx.known);
  const q = local.query.trim().toLowerCase();
  const list = all.filter((p) => {
    if (q && !(p.name || "").toLowerCase().includes(q) && !agent(p.mainAgent).name.toLowerCase().includes(q)) return false;
    if (local.filter === "often") return p.count >= 2;
    if (local.filter === "mates") return p.with >= 2;
    if (local.filter === "rivals") return p.against >= 2;
    return true;
  });
  const seg = (value, label) => html`<button type="button" data-pfilter="${value}" class="${local.filter === value ? "active" : ""}">${label}</button>`;
  const often = all.filter((p) => p.count >= 2).length;

  return html`<section class="view">
    <div class="summary-strip" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div><b>${all.length}</b><span>Joueurs croisés</span></div>
      <div><b>${often}</b><span>Croisés 2 fois ou +</span></div>
      <div><b>${all.filter((p) => p.name).length}</b><span>Pseudos connus</span></div>
      <div data-tip="Le joueur que tu as le plus croisé"><b>${all[0] ? `${all[0].count}×` : "–"}</b><span>Record</span></div>
    </div>
    <div class="card toolbar-card">
      <div class="seg">${seg("often", "Croisés 2× ou +")}${seg("mates", "Coéquipiers")}${seg("rivals", "Adversaires")}${seg("all", "Tous")}</div>
      <label class="search" style="margin-left:auto">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
        <input type="search" data-psearch placeholder="Pseudo ou agent…" value="${local.query}" aria-label="Rechercher un joueur">
      </label>
    </div>
    <div class="card">
      ${list.length ? html`<div class="table-wrap"><table class="data players">
        <thead><tr><th>Joueur</th><th>Rang</th><th>Matchs</th><th>Avec toi</th><th>Contre toi</th><th>Ses stats</th><th>Vu</th></tr></thead>
        <tbody>${list.slice(0, 200).map((p) => {
          const t = tier(p.rank);
          return html`<tr data-player="${p.puuid}" style="cursor:pointer">
            <td><div class="agent-cell"><img src="${agent(p.mainAgent).icon}" alt=""><div><b>${displayName(p)}</b><small>${Object.keys(p.agents).length} agent${Object.keys(p.agents).length > 1 ? "s" : ""} joué${Object.keys(p.agents).length > 1 ? "s" : ""}</small></div></div></td>
            <td><span class="rank-inline"><img src="${t.small || t.icon}" alt="">${t.name}</span></td>
            <td class="num"><b>${p.count}</b></td>
            <td class="num">${p.with ? html`${p.with} · <span class="${p.wrWith >= 0.5 ? "win" : "loss"}">${pctS(p.wrWith)}</span>` : "–"}</td>
            <td class="num">${p.against ? html`${p.against} · <span class="${p.wrAgainst >= 0.5 ? "win" : "loss"}" data-tip="Ton winrate quand il est en face">${pctS(p.wrAgainst)}</span>` : "–"}</td>
            <td class="num">${n2(p.kd)} K/D · ${n0(p.acs)} ACS</td>
            <td class="num muted">${ago(p.last)}</td>
          </tr>`;
        })}</tbody>
      </table></div>` : html`<div class="empty"><strong>Personne sur ce filtre</strong>Essaie « Tous ».</div>`}
      <p class="muted small" style="margin-top:12px">Les pseudos ne sont connus que pour les joueurs croisés pendant que le tracker tournait (Riot masque les pseudos dans l'historique) et jamais pour les joueurs en mode streamer.</p>
    </div>
  </section>`;
}

export function playerModal(puuid, ctx) {
  const p = encounteredPlayers(ctx.matches, ctx.known).find((x) => x.puuid === puuid)
    || encounteredPlayers(ctx.all, ctx.known).find((x) => x.puuid === puuid);
  if (!p) return html`<div class="modal-section"><div class="empty">Aucun match enregistré avec ce joueur.</div></div>`;
  const t = tier(p.rank);
  const matches = sortByDate(ctx.all.filter((m) => p.matchIds.includes(m.id)));
  const agents = Object.entries(p.agents).sort((a, b) => b[1] - a[1]);
  const stat = (value, label, cls = "") => html`<div class="hl"><b class="num ${cls}">${value}</b><span>${label}</span></div>`;
  return html`<div class="modal-hero">
    <div class="card-title">Joueur croisé ${p.count} fois · vu ${ago(p.last)}</div>
    <div class="score-line" style="margin-top:8px">
      <img src="${agent(p.mainAgent).icon}" alt="" style="width:72px;height:72px;border-radius:10px">
      <div>
        <div class="score-big" style="font-size:44px">${p.name ? p.name.split("#")[0] : "Joueur masqué"}${p.name?.includes("#") ? html`<span class="muted" style="font-size:20px">#${p.name.split("#")[1]}</span>` : ""}</div>
        <span class="rank-inline"><img src="${t.small || t.icon}" alt="">${t.name}</span>
      </div>
    </div>
  </div>
  <div class="modal-section">
    <div class="mini-stats" style="grid-template-columns:repeat(6,minmax(0,1fr))">
      ${stat(p.count, "Matchs ensemble")}
      ${stat(`${p.with}`, "Dans ton équipe")}
      ${stat(p.with ? pctS(p.wrWith) : "–", "Ton WR avec lui", p.wrWith >= 0.5 ? "win" : "loss")}
      ${stat(`${p.against}`, "En face")}
      ${stat(p.against ? pctS(p.wrAgainst) : "–", "Ton WR contre lui", p.wrAgainst >= 0.5 ? "win" : "loss")}
      ${stat(`${n2(p.kd)} · ${n0(p.acs)}`, "Son K/D · ACS")}
    </div>
    <div class="agent-strip" style="margin-top:14px">${agents.slice(0, 4).map(([id, n]) => html`<div class="agent-chip"><img src="${agent(id).icon}" alt=""><div><b>${agent(id).name}</b><span>${n} match${n > 1 ? "s" : ""}</span></div></div>`)}</div>
  </div>
  <div class="modal-section">
    <div class="card-head"><span class="card-title">Vos matchs</span></div>
    ${matches.map((m) => matchRow(m))}
  </div>`;
}

export function handle(e, rerender) {
  const f = e.target.closest("[data-pfilter]");
  if (f && e.type === "click") { local.filter = f.dataset.pfilter; rerender(); return true; }
  const s = e.target.closest("[data-psearch]");
  if (s && e.type === "input") {
    local.query = s.value;
    const pos = s.selectionStart;
    rerender();
    const again = document.querySelector("[data-psearch]");
    again?.focus();
    again?.setSelectionRange(pos, pos);
    return true;
  }
  return false;
}
