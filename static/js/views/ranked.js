import { agent, map, tier } from "../content.js";
import { ago, dayLabel, html, n0, n1, n2, pctS, RESULT } from "../format.js";
import { byAgent, byMap, filterMatches, summarize } from "../stats.js";
import { competitive, economyStats, estimateMmr, insights, partyStats, rankGoal, roundStats, rrStats, tiltStats } from "../ranked-stats.js";

const signed = (v, digits = 0) => (Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(digits).replace(".", ",")}` : "–");
const tierAt = (pts) => Math.max(0, Math.min(27, Math.floor(pts / 100)));
const rrAt = (pts) => Math.max(0, Math.round(pts - tierAt(pts) * 100));

export function render(ctx) {
  const all = filterMatches(ctx.all, { period: ctx.filters.period, season: ctx.server.profile?.season });
  const comp = competitive(all);
  const profile = ctx.server.profile || {};

  if (!comp.length) {
    return html`<section class="view">
      ${actsCard(profile.rank?.acts || [])}
      <div class="card"><div class="empty"><strong>Aucun match compétitif sur cette période</strong>Joue quelques classées (ou change la période en haut à droite) : l'analyse apparaîtra ici.</div></div>
    </section>`;
  }

  const mmr = estimateMmr(comp);
  const rr = rrStats(comp);
  const rounds = roundStats(comp);
  const tilt = tiltStats(comp);
  const parties = partyStats(comp);
  const overall = summarize(comp);
  const maps = byMap(comp).map((r) => ({ ...r, name: map(r.id).name }));
  const agents = byAgent(comp).map((r) => ({ ...r, name: agent(r.id).name }));
  const tips = insights({ mmr, rr, rounds, tilt, parties, maps, agents, overall });

  return html`<section class="view">
    <div class="row row-21">
      ${mmrCard(mmr, profile)}
      ${explainCard(mmr)}
    </div>
    ${progressionCard(mmr)}
    <div class="row row-21">
      ${tipsCard(tips)}
      ${rrCard(rr, overall)}
    </div>
    <div class="row row-2">
      ${goalCard(comp, mmr, profile, ctx.prefs.goal)}
      ${economyCard(economyStats(comp))}
    </div>
    <div class="row row-3">
      ${roundsCard(rounds, overall)}
      ${partyCard(parties)}
      ${tiltCard(tilt)}
    </div>
    <div class="row row-21">
      ${mapsCard(comp, maps)}
      ${actsCard(profile.rank?.acts || [])}
    </div>
    ${agentsCard(agents)}
  </section>`;
}

// ------------------------------------------------------------------ MMR
function mmrCard(mmr, profile) {
  const est = mmr.estimate, vis = mmr.visible;
  if (!Number.isFinite(est)) return html`<div class="card"><div class="empty">Pas encore assez de données pour estimer ton MMR.</div></div>`;
  const tEst = tier(tierAt(est));
  const tVis = Number.isFinite(vis) ? tier(tierAt(vis)) : tier(profile.rank?.tier);
  const lo = Math.floor((Math.min(est, vis || est) - 160) / 100) * 100;
  const hi = Math.ceil((Math.max(est, vis || est) + 160) / 100) * 100;
  const x = (p) => ((p - lo) / (hi - lo)) * 100;
  const segs = [];
  for (let p = lo; p < hi; p += 100) segs.push(p);
  const color = mmr.verdict === "au-dessus" ? "var(--win)" : mmr.verdict === "en dessous" ? "var(--red)" : "var(--gold)";
  const verdictText = { "au-dessus": "au-dessus de ton rang", "en dessous": "en dessous de ton rang", "aligné": "aligné avec ton rang", inconnu: "" }[mmr.verdict];

  return html`<div class="card accent mmr-card">
    <div class="card-head"><span class="card-title">MMR caché estimé</span>
      <span class="pill ${mmr.confidence >= 0.7 ? "green" : mmr.confidence >= 0.4 ? "gold" : "red"}" data-tip="Basée sur ${mmr.withLobby} lobbies et ${mmr.matches} matchs récents">Confiance ${mmr.confidenceLabel.toLowerCase()}</span>
    </div>
    <div class="mmr-main">
      <img src="${tEst.icon}" alt="" class="mmr-icon">
      <div>
        <div class="mmr-value" style="color:${tEst.color}">${tEst.name} <span class="mmr-rr">≈ ${rrAt(est)}</span></div>
        <div class="mmr-verdict" style="color:${color}">${Number.isFinite(mmr.diff) ? `${signed(mmr.diff)} points · ` : ""}${verdictText}</div>
        <div class="muted" style="margin-top:4px">Rang affiché : <b style="color:var(--text)">${tVis.name}${Number.isFinite(vis) ? ` · ${rrAt(vis)} RR` : ""}</b></div>
      </div>
    </div>
    <div class="gauge">
      <div class="gauge-track">
        ${segs.map((p) => html`<div class="gauge-seg" style="left:${x(p)}%;width:${x(p + 100) - x(p)}%;--c:${tier(tierAt(p)).color}"><span>${tier(tierAt(p)).name}</span></div>`)}
        ${Number.isFinite(vis) ? html`<div class="gauge-mark vis" style="left:${x(vis)}%" data-tip="Ton rang affiché : ${tVis.name} ${rrAt(vis)} RR"><span>Rang</span></div>` : ""}
        <div class="gauge-mark est" style="left:${x(est)}%;--c:${color}" data-tip="MMR estimé : ${tEst.name} ≈ ${rrAt(est)}"><span>MMR</span></div>
      </div>
    </div>
    <div class="mmr-facts">
      <div data-tip="RR moyen gagné par victoire (derniers matchs)"><b class="win">${signed(mmr.avgGain, 1)}</b><span>Gain moyen</span></div>
      <div data-tip="RR moyen perdu par défaite (derniers matchs)"><b class="loss">${signed(mmr.avgLoss, 1)}</b><span>Perte moyenne</span></div>
      <div data-tip="Rang moyen des 9 autres joueurs de tes parties"><b>${Number.isFinite(mmr.lobby) ? tier(tierAt(mmr.lobby)).name : "–"}</b><span>Niveau des lobbies</span></div>
      <div><b>${Math.round(mmr.confidence * 100)} %</b><span>Confiance</span><div class="bar-track wr"><span style="width:${mmr.confidence * 100}%"></span></div></div>
    </div>
  </div>`;
}

function explainCard(mmr) {
  const label = (p) => (Number.isFinite(p) ? `${tier(tierAt(p)).name} (≈ ${rrAt(p)})` : "inconnu");
  const lobby = label(mmr.lobby);
  const lobbyNow = label(mmr.lobbyNow);
  return html`<div class="card explain">
    <div class="card-head"><span class="card-title">Comment c'est calculé</span></div>
    <ol class="steps">
      <li><b>Le MMR, c'est ta vraie cote</b>. Riot le garde secret et s'en sert pour choisir tes adversaires et décider combien de RR tu gagnes. Ton rang affiché court derrière lui.</li>
      <li><b>Niveau de tes lobbies</b>. Le matchmaking te met avec des joueurs de MMR proche : leur rang moyen sur tes ${mmr.withLobby} dernières parties est <b>${lobby}</b>. En donnant plus de poids aux toutes dernières, on obtient <b>${lobbyNow}</b>.</li>
      <li><b>Tes gains de RR</b>. Si ton MMR est au-dessus de ton rang, tu gagnes plus que tu ne perds. Toi : <b>${signed(mmr.avgGain, 1)} / ${signed(mmr.avgLoss, 1)}</b>, soit une correction de <b>${signed(mmr.offset)} points</b>.</li>
      <li><b>Le mélange</b>. 65 % niveau des lobbies + 35 % (rang affiché + correction). 100 points = une division.</li>
    </ol>
    <p class="muted small">C'est une estimation : les joueurs sans rang ou en groupe avec un gros écart de niveau la faussent un peu. Elle devient fiable au-delà de 15 à 20 classées.</p>
  </div>`;
}

// ------------------------------------------------------------------ progression chart
function progressionCard(mmr) {
  const pts = mmr.series.filter((s) => Number.isFinite(s.visible) || Number.isFinite(s.mmr)).slice(-40);
  if (pts.length < 2) return html`<div class="card"><div class="card-head"><span class="card-title">Progression</span></div><div class="empty">La courbe apparaîtra après quelques classées.</div></div>`;
  const W = 1100, H = 260, left = 110, right = 16, top = 16, bottom = 22;
  const values = pts.flatMap((s) => [s.visible, s.mmr]).filter(Number.isFinite);
  const lo = Math.floor((Math.min(...values) - 30) / 100) * 100;
  const hi = Math.ceil((Math.max(...values) + 30) / 100) * 100;
  const y = (v) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const x = (i) => left + (i / (pts.length - 1)) * (W - left - right);
  const path = (key) => {
    let d = "", pen = false;
    pts.forEach((s, i) => {
      if (!Number.isFinite(s[key])) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const bands = [];
  for (let p = lo; p < hi; p += 100) {
    const t = tier(tierAt(p));
    bands.push(html`<rect x="${left}" y="${y(p + 100)}" width="${W - left - right}" height="${y(p) - y(p + 100)}" fill="${t.color}" fill-opacity="${(p / 100) % 2 ? 0.05 : 0.09}"/>
      <image href="${t.small || t.icon}" x="4" y="${(y(p + 50) - 11).toFixed(1)}" width="22" height="22"/>
      <text class="axis" x="32" y="${(y(p + 50) + 4).toFixed(1)}" style="fill:${t.color};font-family:var(--font);font-weight:700">${t.name}</text>`);
  }
  const dots = pts.map((s, i) => Number.isFinite(s.visible) ? html`<circle class="prog-dot" cx="${x(i).toFixed(1)}" cy="${y(s.visible).toFixed(1)}" r="5" fill="${s.result === "win" ? "#20d9a6" : s.result === "draw" ? "#c9b27c" : "#ff4655"}" data-match="${s.id}"
      data-tip="${RESULT[s.result]} · ${map(s.map).name} · ${agent(s.agent).name}\n${s.earned !== null ? `${signed(s.earned)} RR → ` : ""}${tier(tierAt(s.visible)).name} ${rrAt(s.visible)} RR${Number.isFinite(s.mmr) ? `\nMMR estimé : ${tier(tierAt(s.mmr)).name} ≈ ${rrAt(s.mmr)}` : ""}\n${dayLabel(s.start)}"/>` : "");

  return html`<div class="card">
    <div class="card-head"><span class="card-title">Progression · ${pts.length} dernières classées</span>
      <span class="legend"><span><i class="line" style="background:var(--text)"></i>Rang affiché</span><span><i class="line" style="background:var(--gold)"></i>MMR estimé</span><span><i style="background:#20d9a6;border-radius:50%"></i>Victoire</span><span><i style="background:#ff4655;border-radius:50%"></i>Défaite</span></span>
    </div>
    <svg class="chart prog" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
      ${bands}
      <path d="${path("mmr")}" fill="none" stroke="#f5c451" stroke-width="2.5" stroke-dasharray="7 5" stroke-linejoin="round"/>
      <path d="${path("visible")}" fill="none" stroke="#ece8e1" stroke-width="2.5" stroke-linejoin="round"/>
      ${dots}
    </svg>
  </div>`;
}

// ------------------------------------------------------------------ cards
function tipsCard(tips) {
  const icon = { good: "▲", warn: "!", info: "i" };
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Conseils pour monter</span><span class="muted small">générés à partir de tes classées</span></div>
    ${tips.length ? html`<div class="tips">${tips.slice(0, 6).map((t) => html`<div class="tip-item ${t.level}">
      <span class="tip-icon">${icon[t.level]}</span>
      <div><b>${t.title}</b><p>${t.text}</p></div>
    </div>`)}</div>` : html`<div class="empty">Rien à signaler pour l'instant : joue encore quelques classées pour débloquer des conseils.</div>`}
  </div>`;
}

function rrCard(rr, s) {
  const streak = rr.streak.type ? `${rr.streak.len} ${rr.streak.type === "win" ? "victoire" : "défaite"}${rr.streak.len > 1 ? "s" : ""}` : "–";
  const item = (value, label, cls = "", tip = "") => html`<div class="hl" ${tip ? html`data-tip="${tip}"` : ""}><b class="num ${cls}">${value}</b><span>${label}</span></div>`;
  return html`<div class="card">
    <div class="card-head"><span class="card-title">RR & résultats</span></div>
    <div class="highlights">
      ${item(signed(rr.net), "RR net", rr.net >= 0 ? "win" : "loss", `Sur ${rr.matches} classées`)}
      ${item(pctS(s.winrate), "Winrate", s.winrate >= 0.5 ? "win" : "loss", `${s.wins} V · ${s.losses} D`)}
      ${item(signed(rr.avgGain, 1), "Gain moyen", "win")}
      ${item(signed(rr.avgLoss, 1), "Perte moyenne", "loss")}
      ${item(streak, "Série en cours", rr.streak.type === "win" ? "win" : rr.streak.type === "loss" ? "loss" : "")}
      ${item(`${rr.longestWin} / ${rr.longestLoss}`, "Plus longues séries V / D")}
    </div>
    <div class="rows" style="margin-top:12px">
      ${rr.best ? matchLine(rr.best, "Plus gros gain") : ""}
      ${rr.worst && rr.worst !== rr.best ? matchLine(rr.worst, "Plus grosse perte") : ""}
    </div>
  </div>`;
}

function matchLine(m, label) {
  return html`<button type="button" class="row-item" data-match="${m.id}">
    <img class="icon" src="${agent(m.agent).icon}" alt="">
    <div class="row-main"><div class="row-name">${label}</div><div class="row-sub">${map(m.map_id).name} · ${m.my_score}–${m.enemy_score} · ${ago(m.start)}</div></div>
    <span class="rr ${m.rr.earned > 0 ? "up" : "down"}">${signed(m.rr.earned)} RR</span>
  </button>`;
}

function split(label, rate, detail, tip, good = rate >= 0.5) {
  return html`<div class="split" data-tip="${tip || ""}">
    <div class="split-head"><span>${label}</span><b class="${good ? "win" : "loss"}">${pctS(rate)}</b></div>
    <div class="bar-track ${good ? "wr" : ""}"><span style="width:${Number.isFinite(rate) ? rate * 100 : 0}%"></span></div>
    <div class="split-sub">${detail}</div>
  </div>`;
}

function roundsCard(r, s) {
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Rounds</span><span class="muted small">${r.matches} matchs analysés</span></div>
    ${r.matches ? html`
      ${split("Attaque", r.atkRate, `${r.atk[0]} / ${r.atk[1]} rounds gagnés`)}
      ${split("Défense", r.defRate, `${r.def[0]} / ${r.def[1]} rounds gagnés`)}
      ${split("Rounds pistol", r.pistolRate, `${r.pistols[0]} / ${r.pistols[1]} gagnés`, "Rounds 1 et 13 : ils décident souvent des 2 rounds suivants")}
      ${split("Round gagné après ton first kill", r.fbConv, `${r.fbWon} / ${r.fb} rounds · ${s.firstBloods} first bloods`)}
      ${split("Round gagné après ta first death", r.fdConv, `${r.fdWon} / ${r.fd} rounds · ${s.firstDeaths} first deaths`)}
    ` : html`<div class="empty">Disponible pour les classées synchronisées avec cette version.</div>`}
  </div>`;
}

