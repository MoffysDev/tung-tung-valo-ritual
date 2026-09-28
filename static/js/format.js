// Formatting helpers and labels. Everything user-controlled goes through esc().

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes interpolations unless wrapped in raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ""));
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

export const QUEUES = {
  competitive: "Compétitif",
  unrated: "Non classé",
  swiftplay: "Vélocité",
  spikerush: "Spike Rush",
  deathmatch: "Combat à mort",
  hurm: "Combat à mort par équipe",
  ggteam: "Escalade",
  premier: "Premier",
  onefa: "Réplication",
  snowball: "Boules de neige",
  newmap: "Nouvelle carte",
  skirmish2v2: "Escarmouche 2v2",
  skirmishascension2v2: "Escarmouche Ascension",
  abilitydraftarena: "Ability Draft",
  custom: "Partie perso",
};
export const queueName = (q) => QUEUES[(q || "").toLowerCase()] || (q ? q.charAt(0).toUpperCase() + q.slice(1) : "Inconnu");

export const CATEGORIES = {
  Sidearm: "Pistolets",
  SMG: "Mitraillettes",
  Shotgun: "Fusils à pompe",
  Rifle: "Fusils",
  Sniper: "Fusils de précision",
  Heavy: "Mitrailleuses",
  Melee: "Mêlée",
};
export const CATEGORY_ORDER = ["Rifle", "Sidearm", "SMG", "Sniper", "Shotgun", "Heavy", "Melee"];

export const RESULT = { win: "Victoire", loss: "Défaite", draw: "Égalité" };

const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat("fr-FR");
export const n0 = (v) => (Number.isFinite(v) ? nf0.format(Math.round(v)) : "–");
export const n1 = (v) => (Number.isFinite(v) ? nf1.format(v) : "–");
export const n2 = (v) => (Number.isFinite(v) ? nf2.format(v) : "–");
export const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}` : "–");
/** Percentage with its unit, or a dash when unknown. */
export const pctS = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "–");

export function duration(ms) {
  if (!ms) return "0 min";
  const h = Math.floor(ms / 3.6e6);
  const m = Math.floor((ms % 3.6e6) / 6e4);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

export function ago(ts, now = Date.now()) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "à l'instant";
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 30 ? `il y a ${d} j` : new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function dayLabel(ts, now = new Date()) {
  if (!ts) return "Date inconnue";
  const d = new Date(ts);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

export const clock = (ts) => (ts ? new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");

/** "Name#TAG" -> html with dimmed tag */
export function riotName(name, fallback = "Joueur masqué") {
  if (!name) return html`<span class="hidden-name">${fallback}</span>`;
  const [game, tag] = String(name).split("#");
  return html`${game}${tag !== undefined ? html`<span class="tag">#${tag}</span>` : ""}`;
}

export const PARTY_COLORS = ["#f5c451", "#4fb4ff", "#c77dff", "#1fd6a4", "#ff8a4c"];

export const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
