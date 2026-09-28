import * as api from "./api.js";
import { setContent } from "./content.js";
import { ago, html, queueName } from "./format.js";
import { filterMatches, queuesPresent } from "./stats.js";
import { closeModal, hideTip, modalOpen, openModal, prefs as loadPrefs, savePrefs, toast } from "./ui.js";
import * as dashboard from "./views/dashboard.js";
import * as history from "./views/history.js";
import * as agents from "./views/agents.js";
import * as locker from "./views/locker.js";
import * as live from "./views/live.js";
import { matchModal } from "./views/match.js";

const VIEWS = { dashboard, history, agents, locker, live };
const PAGES = {
  dashboard: ["Dashboard", "Vue d'ensemble de tes performances"],
  history: ["Historique", "Tous tes matchs enregistrés, jour par jour"],
  agents: ["Agents", "Tes performances agent par agent"],
  locker: ["Casier", "Tes skins et les kills réalisés avec chacun"],
  live: ["Match en direct", "Joueurs, rangs et skins de la partie en cours"],
};
const PERIODS = { all: "depuis toujours", act: "sur l'acte en cours", 30: "sur 30 jours", 7: "sur 7 jours", 1: "aujourd'hui" };
const POLL_MS = 2500;
const POLL_HIDDEN_MS = 10000;

const $ = (id) => document.getElementById(id);
const app = $("app");

const S = {
  server: null,
  matches: [],
  legacy: {},
  matchesEtag: null,
  matchesVersion: -1,
  contentEtag: null,
  route: "dashboard",
  filters: { queue: "all", period: "all" },
  prefs: loadPrefs(),
  lastEvent: null,
  lastLiveId: null,
  viewKey: "",
  failures: 0,
};
Object.assign(S.filters, S.prefs.filters || {});

// ------------------------------------------------------------------ rendering
function ctx() {
  const season = S.server?.profile?.season;
  return {
    all: S.matches,
    matches: filterMatches(S.matches, { ...S.filters, season }),
    legacy: S.legacy,
    server: S.server || {},
    filters: S.filters,
    prefs: S.prefs,
  };
}

function viewKey() {
  const srv = S.server || {};
  const base = [S.route, S.matchesVersion, S.filters.queue, S.filters.period, S.prefs.streamer ? 1 : 0];
  switch (S.route) {
    case "dashboard": return JSON.stringify([...base, srv.profile]);
    case "history": return JSON.stringify([...base, srv.status?.backfill]);
    case "locker": return JSON.stringify([...base, srv.loadout]);
    case "live": return JSON.stringify([...base, srv.live?.updated, Math.floor(Date.now() / 30000)]);
    default: return JSON.stringify(base);
  }
}

function render(force = false) {
  if (!S.server) return;
  const key = viewKey();
  if (!force && key === S.viewKey) return;
  const routeChanged = !S.viewKey.startsWith(JSON.stringify([S.route]).slice(0, -1));
  S.viewKey = key;
  app.dataset.anim = routeChanged ? "1" : "0";
  const scroll = window.scrollY;
  hideTip();
  app.innerHTML = String(VIEWS[S.route].render(ctx()));
  window.scrollTo(0, scroll);
  renderPageBar();
}
const rerender = () => render(true);

function renderPageBar() {
  const [title, sub] = PAGES[S.route];
  $("page-title").textContent = title;
  const n = ctx().matches.length;
  $("page-sub").textContent = S.route === "live" ? sub
    : `${sub} · ${n} match${n > 1 ? "s" : ""} ${S.filters.queue === "all" ? "" : `en ${queueName(S.filters.queue)} `}${PERIODS[S.filters.period] || ""}`;
}

function setRoute() {
  const route = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const next = VIEWS[route] ? route : "dashboard";
  if (next !== S.route) window.scrollTo(0, 0);
  S.route = next;
  if (next === "history") history.reset();
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === next));
  document.title = `${PAGES[next][0]} · Tung Tung Tracker`;
  render(true);
}

