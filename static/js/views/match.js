import { agent, map, shortSkin, skin, tier, weapon } from "../content.js";
import { dayLabel, clock, duration, html, n0, PARTY_COLORS, queueName, RESULT, riotName } from "../format.js";

export function matchModal(m, ctx) {
  const r = m.result || (m.won ? "win" : "loss");
  const mp = map(m.map_id);
  const acsOf = (p) => p.acs ?? (m.rounds ? (p.score || 0) / m.rounds : 0);
  const board = [...(m.scoreboard || [])].sort((a, b) => acsOf(b) - acsOf(a));
  const myTeam = m.team || board.find((p) => p.is_me)?.team;
  const teams = [...new Set(board.map((p) => p.team))];
  teams.sort((a, b) => (a === myTeam ? -1 : b === myTeam ? 1 : 0));
  const topAcs = board[0]?.puuid;

  // Parties: only colour groups of 2+ players.
  const partyCount = {};
  for (const p of board) if (p.party) partyCount[p.party] = (partyCount[p.party] || 0) + 1;
  const partyIndex = {};
  for (const p of board) if (p.party && partyCount[p.party] > 1 && !(p.party in partyIndex)) partyIndex[p.party] = Object.keys(partyIndex).length;

  const stat = (value, label) => html`<div class="hl"><b class="num">${value}</b><span>${label}</span></div>`;
  const multi = Object.entries(m.multikills || {}).map(([k, n]) => `${n}× ${k === "5" ? "ACE" : `${k}K`}`).join(" · ");
  const clutch = Object.entries(m.clutches || {}).map(([k, n]) => `${n}× 1v${k}`).join(" · ");
  const weapons = Object.entries(m.weapon_kills || {}).filter(([w]) => weapon(w)).sort((a, b) => b[1] - a[1]);

  return html`<div class="modal-hero">
    <div class="map-bg" style="background-image:url('${mp.splash || mp.list_icon}')"></div>
    <div class="card-title">${queueName(m.queue)} · ${dayLabel(m.start)} ${clock(m.start)}${m.duration ? ` · ${duration(m.duration)}` : ""}</div>
    <div class="score-line" style="margin-top:6px">
      <span class="score-big ${r}">${RESULT[r]}</span>
      ${m.my_score || m.enemy_score ? html`<span class="score-big">${m.my_score}<span class="muted"> – </span>${m.enemy_score}</span>` : ""}
      <span class="card-title-lg" style="font-size:28px">${mp.name}</span>
      ${m.rr ? html`<span class="rr ${m.rr.earned > 0 ? "up" : m.rr.earned < 0 ? "down" : "flat"}" style="font-size:15px">${m.rr.earned > 0 ? "+" : ""}${m.rr.earned} RR</span>` : ""}
    </div>
  </div>

  <div class="modal-section">
    <div class="card-head"><span class="card-title">Ta performance · ${agent(m.agent).name}</span></div>
    <div class="mini-stats">
      ${stat(`${m.kills}/${m.deaths}/${m.assists}`, "K / D / A")}
      ${stat(Number.isFinite(m.acs) ? n0(m.acs) : "–", "ACS")}
      ${stat(Number.isFinite(m.adr) ? n0(m.adr) : "–", "ADR")}
      ${stat(m.hs_percent ? `${m.hs_percent}%` : "–", "Headshot")}
      ${stat(m.kast != null ? `${m.kast}%` : "–", "KAST")}
      ${m.v >= 2 ? stat(`${m.first_bloods}/${m.first_deaths}`, "First blood / death") : ""}
      ${m.v >= 2 ? stat(`${m.plants}/${m.defuses}`, "Plants / Defuses") : ""}
      ${multi ? stat(multi, "Multi-kills") : ""}
      ${clutch ? stat(clutch, "Clutchs") : ""}
    </div>
    ${m.v < 2 ? html`<p class="muted" style="font-size:12px;margin:12px 0 0">Match importé par l'ancienne version : les stats détaillées seront complétées à la prochaine synchro.</p>` : ""}
  </div>

  ${weapons.length ? html`<div class="modal-section">
    <div class="card-head"><span class="card-title">Kills par arme</span>${m.loadout_source === "estimated" ? html`<span class="muted" style="font-size:12px">skins estimés</span>` : ""}</div>
    <div class="weapons-used">${weapons.map(([w, k]) => {
      const sk = m.loadout?.[w] ? skin(w, m.loadout[w]) : null;
      return html`<button type="button" class="wu" data-weapon="${w}" style="text-align:left">
        <img src="${sk?.icon || weapon(w).icon}" alt="">
        <div style="min-width:0"><div style="font-weight:700">${weapon(w).name}</div><div class="muted" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sk ? shortSkin(w, sk.name) : ""}</div></div>
        <b>${k}</b>
      </button>`;
    })}</div>
  </div>` : ""}

  ${board.length ? html`<div class="modal-section">
    <div class="grid-2">${teams.map((team) => html`<div class="table-wrap">
      <table class="scoreboard ${team === myTeam ? "blue" : "red"}">
        <caption>${team === myTeam ? "Ton équipe" : "Adversaires"}</caption>
        <thead><tr><th>Joueur</th><th>ACS</th><th>K</th><th>D</th><th>A</th></tr></thead>
        <tbody>${board.filter((p) => p.team === team).map((p) => {
          const a = agent(p.agent);
          const t = tier(p.rank_id);
          const prof = ctx.server.profile || {};
          const own = prof.name ? `${prof.name}#${prof.tag || ""}` : "Toi";
          const shown = p.is_me ? (ctx.prefs.streamer ? "Toi" : p.name || own) : p.name;
          return html`<tr class="${p.is_me ? "me" : ""}">
            <td><div class="who">
              <img src="${a.icon}" alt="${a.name}" title="${a.name}">
              <img class="rank" src="${t.small || t.icon}" alt="" title="${t.name}">
              <div style="min-width:0">
                <div class="who-name">${p.party in partyIndex ? html`<i class="party-dot" style="background:${PARTY_COLORS[partyIndex[p.party] % PARTY_COLORS.length]}" title="Groupe"></i>` : ""}${riotName(shown, "Joueur masqué")}</div>
                <div class="muted" style="font-size:11px">${a.name}${p.puuid === topAcs ? html` · <span class="badge" style="font-size:9px">MVP</span>` : ""}</div>
              </div>
            </div></td>
            <td class="num"><b>${n0(acsOf(p))}</b></td>
            <td class="num">${p.kills}</td>
            <td class="num">${p.deaths}</td>
            <td class="num">${p.assists}</td>
          </tr>`;
        })}</tbody>
      </table>
    </div>`)}</div>
  </div>` : ""}`;
}
