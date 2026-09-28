import { agent, map } from "../content.js";
import { html, n0, n2, pctS } from "../format.js";
import { byAgent, byMap, sortByDate, summarize } from "../stats.js";
import { row as matchRow } from "./history.js";

const COLUMNS = [
  { key: "matches", label: "Matchs", fmt: (r, max) => bar(r.matches, r.matches / max.matches) },
  { key: "winrate", label: "Winrate", fmt: (r) => bar(html`<span class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</span>`, r.winrate, r.winrate >= 0.5 ? "var(--win)" : "var(--red)") },
  { key: "kd", label: "K/D", fmt: (r) => html`<span class="${r.kd >= 1 ? "win" : ""}">${n2(r.kd)}</span>` },
  { key: "kda", label: "KDA", fmt: (r) => n2(r.kda) },
  { key: "acs", label: "ACS", fmt: (r, max) => bar(n0(r.acs), Number.isFinite(r.acs) ? r.acs / max.acs : 0, "var(--gold)") },
  { key: "adr", label: "ADR", fmt: (r) => n0(r.adr) },
  { key: "hsRate", label: "HS%", fmt: (r) => pctS(r.hsRate) },
  { key: "kast", label: "KAST", fmt: (r) => pctS(r.kast) },
  { key: "firstBloods", label: "FB", fmt: (r) => r.firstBloods },
  { key: "playtime", label: "Temps", fmt: (r) => (r.playtime ? `${(r.playtime / 3.6e6).toFixed(1).replace(".", ",")} h` : "–") },
];
let sort = { key: "matches", asc: false };

function bar(label, ratio, color) {
  return html`<span class="cell-bar">${label}<i style="--w:${Math.round(Math.max(0, Math.min(1, ratio || 0)) * 100)}%${color ? `;--c:${color}` : ""}"></i></span>`;
}

export function render(ctx) {
  const rows = byAgent(ctx.matches);
  const val = (r) => (Number.isFinite(r[sort.key]) ? r[sort.key] : -Infinity);
  const sorted = [...rows].sort((a, b) => (sort.asc ? val(a) - val(b) : val(b) - val(a)));
  const total = ctx.matches.length;
  const max = { matches: Math.max(1, ...rows.map((r) => r.matches)), acs: Math.max(1, ...rows.map((r) => (Number.isFinite(r.acs) ? r.acs : 0))) };

  if (!rows.length) return html`<section class="view"><div class="card"><div class="empty"><strong>Aucun agent</strong>Aucun match pour ces filtres.</div></div></section>`;

  return html`<section class="view">
    <div class="agent-grid">${rows.slice(0, 8).map((r, i) => {
      const a = agent(r.id);
      return html`<button type="button" class="agent-card" data-agent="${r.id}">
        ${a.color ? html`<div class="glow" style="background:radial-gradient(300px 220px at 70% 30%, ${a.color}, transparent 70%)"></div>` : ""}
        <img class="portrait" src="${a.portrait}" alt="" loading="lazy">
        <span class="rank-no">#${i + 1} · ${pctS(r.matches / total)} des parties</span>
        <h3>${a.name}</h3>
        <span class="role">${a.role || ""}</span>
        <div class="mini">
          <div><b>${r.matches}</b><span>Matchs</span></div>
          <div><b class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</b><span>WR</span></div>
          <div><b>${n2(r.kd)}</b><span>K/D</span></div>
        </div>
      </button>`;
    })}</div>

    <div class="card">
      <div class="card-head"><span class="card-title">Tous les agents · ${rows.length}</span><span class="muted" style="font-size:12px">Clique une colonne pour trier, une ligne pour le détail</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th>Agent</th>
          ${COLUMNS.map((c) => html`<th class="sortable ${sort.key === c.key ? `sorted${sort.asc ? " asc" : ""}` : ""}" data-sort="${c.key}" tabindex="0" aria-sort="${sort.key === c.key ? (sort.asc ? "ascending" : "descending") : "none"}">${c.label}</th>`)}
        </tr></thead>
        <tbody>${sorted.map((r) => {
          const a = agent(r.id);
          return html`<tr data-agent="${r.id}" style="cursor:pointer">
            <td><div class="agent-cell"><img src="${a.icon}" alt=""><div><b>${a.name}</b><small>${a.role || ""}</small></div></div></td>
            ${COLUMNS.map((c) => html`<td class="num">${c.fmt(r, max)}</td>`)}
          </tr>`;
        })}</tbody>
      </table></div>
    </div>
  </section>`;
}

