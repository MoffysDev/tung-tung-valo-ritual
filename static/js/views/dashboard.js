import { agent, cardArt, map, tier, title, weapon } from "../content.js";
import { html, n0, n1, n2, pct, pctS, duration, RESULT, queueName } from "../format.js";
import { bestAgent, byAgent, byMap, highlights, sortByDate, summarize, weaponKills } from "../stats.js";
import { row as matchRow } from "./history.js";

export function render(ctx) {
  const { matches, server, prefs } = ctx;
  const sorted = sortByDate(matches);
  const s = summarize(matches);
  const agents = byAgent(matches);

  return html`<section class="view">
    ${hero(server.profile || {}, prefs)}
    ${matches.length ? html`
      ${kpis(s, sorted)}
      <div class="row row-21">
        ${performanceCard(sorted.slice(0, 25))}
        ${spotlight(bestAgent(agents))}
      </div>
      <div class="row row-21">
        ${recentCard(sorted.slice(0, 6))}
        ${highlightsCard(s, highlights(matches))}
      </div>
      <div class="row row-3">
        ${agentsCard(agents)}
        ${mapsCard(byMap(matches))}
        ${weaponsCard(weaponKills(matches))}
      </div>` : emptyState(ctx)}
  </section>`;
}

// ------------------------------------------------------------------ hero
function hero(profile, prefs) {
  const rank = profile.rank || {};
  const t = tier(rank.tier);
  const peak = rank.peak && rank.peak > (rank.tier || 0) ? tier(rank.peak) : null;
  const name = prefs.streamer ? "" : profile.name;
  const games = rank.act_games || 0;
  const ranked = rank.tier >= 3 && rank.rr != null;
  const R = 48, C = 2 * Math.PI * R;
  const progress = ranked ? Math.min(100, rank.rr) / 100 : 0;

  return html`<div class="hero">
    ${profile.card ? html`<div class="hero-bg" style="background-image:url('${cardArt(profile.card)}')"></div>` : ""}
    <div>
      <div class="hero-title">${title(profile.title)}</div>
      <h2 class="hero-name">${name ? html`${name}${profile.tag ? html`<span class="tag">#${profile.tag}</span>` : ""}` : prefs.streamer ? "Mode streamer" : "Joueur"}</h2>
      <div class="hero-meta">
        ${profile.level ? html`<span class="chip">Niveau <b>${profile.level}</b></span>` : ""}
        ${profile.region ? html`<span class="chip">Serveur <b>${profile.region.toUpperCase()}</b></span>` : ""}
        ${profile.season_name ? html`<span class="chip">${profile.season_name}</span>` : ""}
      </div>
    </div>
    ${games ? html`<div class="hero-act">
      <div class="card-title">Compétitif · acte en cours</div>
      <div><b>${games}</b><span>Parties</span></div>
      <div><b class="${rank.act_wins / games >= 0.5 ? "win" : "loss"}">${Math.round((rank.act_wins / games) * 100)}%</b><span>Victoires</span></div>
      <div><b>${rank.act_wins}–${games - rank.act_wins}</b><span>Bilan</span></div>
    </div>` : html`<div></div>`}
    <div class="rank-block">
      <div class="rank-ring" data-tip="${ranked ? `${rank.rr} / 100 RR avant la prochaine division` : "Pas de rang compétitif cet acte"}">
        <svg viewBox="0 0 104 104"><circle class="track" cx="52" cy="52" r="${R}"/>
          <circle class="value" cx="52" cy="52" r="${R}" stroke="${t.color}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - progress)).toFixed(1)}"/></svg>
        <img src="${t.icon}" alt="">
      </div>
      <div>
        <div class="card-title">Rang actuel</div>
        <div class="rank-name" style="color:${t.color}">${t.name}</div>
        ${ranked ? html`<div class="rank-rr">${rank.rr} RR</div>` : ""}
        ${peak ? html`<div class="rank-peak" data-tip="Meilleur rang atteint (toutes saisons)"><img src="${peak.small || peak.icon}" alt="">Peak <b>${peak.name}</b></div>` : ""}
      </div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ KPIs
function deltaChip(now, before, { fmt = (d) => d.toFixed(0), unit = "", invert = false } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return "";
  const d = now - before;
  const shown = fmt(Math.abs(d));
  if (Number(String(shown).replace(",", ".")) === 0) return html`<span class="delta flat" data-tip="Stable par rapport aux matchs précédents">=</span>`;
  const good = invert ? d < 0 : d > 0;
  return html`<span class="delta ${good ? "up" : "down"}" data-tip="Tes derniers matchs comparés aux précédents">${d > 0 ? "▲" : "▼"} ${shown}${unit}</span>`;
}

let sparkId = 0;
function spark(values, color) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 3) return "";
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  const coords = values.map((v, i) => (Number.isFinite(v) ? [i * step, 36 - ((v - min) / span) * 32] : null)).filter(Boolean);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const id = `spark${++sparkId}`;
  return html`<svg class="kpi-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line}L${coords[coords.length - 1][0].toFixed(1)},40L${coords[0][0].toFixed(1)},40Z" fill="url(#${id})"/>
    <path class="line" d="${line}" stroke="${color}"/>
  </svg>`;
}

function kpi(label, value, sub, { unit = "", delta = "", sparkline = "" } = {}) {
  const missing = value === "–";
  return html`<div class="kpi" ${missing ? html`data-tip="Disponible après la prochaine synchro avec Valorant ouvert"` : ""}>
    <div class="kpi-top"><span class="kpi-label">${label}</span>${delta}</div>
    <div class="kpi-value num ${missing ? "muted" : ""}">${value}${unit && !missing ? html`<small>${unit}</small>` : ""}</div>
    <div class="kpi-sub">${sub}</div>
    ${sparkline}
  </div>`;
}

function kpis(s, sorted) {
  const n = Math.min(20, Math.floor(sorted.length / 2));
  const cur = n >= 5 ? summarize(sorted.slice(0, n)) : null;
  const prev = n >= 5 ? summarize(sorted.slice(n, 2 * n)) : null;
  const d = (key, opts) => (cur ? deltaChip(cur[key], prev[key], opts) : "");
  const last = [...sorted.slice(0, 20)].reverse();
  let wins = 0;
  const rollingWr = last.map((m, i) => { wins += (m.result || (m.won ? "win" : "loss")) === "win" ? 1 : 0; return wins / (i + 1); });
  const series = (fn) => last.map(fn);
  const pctFmt = (x) => String(Math.round(x * 100));

  return html`<div class="kpis">
    ${kpi("Winrate", pct(s.winrate), `${s.wins} V · ${s.losses} D${s.draws ? ` · ${s.draws} N` : ""}`, { unit: "%", delta: d("winrate", { fmt: pctFmt, unit: " pts" }), sparkline: spark(rollingWr, "#20d9a6") })}
    ${kpi("K/D", n2(s.kd), `KDA ${n2(s.kda)} · ${n1(s.killsPerMatch)} kills/match`, { delta: d("kd", { fmt: (x) => n2(x) }), sparkline: spark(series((m) => m.kills / Math.max(1, m.deaths)), "#f5c451") })}
    ${kpi("ACS", n0(s.acs), "score moyen par round", { delta: d("acs"), sparkline: spark(series((m) => m.acs), "#ff4655") })}
    ${kpi("ADR", n0(s.adr), "dégâts par round", { delta: d("adr"), sparkline: spark(series((m) => (m.v >= 2 ? m.adr : NaN)), "#ff4655") })}
    ${kpi("Headshot", pct(s.hsRate), s.hits ? `${n0(s.hs)} tirs à la tête` : "précision", { unit: "%", delta: d("hsRate", { fmt: pctFmt, unit: " pts" }), sparkline: spark(series((m) => (m.v >= 2 ? m.hs_percent : NaN)), "#4fb4ff") })}
    ${kpi("KAST", pct(s.kast), "kill, assist, survie ou trade", { unit: "%", delta: d("kast", { fmt: pctFmt, unit: " pts" }), sparkline: spark(series((m) => m.kast ?? NaN), "#4fb4ff") })}
    ${kpi("Matchs", n0(s.matches), `${n0(s.rounds)} rounds · ${n0(s.kills)} kills`)}
    ${kpi("Temps de jeu", s.playtime ? duration(s.playtime) : "–", s.matches && s.playtime ? `${Math.round(s.playtime / s.matches / 60000)} min par match` : "")}
  </div>`;
}

// ------------------------------------------------------------------ performance chart
function performanceCard(recent) {
  const ordered = [...recent].reverse();
  if (!ordered.length) return html`<div class="card"></div>`;
  const W = 760, H = 230, left = 34, right = 30, top = 12, bottom = 10;
  const acs = ordered.map((m) => (Number.isFinite(m.acs) ? m.acs : null));
  const kd = ordered.map((m) => m.kills / Math.max(1, m.deaths));
  const known = acs.filter((v) => v !== null);
  const maxAcs = Math.max(300, Math.ceil(Math.max(0, ...known) / 100) * 100);
  const maxKd = Math.min(4, Math.max(2, Math.ceil(Math.max(...kd))));  // outliers are clamped
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const plotW = W - left - right, plotH = H - top - bottom;
  const slot = plotW / ordered.length;
  const bw = Math.min(26, slot * 0.62);
  const yA = (v) => top + plotH - (v / maxAcs) * plotH;
  const yK = (v) => top + plotH - (Math.min(v, maxKd) / maxKd) * plotH;
  const cx = (i) => left + slot * i + slot / 2;

  const grid = [];
  for (let v = 0; v <= maxAcs; v += 100) {
    grid.push(html`<line class="grid-line" x1="${left}" x2="${W - right}" y1="${yA(v)}" y2="${yA(v)}"/><text class="axis" x="${left - 8}" y="${yA(v) + 3}" text-anchor="end">${v}</text>`);
  }
  for (let k = 0; k <= maxKd; k += 1) {
    grid.push(html`<text class="axis" x="${W - right + 8}" y="${yK(k) + 3}" style="fill:#f5c451">${k}</text>`);
  }
  const bars = ordered.map((m, i) => {
    const r = m.result || (m.won ? "win" : "loss");
    const color = r === "win" ? "#20d9a6" : r === "draw" ? "#c9b27c" : "#ff4655";
    const v = acs[i] ?? 0;
    const y = acs[i] === null ? top + plotH - 4 : yA(v);
    const tip = `${RESULT[r]}${m.my_score || m.enemy_score ? ` ${m.my_score}–${m.enemy_score}` : ""} · ${map(m.map_id).name}\n${agent(m.agent).name} · ${m.kills}/${m.deaths}/${m.assists}${acs[i] !== null ? ` · ${Math.round(v)} ACS` : ""}\nClique pour le détail`;
    return html`<rect class="bar" data-match="${m.id}" data-tip="${tip}" x="${(cx(i) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(top + plotH - y).toFixed(1)}" rx="3" fill="${color}" fill-opacity="${acs[i] === null ? 0.3 : 0.85}"/>`;
  });
  const kdPath = kd.map((v, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)},${yK(v).toFixed(1)}`).join("");

  return html`<div class="card accent">
    <div class="card-head">
      <span class="card-title">Performance · ${ordered.length} derniers matchs</span>
      <span class="legend">
        <span><i style="background:#20d9a6"></i>Victoire</span>
        <span><i style="background:#ff4655"></i>Défaite</span>
        <span><i class="line" style="background:#f5c451"></i>K/D</span>
        ${known.length ? html`<span>moy. <b style="color:var(--text)">${Math.round(avg)}</b> ACS</span>` : ""}
      </span>
    </div>
    <div class="form-row">${ordered.map((m) => {
      const r = m.result || (m.won ? "win" : "loss");
      return html`<button type="button" class="pip ${r}" data-match="${m.id}" data-tip="${RESULT[r]} · ${map(m.map_id).name} · ${queueName(m.queue)}">${r === "win" ? "V" : r === "draw" ? "N" : "D"}</button>`;
    })}</div>
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="ACS et K/D des derniers matchs">
        ${grid}
        ${known.length ? html`<line class="avg" x1="${left}" x2="${W - right}" y1="${yA(avg).toFixed(1)}" y2="${yA(avg).toFixed(1)}"/>` : ""}
        ${bars}
        <path class="kd-line" d="${kdPath}"/>
        ${kd.map((v, i) => html`<circle class="kd-dot" cx="${cx(i).toFixed(1)}" cy="${yK(v).toFixed(1)}" r="3"/>`)}
      </svg>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ spotlight
function spotlight(best) {
  if (!best) return html`<div class="card"><div class="empty">Aucun agent joué.</div></div>`;
  const a = agent(best.id);
  return html`<button class="card spotlight" type="button" data-agent="${best.id}" data-tip="Meilleur rapport ACS × winrate (3 matchs minimum)\nClique pour le détail">
    ${a.color ? html`<div class="spotlight-bg" style="background:radial-gradient(420px 300px at 80% 40%, ${a.color}, transparent 70%)"></div>` : ""}
    <img class="spotlight-img" src="${a.portrait}" alt="">
    <div class="spotlight-body">
      <div class="card-title">Meilleur agent</div>
      <div class="spotlight-name">${a.name}</div>
      <div class="muted" style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${a.role || ""}</div>
      <div class="spotlight-stats">
        <div><b>${best.matches}</b><span>Matchs</span></div>
        <div><b class="${best.winrate >= 0.5 ? "win" : "loss"}">${pctS(best.winrate)}</b><span>Winrate</span></div>
        <div><b>${n2(best.kd)}</b><span>K/D</span></div>
        <div><b>${n0(best.acs)}</b><span>ACS</span></div>
      </div>
    </div>
  </button>`;
}

// ------------------------------------------------------------------ lists
function recentCard(recent) {
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Derniers matchs</span><button class="link" type="button" data-nav="history">Historique complet</button></div>
    <div>${recent.map((m) => matchRow(m, { compact: true }))}</div>
  </div>`;
}

