// Lookups into game content served by /api/content (valorant-api.com, fr-FR).
import { BLANK } from "./format.js";

let C = { agents: {}, weapons: {}, maps: {}, tiers: {}, titles: {} };
export const setContent = (content) => { C = content; };

export const agent = (id) => C.agents[id] || { name: "Agent inconnu", icon: BLANK, portrait: BLANK, role: "" };
export const weapon = (id) => C.weapons[id] || null;
export const allWeapons = () => Object.entries(C.weapons);
export const title = (id) => (id && C.titles[id]) || "";
export const cardArt = (id, kind = "wideart") => (id ? `https://media.valorant-api.com/playercards/${id}/${kind}.png` : "");

export function map(id) {
  if (C.maps[id]) return C.maps[id];
  const short = (id || "").split("/").pop();
  return { name: short || "Carte inconnue", splash: "", list_icon: "" };
}

export function tier(t) {
  const info = C.tiers[String(t || 0)] || C.tiers["0"];
  return info || { name: "Non classé", icon: BLANK, small: BLANK, color: "#7d8a95" };
}

export function skin(weaponId, skinId, chromaId) {
  const w = weapon(weaponId);
  const s = w?.skins?.[skinId];
  if (!s) return { name: w ? `${w.name} Standard` : "Skin inconnu", icon: w?.icon || BLANK, tier: null, standard: true };
  const chroma = chromaId && s.chromas?.[chromaId];
  return { name: s.name, icon: chroma?.icon || s.icon || w.icon, tier: s.tier, standard: /standard|par défaut|aléatoire/i.test(s.name) };
}

/** Strip the weapon name from a skin name: "Vandal Prime" -> "Prime" */
export function shortSkin(weaponId, name) {
  const w = weapon(weaponId);
  if (!w || !name) return name || "";
  const stripped = name
    .replace(new RegExp(`\\s*${w.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), " ")
    .trim()
    .replace(/^\((.*)\)$/, "$1")
    .replace(/\s*\(\s*\)\s*/, " ")
    .trim();
  const out = stripped || name;
  return out.charAt(0).toUpperCase() + out.slice(1);
}