// ------------------------------------------------------------------ chrome (status, banner, filters)
function renderChrome() {
  const srv = S.server;
  const st = srv.status || {};
  const conn = $("conn");
  let state = st.connection || "offline";
  let label = { offline: "Valorant non détecté", client: "Riot Client connecté", game: "Valorant · menus" }[state];
  if (st.phase === "PREGAME") { state = "live"; label = "Sélection d'agent"; }
  if (st.phase === "INGAME") { state = "live"; label = "En partie"; }
  conn.dataset.state = st.error && state !== "offline" ? "error" : state;
  conn.classList.toggle("syncing", !!st.syncing);
  $("conn-label").textContent = st.syncing ? "Synchronisation…" : label;
  $("conn-sub").textContent = st.last_sync ? `Synchro ${ago(st.last_sync)}` : state === "offline" ? "Lance Valorant" : "En attente…";
  conn.dataset.tip = `${label}${st.region ? ` · ${st.region.toUpperCase()}` : ""}\n${st.last_sync ? `Dernière synchro ${ago(st.last_sync)}` : "Jamais synchronisé"}`;

  const banner = $("banner");
  if (st.error && state !== "offline") {
    banner.className = "banner error";
    banner.innerHTML = String(html`<strong>Problème de synchro :</strong> ${st.error}`);
    banner.hidden = false;
  } else if (state === "offline") {
    banner.className = "banner";
    banner.innerHTML = String(html`<strong>Mode hors ligne.</strong> Lance Valorant pour synchroniser tes nouveaux matchs. Tes stats enregistrées restent consultables.`);
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }

  const liveTab = document.querySelector(".nav-live");
  liveTab.hidden = !srv.live;
  if (srv.live && srv.live.match_id !== S.lastLiveId) {
    S.lastLiveId = srv.live.match_id;
    if (S.route === "dashboard" && !modalOpen()) location.hash = "#/live";
  }
  if (!srv.live && S.route === "live") location.hash = "#/dashboard";
  if (!srv.live) S.lastLiveId = null;

  // Toasts for new server events (skip the backlog on first load).
  const events = srv.events || [];
  if (S.lastEvent === null) S.lastEvent = events.length ? events[events.length - 1].id : 0;
  for (const ev of events) if (ev.id > S.lastEvent) toast(ev.text, ev.kind);
  if (events.length) S.lastEvent = Math.max(S.lastEvent, events[events.length - 1].id);

  $("app-version").textContent = `v${srv.app_version || "?"}`;
  $("app-version").dataset.tip = `${S.matches.length} matchs en base`;
}

function renderFilters() {
  const select = $("filter-queue");
  const queues = queuesPresent(S.matches);
  if (S.filters.queue !== "all" && !queues.includes(S.filters.queue)) queues.push(S.filters.queue);
  const options = [["all", "Tous les modes"], ...queues.map((q) => [q, queueName(q)])];
  select.innerHTML = String(html`${options.map(([v, l]) => html`<option value="${v}" ${v === S.filters.queue ? "selected" : ""}>${l}</option>`)}`);
  document.querySelectorAll("#filter-period button").forEach((b) => b.classList.toggle("active", b.dataset.period === S.filters.period));
}

function setFilter(key, value) {
  S.filters[key] = value;
  S.prefs = savePrefs({ filters: S.filters });
  renderFilters();
  rerender();
}

