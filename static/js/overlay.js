// Compact in-game overlay: the players of the current match with their recent form.
import { agent, map, setContent, tier } from "./content.js";
import { html, queueName } from "./format.js";

const $ = (id) => document.getElementById(id);
let team = "enemy";
let last = "";

function rowHtml(p) {
  const a = p.agent ? agent(p.agent) : null;
  const r = p.rank || {};
  const t = tier(r.tier);
  const rec = p.recent;
  const name = p.is_me ? "Toi" : p.name ? p.name.split("#")[0] : a ? `${a.name} (masqué)` : "Joueur masqué";
  const kdClass = rec ? (rec.kd >= 1.2 ? "hot" : rec.kd < 0.85 ? "cold" : "") : "";
  return html`<div class="row ${p.is_me ? "me" : ""}">
    <img class="agent" src="${a ? a.icon : ""}" alt="">
    <div class="who">
      <div class="name ${p.name || p.is_me ? "" : "hidden"}">${name}</div>
      <div class="meta">
        <img src="${t.small || t.icon}" alt=""><span style="color:${t.color}">${t.name}</span>
        ${r.tier >= 3 && r.rr != null ? html`<span class="dim">${r.rr} RR</span>` : ""}
        ${r.act_games ? html`<span class="dim">· ${Math.round((r.act_wins / r.act_games) * 100)}% V</span>` : ""}
        ${p.encounters ? html`<span class="met">déjà croisé ${p.encounters.count}×</span>` : ""}
      </div>
    </div>
    ${rec ? html`<div class="form">
      <b class="kd ${kdClass}">${rec.kd.toFixed(2).replace(".", ",")}</b><span>K/D</span>
      <div class="line">${rec.k.toFixed(0)}/${rec.d.toFixed(0)}/${rec.a.toFixed(0)} · ${rec.acs} ACS${rec.hs != null ? ` · ${rec.hs}% HS` : ""}</div>
      <div class="pips">${[...rec.results].map((x) => html`<i class="${x === "V" ? "w" : "l"}"></i>`)}</div>
    </div>` : html`<div class="form loading">${p.is_me ? "" : "…"}</div>`}
  </div>`;
}

function render(live) {
  if (!live) {
    $("sub").textContent = "En attente d'une partie…";
    $("list").innerHTML = "";
    return;
  }
  const players = live.players.filter((p) => (team === "enemy" ? !p.is_ally : p.is_ally));
  const known = live.players.filter((p) => !p.is_me && p.recent).length;
  const total = live.players.filter((p) => !p.is_me).length;
  $("sub").textContent = `${live.phase === "PREGAME" ? "Sélection d'agent" : "En partie"} · ${map(live.map_id).name} · ${queueName(live.queue)}${known < total ? ` · stats ${known}/${total}` : ""}`;
  $("list").innerHTML = players.length
    ? String(html`${players.map(rowHtml)}`)
    : String(html`<div class="empty">${team === "enemy" ? "L'équipe d'en face s'affiche dès le début de la partie." : "Personne pour l'instant."}</div>`);
}

async function poll() {
  try {
    const state = await (await fetch("/api/state", { cache: "no-store" })).json();
    const key = JSON.stringify([team, state.live?.updated, state.live?.match_id]);
    if (key !== last) {
      last = key;
      render(state.live);
    }
  } catch { /* server restarting */ }
  setTimeout(poll, 2000);
}

document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-team]");
  if (tab) {
    team = tab.dataset.team;
    document.querySelectorAll("[data-team]").forEach((b) => b.classList.toggle("active", b === tab));
    last = "";
  }
  if (e.target.closest("#close")) {
    await fetch("/api/overlay/hide", { method: "POST", headers: { "X-Tracker": "1" } }).catch(() => {});
  }
});

(async function boot() {
  for (;;) {
    try {
      const res = await fetch("/api/content");
      if (res.ok) { setContent(await res.json()); break; }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  poll();
})();