function highlightsCard(s, h) {
  const item = (value, label, tip) => html`<div class="hl" ${tip ? html`data-tip="${tip}"` : ""}><b class="num">${value}</b><span>${label}</span></div>`;
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Faits marquants</span></div>
    <div class="highlights">
      ${item(n0(s.firstBloods), "First bloods", `${n0(s.firstDeaths)} first deaths`)}
      ${item(n0(s.clutches), "Clutchs", "Rounds gagnés en étant le dernier en vie")}
      ${item(n0(s.aces), "Aces", "5 kills dans un même round")}
      ${item(n0(s.multikills), "Multi-kills", "3 kills ou plus dans un round")}
      ${item(`${n0(s.plants)}/${n0(s.defuses)}`, "Plants / defuses")}
      ${item(n0(h.bestStreak), "Meilleure série", "Victoires consécutives")}
    </div>
    ${h.best ? html`<button class="row-item" type="button" data-match="${h.best.id}" style="margin-top:12px">
      <img class="icon" src="${agent(h.best.agent).icon}" alt="">
      <div class="row-main"><div class="row-name">Meilleur match · ${map(h.best.map_id).name}</div><div class="row-sub">${queueName(h.best.queue)} · ${h.best.kills}/${h.best.deaths}/${h.best.assists}</div></div>
      <div class="row-stats"><div><b class="win">${n0(h.best.acs)}</b><span>ACS</span></div></div>
    </button>` : ""}
  </div>`;
}

function agentsCard(rows) {
  const top = rows.slice(0, 5);
  const most = Math.max(1, ...top.map((r) => r.matches));
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Agents les plus joués</span><button class="link" type="button" data-nav="agents">Tous</button></div>
    <div class="rows">${top.map((r) => {
      const a = agent(r.id);
      return html`<button class="row-item" type="button" data-agent="${r.id}">
        <img class="icon" src="${a.icon}" alt="">
        <div class="row-main">
          <div class="row-name">${a.name} <span class="muted" style="font-weight:500">· ${r.matches}</span></div>
          <div class="bar-track"><span style="width:${(r.matches / most) * 100}%"></span></div>
        </div>
        <div class="row-stats">
          <div><b class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</b><span>WR</span></div>
          <div><b>${n2(r.kd)}</b><span>K/D</span></div>
        </div>
      </button>`;
    })}</div>
  </div>`;
}