function partyCard(parties) {
  const shown = parties.filter((p) => p.matches);
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Solo ou en groupe</span></div>
    ${shown.length ? shown.map((p) => split(p.label, p.winrate, `${p.matches} match${p.matches > 1 ? "s" : ""} · ${signed(p.rr)} RR · K/D ${n2(p.kd)}`)) : html`<div class="empty">Pas encore de données de groupe.</div>`}
  </div>`;
}

function tiltCard(t) {
  const line = (label, s, tip) => (s.games ? split(label, s.rate, `${s.wins} / ${s.games} · ${signed(s.rr)} RR`, tip) : "");
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Mental & sessions</span></div>
    ${line("Après une victoire", t.afterWin)}
    ${line("Après une défaite", t.afterLoss, "Même session (moins d'1 h entre deux parties)")}
    ${line("Après 2 défaites d'affilée", t.afterTwoLosses)}
    <div class="mini-split">${t.byIndex.map((b) => html`<div data-tip="${b.label} de la session : ${b.wins} / ${b.games}"><b class="${b.rate >= 0.5 ? "win" : "loss"}">${pctS(b.rate)}</b><span>${b.label}</span></div>`)}</div>
    <div class="mini-split">${t.byHour.map((b) => html`<div data-tip="${b.label} : ${b.wins} / ${b.games}"><b class="${b.rate >= 0.5 ? "win" : "loss"}">${pctS(b.rate)}</b><span>${b.label}</span></div>`)}</div>
  </div>`;
}

