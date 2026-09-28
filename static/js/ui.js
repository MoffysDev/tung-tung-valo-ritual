// Modal, toasts and small DOM utilities.
import { BLANK } from "./format.js";

const modal = document.getElementById("modal");
const modalBody = document.getElementById("modal-body");
const panel = modal.querySelector(".modal-panel");
let lastFocus = null;
let onClose = null;

export function openModal(content, { label = "Détails", closed } = {}) {
  lastFocus = document.activeElement;
  modalBody.innerHTML = String(content);
  modal.setAttribute("aria-label", label);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  panel.scrollTop = 0;
  panel.focus();
  onClose = closed || null;
}

export function closeModal() {
  if (modal.hidden) return;
  modal.hidden = true;
  modalBody.innerHTML = "";
  hideTip();
  document.body.style.overflow = "";
  lastFocus?.focus?.();
  onClose?.();
  onClose = null;
}

export const modalOpen = () => !modal.hidden;

modal.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "Tab" && !modal.hidden) {
    // Keep focus inside the dialog.
    const focusables = panel.querySelectorAll("button, [href], select, input, [tabindex]:not([tabindex='-1'])");
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  }
});

const toasts = document.getElementById("toasts");
export function toast(text, kind = "info", ms = 4500) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  toasts.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// Broken remote images fall back to a transparent pixel instead of the browser's broken icon.
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && !img.dataset.failed) {
    img.dataset.failed = "1";
    img.src = BLANK;
  }
}, true);

// Tooltips: any element with data-tip (plain text, "\n" for new lines).
const tip = document.getElementById("tip");
let tipTarget = null;
function placeTip(x, y) {
  const pad = 14;
  const { width, height } = tip.getBoundingClientRect();
  let left = x + pad, top = y + pad;
  if (left + width > innerWidth - 8) left = x - width - pad;
  if (top + height > innerHeight - 8) top = y - height - pad;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest?.("[data-tip]");
  if (el === tipTarget) return;
  tipTarget = el;
  if (!el || !el.dataset.tip) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  placeTip(e.clientX, e.clientY);
});
document.addEventListener("mousemove", (e) => { if (!tip.hidden) placeTip(e.clientX, e.clientY); });
document.addEventListener("scroll", () => { tip.hidden = true; tipTarget = null; }, true);
export const hideTip = () => { tip.hidden = true; tipTarget = null; };

export function prefs() {
  try {
    return JSON.parse(localStorage.getItem("ttt:prefs") || "{}");
  } catch {
    return {};
  }
}
export function savePrefs(patch) {
  const next = { ...prefs(), ...patch };
  try { localStorage.setItem("ttt:prefs", JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
