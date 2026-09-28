import { agent, map, shortSkin, skin, tier } from "../content.js";
import { ago, html, PARTY_COLORS, queueName, riotName } from "../format.js";
import { WEAPON_IDS } from "../ids.js";

const SHOWN = [["vandal", "Vandal"], ["phantom", "Phantom"], ["melee", "Couteau"]];

export function render(ctx) {
  const live = ctx.server.live;
  if (!live) {
    return html`<section class="view"><div class="card"><div class="empty">
      <strong>Aucune partie en cours</strong>Cet onglet s'active tout seul dès la sélection d'agent.
    </div></div></section>`;
  }
  const mp = map(live.map_id);
  const allies = live.players.filter((p) => p.is_ally);
  const enemies = live.players.filter((p) => !p.is_ally);
  const pregame = live.phase === "PREGAME";

  return html`<section class="view">
    <div class="live-head">
      <div class="map-bg" style="background-image:url('${mp.splash || mp.list_icon}')"></div>
      <div>
        <div class="live-phase"><span class="pulse-dot"></span>${pregame ? "Sélection d'agent" : "Partie en cours"}</div>
        <div class="live-map">${mp.name}</div>
        <div class="muted">${queueName(live.queue)} · mis à jour ${ago(live.updated)}</div>
      </div>
      <div class="team-avg">
        ${teamAverage(allies, "Moyenne alliée")}
        ${enemies.length ? teamAverage(enemies, "Moyenne ennemie") : ""}
      </div>
    </div>
    <div class="live-teams">
      ${team("Ton équipe", allies, false, ctx)}
      ${team("Adversaires", enemies, true, ctx, pregame)}
    </div>
    <p class="muted" style="font-size:12px;margin:0">Les pseudos des joueurs en mode streamer restent masqués. Les groupes ne sont détectés que pour tes amis (limite de l'API Riot).</p>
  </section>`;
}

function teamAverage(players, label) {
  const ranked = players.map((p) => p.rank?.tier || 0).filter((t) => t >= 3);
  if (!ranked.length) return "";
  const avg = Math.round(ranked.reduce((a, b) => a + b, 0) / ranked.length);
  const t = tier(avg);
  return html`<div data-tip="Rang moyen des ${ranked.length} joueurs classés"><img src="${t.icon}" alt=""><div class="card-title">${label}</div><b style="color:${t.color}">${t.name}</b></div>`;
}

function team(label, players, enemy, ctx, hiddenEnemies = false) {
  return html`<div>
    <div class="team-head ${enemy ? "enemy" : ""}"><h3>${label}</h3><span class="muted">${players.length} joueur${players.length > 1 ? "s" : ""}</span></div>
    ${players.length ? players.map((p) => player(p, enemy, ctx))
      : html`<div class="card"><div class="empty">${hiddenEnemies ? "L'équipe adverse est cachée pendant la sélection d'agent." : "En attente des joueurs…"}</div></div>`}
  </div>`;
}

function player(p, enemy, ctx) {
  const a = p.agent ? agent(p.agent) : null;
  const rank = p.rank || {};
  const t = tier(rank.tier);
  const peak = rank.peak > (rank.tier || 0) ? tier(rank.peak) : null;
  const locked = p.lock === "locked";
  const name = p.is_me && ctx.prefs.streamer ? "Toi" : p.name;
  const enc = p.encounters;
  return html`<div class="player ${enemy ? "enemy" : ""} ${p.is_me ? "me" : ""}">
    ${p.party ? html`<span class="party-bar" style="background:${PARTY_COLORS[(p.party - 1) % PARTY_COLORS.length]}" title="${p.my_party ? "Ton groupe" : "Groupe"}"></span>` : ""}
    <div class="agent-wrap ${a && (locked || !p.lock) ? "" : "pending"}">
      <img src="${a ? a.icon : ""}" alt="${a ? a.name : "Aucun agent"}" title="${a ? a.name : "Pas encore choisi"}">
      ${locked ? html`<span class="lock" title="Verrouillé">✓</span>` : ""}
    </div>
    <div style="min-width:0">
      <div class="player-name ${name ? "" : "hidden-name"}">${riotName(name, a ? `${a.name} (masqué)` : "Joueur masqué")}</div>
      <div class="player-sub">
        ${p.level ? html`<span class="pill">Niv. ${p.level}</span>` : ""}
        ${p.is_me ? html`<span class="pill gold">Toi</span>` : p.my_party ? html`<span class="pill gold">Ton groupe</span>` : ""}
        ${rank.act_games ? html`<span title="Victoires cet acte">${Math.round((rank.act_wins / rank.act_games) * 100)}% V · ${rank.act_games} parties</span>` : ""}
        ${p.recent ? html`<span class="pill ${p.recent.kd >= 1.2 ? "red" : ""}" data-tip="Moyenne sur ses ${p.recent.games} dernières parties : ${p.recent.k}/${p.recent.d}/${p.recent.a}${p.recent.hs != null ? ` · ${p.recent.hs}% HS` : ""}\nRésultats : ${p.recent.results}">${p.recent.kd.toFixed(2).replace(".", ",")} K/D · ${p.recent.acs} ACS</span>` : ""}
        ${enc ? html`<button type="button" class="pill blue" data-player="${p.puuid}" data-tip="${enc.with} fois avec toi, ${enc.against} fois contre toi\n${enc.wins} victoire${enc.wins > 1 ? "s" : ""} · dernière fois ${ago(enc.last)}\nClique pour voir vos matchs">Déjà croisé ${enc.count}× ›</button>` : ""}
      </div>
    </div>
    <div class="skins">${SHOWN.map(([key, label]) => {
      const wid = WEAPON_IDS[key];
      const eq = p.skins?.[wid];
      if (!eq) return "";
      const s = skin(wid, eq.skin, eq.chroma);
      return html`<div class="skin" title="${s.name}"><img src="${s.icon}" alt="${label}"><span>${s.standard ? label : shortSkin(wid, s.name)}</span></div>`;
    })}</div>
    <div class="player-rank" title="${peak ? `Peak : ${peak.name}` : ""}">
      <img src="${t.icon}" alt="">
      <b style="color:${t.color}">${t.name}</b>
      <small>${rank.tier >= 3 ? `${rank.rr || 0} RR` : ""}${peak ? ` · peak ${peak.name}` : ""}</small>
    </div>
  </div>`;
}