function mapsCard(comp, maps) {
  const bySide = {};
  for (const m of comp) {
    if (!m.sides) continue;
    const e = (bySide[m.map_id] ||= { atk: [0, 0], def: [0, 0], rr: 0 });
    e.atk[0] += m.sides.atk[0]; e.atk[1] += m.sides.atk[1];
    e.def[0] += m.sides.def[0]; e.def[1] += m.sides.def[1];
  }
  const rrBy = {};
  for (const m of comp) rrBy[m.map_id] = (rrBy[m.map_id] || 0) + (m.rr?.earned || 0);
  const rate = (a) => (a && a[1] ? a[0] / a[1] : NaN);
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Cartes en compétitif</span></div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Carte</th><th>Matchs</th><th>Winrate</th><th>Attaque</th><th>Défense</th><th>K/D</th><th>ACS</th><th>RR net</th></tr></thead>
      <tbody>${maps.map((r) => {
        const s = bySide[r.id];
        const m = map(r.id);
        return html`<tr>
          <td><div class="agent-cell"><img src="${m.list_icon || m.splash}" alt="" style="width:64px;height:30px;object-fit:cover"><b>${m.name}</b></div></td>
          <td class="num">${r.matches}</td>
          <td class="num ${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</td>
          <td class="num">${pctS(rate(s?.atk))}</td>
          <td class="num">${pctS(rate(s?.def))}</td>
          <td class="num">${n2(r.kd)}</td>
          <td class="num">${n0(r.acs)}</td>
          <td class="num ${rrBy[r.id] >= 0 ? "win" : "loss"}">${signed(rrBy[r.id])}</td>
        </tr>`;
      })}</tbody>
    </table></div>
  </div>`;
}

function actsCard(acts) {
  const list = [...acts].reverse();
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Historique des actes</span></div>
    ${list.length ? html`<div class="rows acts">${list.map((a) => {
      const t = tier(a.tier), p = tier(a.peak);
      return html`<div class="row-item" data-tip="${a.games} parties · ${a.wins} victoires${a.peak > a.tier ? `\nPeak de l'acte : ${p.name}` : ""}">
        <img class="icon" src="${t.icon}" alt="" style="background:none;object-fit:contain">
        <div class="row-main"><div class="row-name" style="color:${t.color}">${t.name}</div><div class="row-sub">${a.name || "Acte"}</div></div>
        <div class="row-stats"><div><b>${a.games}</b><span>parties</span></div><div><b class="${a.wins / a.games >= 0.5 ? "win" : "loss"}">${pctS(a.wins / a.games)}</b><span>WR</span></div></div>
      </div>`;
    })}</div>` : html`<div class="empty">Disponible après la prochaine synchro avec Valorant ouvert.</div>`}
  </div>`;
}

function agentsCard(agents) {
  if (!agents.length) return "";
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Agents en compétitif</span></div>
    <div class="agent-strip">${agents.slice(0, 8).map((r) => html`<button type="button" class="agent-chip" data-agent="${r.id}">
      <img src="${agent(r.id).icon}" alt="">
      <div><b>${r.name}</b><span>${r.matches} · <em class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</em> · ${n0(r.acs)} ACS · ${n1(r.kd)} K/D</span></div>
    </button>`)}</div>
  </div>`;
}

// ------------------------------------------------------------------ goal & economy
function goalCard(comp, mmr, profile, goal) {
  const current = Number.isFinite(mmr?.visible) ? mmr.visible : (profile.rank?.tier || 0) * 100 + (profile.rank?.rr || 0);
  const currentTier = tierAt(current);
  const target = goal && goal > currentTier ? goal : Math.min(27, currentTier + 1);
  const g = rankGoal(comp, current, target);
  const tNow = tier(currentTier), tGoal = tier(target);
  const floor = currentTier * 100;
  const progress = Math.max(0, Math.min(1, (current - floor) / Math.max(1, target * 100 - floor)));
  const options = [];
  for (let t = Math.max(3, currentTier + 1); t <= 27; t++) options.push(t);

  return html`<div class="card accent goal-card">
    <div class="card-head"><span class="card-title">Objectif de rang</span>
      <label class="select"><select data-goal aria-label="Rang visé">${options.map((t) => html`<option value="${t}" ${t === target ? "selected" : ""}>${tier(t).name}</option>`)}</select></label>
    </div>
    <div class="goal-track">
      <div class="goal-end"><img src="${tNow.icon}" alt=""><span>${tNow.name}</span></div>
      <div class="goal-bar"><div class="bar-track wr" style="height:10px;border-radius:5px"><span style="width:${progress * 100}%"></span></div>
        <div class="goal-left">${g.reached ? "Objectif atteint !" : html`Il te faut <b style="color:var(--text)">+${Math.round(g.needed)} RR</b> (tu es à ${rrAt(current)} RR)`}</div></div>
      <div class="goal-end"><img src="${tGoal.icon}" alt=""><span style="color:${tGoal.color}">${tGoal.name}</span></div>
    </div>
    ${g.reached ? "" : goalPlan(g, tGoal)}
  </div>`;
}

/** Plain-language plan: RR per win/loss, wins in a row, and what 10 games can give. */
function goalPlan(g, tGoal) {
  const gain = Math.round(g.gain), loss = Math.round(g.loss);
  const needed = Math.ceil(g.needed);
  const streak = Math.ceil(needed / Math.max(1, gain));
  const net = (w) => w * gain + (10 - w) * loss;
  const minUp = [...Array(11).keys()].find((w) => net(w) > 0) ?? 10;
  const minGoal = [...Array(11).keys()].find((w) => net(w) >= needed);
  const pace = Math.round(g.winrate * 10);
  const rows = [];
  for (let w = Math.max(0, Math.min(minUp, pace) - 1); w <= 10; w++) {
    rows.push(w);
    if (minGoal !== undefined && w >= minGoal + 1) break;
  }
  const maxAbs = Math.max(...rows.map((w) => Math.abs(net(w))), needed);

  return html`<div class="goal-facts">
      <div><b class="win">+${gain} RR</b><span>en moyenne par victoire</span></div>
      <div><b class="loss">${loss} RR</b><span>en moyenne par défaite</span></div>
      <div data-tip="${streak} × ${gain} RR = ${streak * gain} RR"><b>${streak} victoire${streak > 1 ? "s" : ""}</b><span>d'affilée pour passer ${tGoal.name}</span></div>
    </div>
    <div class="card-title" style="margin:16px 0 8px">Sur tes 10 prochaines parties, selon tes victoires</div>
    <div class="goal-table">${rows.map((w) => {
      const n = net(w);
      return html`<div class="goal-row ${w === pace ? "pace" : ""}" data-tip="${w} × ${gain} RR ${10 - w ? `− ${10 - w} × ${Math.abs(loss)} RR` : ""} = ${n > 0 ? "+" : ""}${n} RR">
        <span class="goal-wl">${w} victoire${w > 1 ? "s" : ""} · ${10 - w} défaite${10 - w > 1 ? "s" : ""}${w === pace ? html` <em>ton rythme</em>` : ""}</span>
        <div class="goal-rowbar"><span class="${n >= 0 ? "up" : "down"}" style="width:${(Math.abs(n) / maxAbs) * 50}%"></span></div>
        <b class="${n > 0 ? "win" : n < 0 ? "loss" : ""}">${n > 0 ? "+" : ""}${n} RR</b>
        <span class="goal-flag">${n >= needed ? html`<span class="pill green">${tGoal.name} ✓</span>` : ""}</span>
      </div>`;
    })}</div>
    <p class="goal-summary">En résumé : il faut gagner <b>au moins ${minUp} parties sur 10</b> pour monter${minGoal !== undefined ? html`, et <b>${minGoal} sur 10</b> pour passer ${tGoal.name} en 10 parties` : ""}.
      En ce moment tu en gagnes environ <b class="${pace >= minUp ? "win" : "loss"}">${pace} sur 10</b>${pace < minUp ? ", donc tu perds un peu de RR à chaque série" : ""}.</p>`;
}

function economyCard(e) {
  if (!e.rounds) return html`<div class="card"><div class="card-head"><span class="card-title">Économie</span></div><div class="empty">Disponible après la prochaine synchro (tes matchs récents seront mis à jour).</div></div>`;
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Économie</span><span class="muted small">${e.rounds} rounds analysés</span></div>
    <div class="eco-grid">${e.buys.map((b) => html`<div class="eco" data-tip="${b.won} rounds gagnés sur ${b.played}">
      <span>${b.label}</span><b class="${b.rate >= 0.5 ? "win" : "loss"}">${pctS(b.rate)}</b><small>${b.played} rounds</small>
    </div>`)}</div>
    ${split("Rounds perdus en full buy contre une éco", e.antiEco.rate, `${e.antiEco.lost} / ${e.antiEco.played} · idéalement sous 15 %`, "Ton équipe achète tout, l'adversaire joue une éco… et gagne quand même", !(e.antiEco.rate > 0.15))}
    ${split("Rounds volés en éco/force contre un full buy", e.upsets.rate, `${e.upsets.won} / ${e.upsets.played} · au-dessus de 25 %, c'est très bien`, "", e.upsets.rate >= 0.25)}
    <div class="mini-split" style="grid-template-columns:repeat(2,minmax(0,1fr))">
      <div data-tip="Crédits dépensés divisés par tes kills"><b>${n0(e.creditsPerKill)}</b><span>Crédits par kill</span></div>
      <div><b>${n0(e.creditsPerRound)}</b><span>Crédits dépensés par round</span></div>
    </div>
  </div>`;
}