// ------------------------------------------------------------------ data loading
async function loadContent() {
  for (;;) {
    try {
      const res = await api.getContent(S.contentEtag);
      if (!res.notModified) {
        setContent(res.body);
        S.contentEtag = res.etag;
      }
      return;
    } catch (err) {
      $("boot-sub").textContent = err.status === 503
        ? "Téléchargement des agents, armes et skins (première fois uniquement)…"
        : "Le serveur local ne répond pas. Vérifie que « python app.py » tourne.";
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function loadMatches() {
  const res = await api.getMatches(S.matchesEtag);
  if (res.notModified) return false;
  S.matches = res.body.matches || [];
  S.legacy = res.body.legacy || {};
  S.matchesEtag = res.etag;
  S.matchesVersion = res.body.version;
  renderFilters();
  return true;
}

async function poll() {
  try {
    const server = await api.getState();
    S.server = server;
    S.failures = 0;
    if (server.matches_version !== S.matchesVersion) await loadMatches();
    renderChrome();
    render();
  } catch {
    S.failures++;
    if (S.failures >= 2) {
      const banner = $("banner");
      banner.className = "banner error";
      banner.innerHTML = String(html`<strong>Serveur local injoignable.</strong> Relance « python app.py » puis rafraîchis la page.`);
      banner.hidden = false;
      $("conn").dataset.state = "error";
      $("conn-label").textContent = "Serveur arrêté";
    }
  } finally {
    setTimeout(poll, document.hidden ? POLL_HIDDEN_MS : POLL_MS);
  }
}

async function requestSync() {
  try {
    await api.syncNow();
    $("conn").classList.add("syncing");
    toast("Synchronisation demandée");
  } catch { /* poll will surface errors */ }
}

// ------------------------------------------------------------------ events
document.addEventListener("click", async (e) => {
  const view = VIEWS[S.route];
  if (view.handle?.(e, rerender)) return;

  const period = e.target.closest("[data-period]");
  if (period) { setFilter("period", period.dataset.period); return; }

  const matchBtn = e.target.closest("[data-match]");
  if (matchBtn) {
    const m = S.matches.find((x) => x.id === matchBtn.dataset.match);
    hideTip();
    if (m) openModal(matchModal(m, ctx()), { label: "Détails du match" });
    return;
  }
  const weaponBtn = e.target.closest("[data-weapon]");
  if (weaponBtn) {
    hideTip();
    openModal(locker.skinsModal(weaponBtn.dataset.weapon, ctx()), { label: "Comparateur de skins" });
    return;
  }
  const agentBtn = e.target.closest("[data-agent]");
  if (agentBtn) {
    hideTip();
    openModal(agents.agentModal(agentBtn.dataset.agent, ctx()), { label: "Détails de l'agent" });
    return;
  }
  const nav = e.target.closest("[data-nav]");
  if (nav) {
    location.hash = `#/${nav.dataset.nav}`;
    return;
  }
  if (e.target.closest("[data-action='backfill']") || e.target.closest("#btn-backfill")) {
    $("settings-menu").hidden = true;
    try {
      await api.backfill();
      toast("Import de l'historique ancien lancé. Ça peut prendre une minute.");
    } catch {
      toast("Impossible de lancer l'import : le Riot Client doit être ouvert.", "error");
    }
    return;
  }
  if (e.target.closest("#btn-sync")) { requestSync(); return; }
  const settings = $("settings-menu");
  if (e.target.closest("#btn-settings")) { settings.hidden = !settings.hidden; return; }
  if (!settings.hidden && !e.target.closest("#settings-menu")) settings.hidden = true;
});

document.addEventListener("change", (e) => {
  if (VIEWS[S.route].handle?.(e, rerender)) return;
  if (e.target.id === "filter-queue") setFilter("queue", e.target.value);
  if (e.target.id === "opt-streamer") {
    S.prefs = savePrefs({ streamer: e.target.checked });
    rerender();
  }
  if (e.target.id === "opt-motion") {
    S.prefs = savePrefs({ motion: e.target.checked });
    document.body.classList.toggle("reduce-motion", e.target.checked);
  }
});

document.addEventListener("input", (e) => { VIEWS[S.route].handle?.(e, rerender); });

document.addEventListener("keydown", (e) => {
  if (VIEWS[S.route].handle?.(e, rerender)) return;
  if (modalOpen() || e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  const keys = { 1: "dashboard", 2: "history", 3: "agents", 4: "locker", 5: "live" };
  if (keys[e.key] && (e.key !== "5" || S.server?.live)) location.hash = `#/${keys[e.key]}`;
  if (e.key === "r" || e.key === "R") requestSync();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
window.addEventListener("hashchange", () => { closeModal(); setRoute(); });

// ------------------------------------------------------------------ boot
(async function boot() {
  $("opt-streamer").checked = !!S.prefs.streamer;
  $("opt-motion").checked = !!S.prefs.motion;
  document.body.classList.toggle("reduce-motion", !!S.prefs.motion);
  renderFilters();
  await loadContent();
  $("boot-sub").textContent = "Chargement de tes matchs…";
  try { await loadMatches(); } catch { /* retried by poll */ }
  renderFilters();
  S.server = await api.getState().catch(() => ({ status: { connection: "offline" }, profile: {} }));
  renderChrome();
  setRoute();
  setTimeout(poll, POLL_MS);
})();