function mapsCard(rows) {
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Cartes</span><span class="muted" style="font-size:12px">${rows.length} jouée${rows.length > 1 ? "s" : ""}</span></div>
    <div class="rows">${rows.slice(0, 5).map((r) => {
      const m = map(r.id);
      return html`<div class="map-tile" data-tip="${m.name} : ${r.wins} V · ${r.losses} D\nK/D ${n2(r.kd)} · ACS ${n0(r.acs)}">
        <div class="map-bg" style="background-image:url('${m.list_icon || m.splash}')"></div>
        <div><div class="map-name">${m.name}</div><div class="row-sub">${r.matches} match${r.matches > 1 ? "s" : ""}</div></div>
        <div class="row-stats">
          <div><b class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</b><span>WR</span></div>
          <div><b>${n2(r.kd)}</b><span>K/D</span></div>
        </div>
      </div>`;
    })}</div>
  </div>`;
}

function weaponsCard(kills) {
  const rows = Object.entries(kills).filter(([w]) => weapon(w)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = Object.values(kills).reduce((a, b) => a + b, 0);
  const most = Math.max(1, ...rows.map((r) => r[1]));
  return html`<div class="card">
    <div class="card-head"><span class="card-title">Armes favorites</span><button class="link" type="button" data-nav="locker">Casier</button></div>
    ${rows.length ? html`<div class="rows">${rows.map(([w, k]) => {
      const wd = weapon(w);
      return html`<button class="row-item" type="button" data-weapon="${w}">
        <img class="icon wide" src="${wd.kill_icon || wd.icon}" alt="">
        <div class="row-main"><div class="row-name">${wd.name}</div><div class="bar-track"><span style="width:${(k / most) * 100}%"></span></div></div>
        <div class="row-stats"><div><b>${k}</b><span>kills</span></div><div><b>${total ? Math.round((k / total) * 100) : 0}%</b><span>part</span></div></div>
      </button>`;
    })}</div>` : html`<div class="empty">Les kills par arme apparaîtront après ta prochaine synchro.</div>`}
  </div>`;
}

function emptyState(ctx) {
  const offline = ctx.server.status?.connection === "offline";
  const hasAny = ctx.all.length > 0;
  return html`<div class="card"><div class="empty">
    <strong>${hasAny ? "Aucun match pour ces filtres" : "Aucun match enregistré pour l'instant"}</strong>
    ${hasAny ? "Change de mode ou de période en haut à droite." : offline
      ? "Lance Valorant : tes 20 derniers matchs seront importés automatiquement."
      : "Synchronisation en cours, tes derniers matchs arrivent…"}
  </div></div>`;
}
