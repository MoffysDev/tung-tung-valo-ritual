import { allWeapons, shortSkin, skin, weapon } from "../content.js";
import { CATEGORIES, CATEGORY_ORDER, html, n1, pctS } from "../format.js";
import { rankSkins, skinStats } from "../stats.js";

export function render(ctx) {
  const stats = skinStats(ctx.matches, ctx.legacy, ctx.filters.queue);
  const loadout = ctx.server.loadout || {};
  const groups = {};
  for (const [wid, w] of allWeapons()) (groups[w.category] ||= []).push([wid, w]);
  for (const list of Object.values(groups)) list.sort((a, b) => (a[1].cost || 0) - (b[1].cost || 0));
  const cats = Object.keys(groups).sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 99) % 99 - (CATEGORY_ORDER.indexOf(b) + 99) % 99);

  return html`<section class="view">
    <div class="card" style="padding:14px 18px">
      <span class="muted">Chaque kill est attribué au skin que tu avais <b style="color:var(--text)">au moment du match</b> (verrouillé automatiquement dès la sélection d'agent). Clique une arme pour comparer tes skins.</span>
    </div>
    ${cats.map((cat) => html`<div class="locker-cat">
      <h3>${CATEGORIES[cat] || cat}</h3>
      <div class="locker-grid">${groups[cat].map(([wid, w]) => card(wid, w, stats[wid], loadout[wid]))}</div>
    </div>`)}
  </section>`;
}

function card(wid, w, perSkin, equipped) {
  const ranked = rankSkins(perSkin);
  const kills = ranked.reduce((a, s) => a + s.kills, 0);
  let skinId = equipped?.skin;
  let chroma = equipped?.chroma;
  let label = "Équipé";
  if (!skinId && ranked.length) {
    skinId = ranked[0].id;
    chroma = null;
    label = "Top 1";
  }
  const s = skin(wid, skinId, chroma);
  const isTop = ranked.length > 1 && ranked[0].id === skinId;
  return html`<button type="button" class="weapon" data-weapon="${wid}" style="${s.tier ? `--tier:${s.tier}` : ""}">
    <div class="weapon-head">
      <span class="weapon-name">${w.name}</span>
      <span class="weapon-kills">${kills} <small>kills</small></span>
    </div>
    <div class="weapon-img"><img src="${s.icon || w.icon}" alt="" loading="lazy"></div>
    <div class="weapon-skin">${isTop ? html`<span class="badge">Top 1</span>` : skinId ? html`<span class="badge soft">${label}</span>` : ""}${shortSkin(wid, s.name)}</div>
  </button>`;
}

export function skinsModal(wid, ctx) {
  const w = weapon(wid);
  if (!w) return "";
  const stats = skinStats(ctx.matches, ctx.legacy, ctx.filters.queue);
  const ranked = rankSkins(stats[wid]);
  const equipped = ctx.server.loadout?.[wid];
  const eq = equipped ? skin(wid, equipped.skin, equipped.chroma) : null;
  const estimated = ranked.reduce((a, s) => a + s.estimated, 0);

  return html`<div class="modal-hero">
    <div class="card-title">Comparateur de skins</div>
    <h2 class="card-title-lg" style="font-size:40px">${w.name}</h2>
    ${eq ? html`<div class="muted" style="margin-top:4px">Équipé : <b style="color:var(--text)">${eq.name}</b></div>` : ""}
  </div>
  <div class="modal-section">
    ${ranked.length ? html`<div class="podium">
      <div class="skin-row" style="background:none;border:0;padding-top:0;padding-bottom:0">
        <span></span><span></span><span></span>
        <span class="card-title" style="text-align:right">Kills</span>
        <span class="card-title" style="text-align:right">K/match</span>
        <span class="card-title opt" style="text-align:right">Matchs</span>
        <span class="card-title opt" style="text-align:right">Winrate</span>
      </div>
      ${ranked.map((r, i) => {
        const s = skin(wid, r.id);
        return html`<div class="skin-row ${i === 0 ? "top" : ""}">
          <div class="skin-rank">#${i + 1}</div>
          <img src="${s.icon}" alt="" loading="lazy">
          <div style="min-width:0"><b>${s.name}</b>${equipped?.skin === r.id ? html` <span class="badge soft">Équipé</span>` : ""}${r.matches < 3 ? html`<div class="muted" style="font-size:11px">Échantillon faible</div>` : ""}</div>
          <div class="stat"><b>${r.kills}</b></div>
          <div class="stat"><b>${n1(r.kpm)}</b></div>
          <div class="stat opt"><b>${r.matches}</b></div>
          <div class="stat opt"><b class="${r.winrate >= 0.5 ? "win" : "loss"}">${pctS(r.winrate)}</b></div>
        </div>`;
      })}
    </div>
    <p class="muted" style="font-size:12px;margin:14px 0 0">Classement par kills/match, pondéré par le nombre de matchs pour éviter qu'un skin joué une seule fois passe devant.${estimated ? ` ${estimated} match${estimated > 1 ? "s" : ""} utilise${estimated > 1 ? "nt" : ""} un loadout estimé (joués avant la première synchro).` : ""}</p>`
    : html`<div class="empty"><strong>Aucun kill enregistré avec cette arme</strong>Joue quelques parties avec, les stats apparaîtront ici.</div>`}
  </div>`;
}