export function agentModal(id, ctx) {
  const a = agent(id);
  const list = sortByDate(ctx.matches.filter((m) => m.agent === id));
  const s = summarize(list);
  const all = summarize(ctx.matches);
  const maps = byMap(list);
  const cmp = (v, ref, fmt) => (Number.isFinite(v) && Number.isFinite(ref)
    ? html`<small class="${v >= ref ? "win" : "loss"}" style="display:block;font:600 11px var(--mono)">${v >= ref ? "▲" : "▼"} vs ${fmt(ref)} global</small>` : "");
  const stat = (value, label, extra = "") => html`<div class="hl"><b class="num">${value}</b><span>${label}</span>${extra}</div>`;

  return html`<div class="modal-hero" style="min-height:220px">
    ${a.color ? html`<div class="map-bg" style="background:radial-gradient(600px 300px at 80% 50%, ${a.color}, transparent 70%);opacity:.45"></div>` : ""}
    <img src="${a.portrait}" alt="" style="position:absolute;right:30px;top:-40px;height:150%;max-width:none;z-index:2;pointer-events:none;mask-image:linear-gradient(180deg,#000 60%,transparent);-webkit-mask-image:linear-gradient(180deg,#000 60%,transparent)">
    <div class="card-title">${a.role || "Agent"}</div>
    <div class="score-big" style="font-size:72px">${a.name}</div>
    <div class="muted" style="margin-top:6px">${list.length} match${list.length > 1 ? "s" : ""} · ${s.wins} V · ${s.losses} D</div>
  </div>
  <div class="modal-section">
    <div class="mini-stats" style="grid-template-columns:repeat(6,minmax(0,1fr))">
      ${stat(pctS(s.winrate), "Winrate", cmp(s.winrate, all.winrate, pctS))}
      ${stat(n2(s.kd), "K/D", cmp(s.kd, all.kd, n2))}
      ${stat(n0(s.acs), "ACS", cmp(s.acs, all.acs, n0))}
      ${stat(n0(s.adr), "ADR", cmp(s.adr, all.adr, n0))}
      ${stat(pctS(s.hsRate), "Headshot", cmp(s.hsRate, all.hsRate, pctS))}
      ${stat(pctS(s.kast), "KAST", cmp(s.kast, all.kast, pctS))}
    </div>
  </div>
  ${maps.length ? html`<div class="modal-section">
    <div class="card-head"><span class="card-title">Par carte</span></div>
    <div class="rows" style="grid-template-columns:repeat(3,minmax(0,1fr))">${maps.map((r) => {
      const m = map(r.id);
      return html`<div class="map-tile"><div class="map-bg" style="background-image:url('${m.list_icon || m.splash}')"></div>
        <div><div class="map-name">${m.name}</div><div class="row-sub">${r.wins} V · ${r.losses} D</div></div>
        <div class="row-stats"><div><b class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</b><span>WR</span></div><div><b>${n0(r.acs)}</b><span>ACS</span></div></div>
      </div>`;
    })}</div>
  </div>` : ""}
  <div class="modal-section">
    <div class="card-head"><span class="card-title">Derniers matchs avec ${a.name}</span></div>
    ${list.slice(0, 8).map((m) => matchRow(m))}
  </div>`;
}

export function handle(e, rerender) {
  const th = e.target.closest("[data-sort]");
  if (!th || !(e.type === "click" || (e.type === "keydown" && e.key === "Enter"))) return false;
  const key = th.dataset.sort;
  sort = sort.key === key ? { key, asc: !sort.asc } : { key, asc: false };
  rerender();
  return true;
}
