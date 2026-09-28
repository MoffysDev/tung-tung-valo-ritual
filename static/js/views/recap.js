import { agent, map, tier } from "../content.js";
import { html, n0, n2, queueName, RESULT } from "../format.js";
import { sortByDate, summarize } from "../stats.js";

/** Small end-of-match card: result, RR and how the game compares to your recent average. */
export function recapHtml(m, all) {
  const r = m.result || (m.won ? "win" : "loss");
  const others = sortByDate(all.filter((x) => x.id !== m.id && x.queue === m.queue)).slice(0, 20);
  const avg = summarize(others);
  const kd = m.kills / Math.max(1, m.deaths);
  const hs = m.hs_percent;
  const cmp = (value, ref, fmt, label) => {
    if (!Number.isFinite(value)) return "";
    const d = Number.isFinite(ref) ? value - ref : NaN;
    return html`<div class="recap-stat"><b>${fmt(value)}</b><span>${label}</span>
      ${Number.isFinite(d) ? html`<em class="${d >= 0 ? "win" : "loss"}">${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))} vs moy.</em>` : ""}</div>`;
  };
  const board = [...(m.scoreboard || [])].sort((a, b) => (b.acs ?? 0) - (a.acs ?? 0));
  const place = board.findIndex((p) => p.is_me) + 1;
  const rank = m.rr ? tier(m.rr.tier_after) : null;
  const mp = map(m.map_id);
  return html`<div class="recap r-${r}">
    <div class="recap-bg" style="background-image:url('${mp.list_icon || mp.splash}')"></div>
    <button type="button" class="recap-close" data-recap-close aria-label="Fermer">&times;</button>
    <div class="recap-head">
      <img src="${agent(m.agent).icon}" alt="">
      <div>
        <div class="card-title">Fin de match · ${queueName(m.queue)} · ${mp.name}</div>
        <div class="recap-result ${r}">${RESULT[r]}${m.my_score || m.enemy_score ? ` ${m.my_score}–${m.enemy_score}` : ""}</div>
      </div>
      ${m.rr ? html`<div class="recap-rr ${m.rr.earned >= 0 ? "win" : "loss"}">${m.rr.earned > 0 ? "+" : ""}${m.rr.earned}<small>RR</small>${rank ? html`<span>${rank.name} · ${m.rr.after} RR</span>` : ""}</div>` : ""}
    </div>
    <div class="recap-stats">
      <div class="recap-stat"><b>${m.kills}/${m.deaths}/${m.assists}</b><span>KDA${place ? ` · ${place === 1 ? "MVP" : `${place}e`}` : ""}</span></div>
      ${cmp(m.acs, avg.acs, n0, "ACS")}
      ${cmp(kd, avg.kd, n2, "K/D")}
      ${cmp(hs, avg.hsRate * 100, (v) => `${Math.round(v)}%`, "HS")}
    </div>
    <button type="button" class="btn btn-primary" data-match="${m.id}" style="width:100%">Voir le détail du match</button>
  </div>`;
}
