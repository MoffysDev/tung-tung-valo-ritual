"""Tung Tung Tracker — lance le serveur local et la synchro Valorant en arrière-plan.

    python app.py                  ouvre l'app dans sa propre fenêtre (pywebview) ou le navigateur
    python app.py --browser        force l'ouverture dans le navigateur
    python app.py [--port 5000] [--data db] [--offline] [--minimized] [--no-browser] [--verbose]

Fermer la fenêtre garde le tracker actif dans la zone de notification (clic droit sur l icône > Quitter).

Compilé avec build.bat, le même code donne TungTungTracker.exe.
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import webbrowser

from werkzeug.serving import make_server

from tracker import __version__
from tracker.desktop import SingleInstance
from tracker.server import create_app
from tracker.static_data import StaticData
from tracker.storage import Store
from tracker.worker import Tracker

FROZEN = getattr(sys, "frozen", False)
# Bundled files (static/) live in PyInstaller's temp dir; user data lives next to the exe.
BUNDLE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.dirname(sys.executable) if FROZEN else BUNDLE
TITLE = "Tung Tung Tracker"
OVERLAY_TITLE = "Tung Tung Overlay"


def free_port(preferred: int) -> int:
    """Use the preferred port when available, otherwise any free one."""
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise OSError("aucun port libre")


def setup_logging(data_dir: str, verbose: bool) -> None:
    handlers: list[logging.Handler] = []
    if sys.stderr is not None:  # the windowed exe has no console
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
        handlers.append(logging.StreamHandler())
    os.makedirs(data_dir, exist_ok=True)
    handlers.append(logging.FileHandler(os.path.join(data_dir, "tracker.log"), mode="w", encoding="utf-8"))
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
        handlers=handlers,
    )
    for noisy in ("werkzeug", "urllib3", "pywebview"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def open_window(url: str, tracker: Tracker, hooks: dict, minimized: bool, overlay_preview: bool = False) -> bool:
    """Native window + tray icon. Closing the window keeps the tracker running in the tray.
    Returns False when pywebview isn't available (the caller falls back to the browser)."""
    try:
        import webview
    except ImportError:
        return False
    from tracker.desktop import Hotkey, Tray, hide_window, show_without_focus, start_recap_watcher

    quitting = threading.Event()
    holder: dict = {}

    def show():
        window = holder.get("window")
        if window:
            window.show()
            window.restore()

    def quit_app():
        quitting.set()
        for key in ("overlay", "window"):  # webview.start() returns once every window is gone
            if holder.get(key):
                holder[key].destroy()

    # ---- in-game overlay: a separate always-on-top window, never touches the game process
    meta = tracker.store.data["meta"]
    overlay_state = {"visible": False, "dismissed": None, "forced": False}

    def overlay_enabled() -> bool:
        return meta.get("overlay", True)

    def toggle_overlay():
        meta["overlay"] = not overlay_enabled()
        tracker.store.mark("meta")

    overlay_wake = threading.Event()

    def show_overlay():
        overlay_state["forced"] = True
        overlay_state["dismissed"] = None
        overlay_wake.set()

    def hide_overlay():
        live = tracker.live
        overlay_state["dismissed"] = live["match_id"] if live else "menus"
        overlay_state["forced"] = False
        overlay_wake.set()

    def toggle_overlay_visible():
        logging.getLogger("app").info("overlay : %s", "masquer" if overlay_state["visible"] else "afficher")
        hide_overlay() if overlay_state["visible"] else show_overlay()

    hotkey = Hotkey(toggle_overlay_visible)
    hotkey_name = hotkey.start()

    tray = Tray(TITLE, on_open=show, on_sync=tracker.request_sync, on_quit=quit_app,
                overlay={"enabled": overlay_enabled, "toggle": toggle_overlay, "show": toggle_overlay_visible, "key": hotkey_name})
    has_tray = tray.start()
    logging.getLogger("app").info("icône de notification : %s", "active" if has_tray else "indisponible")
    hooks["show"] = show
    hooks["overlay_hide"] = hide_overlay
    window = webview.create_window(TITLE, url, width=1600, height=960, min_size=(1100, 700),
                                   background_color="#080e14", hidden=minimized and has_tray)
    holder["window"] = window

    def on_closing():
        logging.getLogger("app").info("fermeture demandée (icône: %s, quitter: %s)", has_tray, quitting.is_set())
        if quitting.is_set() or not has_tray:
            return True
        # Hiding from inside the closing event is ignored by the GUI toolkit: do it right after.
        threading.Timer(0.05, window.hide).start()
        tray.went_to_background()
        return False

    window.events.closing += on_closing
    overlay = webview.create_window(OVERLAY_TITLE, f"{url}/overlay", width=470, height=580, x=16, y=140,
                                    frameless=True, on_top=True, hidden=True, resizable=True,
                                    min_size=(380, 260), background_color="#080e14")
    holder["overlay"] = overlay

    def overlay_loop():
        """Show the overlay while a match is live (unless dismissed for that match)."""
        while not quitting.is_set():
            live = tracker.live
            key = live["match_id"] if live else "menus"
            wanted = (overlay_state["forced"] or (live is not None and overlay_enabled())) and overlay_state["dismissed"] != key
            if wanted != overlay_state["visible"]:
                try:
                    # Never take the focus away from the game.
                    if wanted:
                        show_without_focus(OVERLAY_TITLE) or overlay.show()
                    else:
                        hide_window(OVERLAY_TITLE) or overlay.hide()
                    overlay_state["visible"] = wanted
                except Exception:  # window not ready yet
                    logging.getLogger("app").debug("overlay pas encore prêt", exc_info=True)
            if live is None and overlay_state["dismissed"] not in (None, "menus"):
                overlay_state["dismissed"] = None  # next match shows it again
            overlay_wake.wait(1.5)
            overlay_wake.clear()

    if overlay_preview:
        show_overlay()
    threading.Thread(target=overlay_loop, name="overlay", daemon=True).start()
    stop_watch = threading.Event()
    if has_tray:
        start_recap_watcher(tracker, tray, stop_watch)
    try:
        webview.start()  # blocks until the window is really closed (Quitter)
    finally:
        stop_watch.set()
        overlay_wake.set()
        hotkey.stop()
        tray.stop()
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=TITLE)
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--data", default=os.path.join(HOME, "db"), help="dossier de la base locale")
    parser.add_argument("--browser", action="store_true", help="ouvrir dans le navigateur plutôt qu'une fenêtre")
    parser.add_argument("--no-browser", action="store_true", help="serveur seul, sans rien ouvrir")
    parser.add_argument("--offline", action="store_true", help="consulter la base sans contacter Riot")
    parser.add_argument("--minimized", action="store_true", help="démarrer réduit dans la zone de notification")
    parser.add_argument("--overlay-preview", action="store_true", help="afficher l'overlay dès le lancement (pour le placer)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    # One tracker at a time: a second launch just brings the running window back.
    instance = SingleInstance(args.data)
    if not instance.acquire():
        if not instance.wake_existing():
            print("Tung Tung Tracker est déjà lancé.", file=sys.stderr)
        return

    setup_logging(args.data, args.verbose)
    log = logging.getLogger("app")

    store = Store(args.data)
    static = StaticData(os.path.join(args.data, "content-cache.json"))
    tracker = Tracker(store, static)
    if args.offline:
        threading.Thread(target=lambda: static.is_stale() and static.refresh(), daemon=True).start()
    else:
        tracker.start()

    port = free_port(args.port)
    hooks: dict = {}
    app = create_app(tracker, os.path.join(BUNDLE, "static"), hooks)
    server = make_server("127.0.0.1", port, app, threaded=True)
    instance.publish(port, app.config["IPC_SECRET"])
    url = f"http://127.0.0.1:{port}"
    log.info("Tung Tung Tracker v%s -> %s", __version__, url)

    serving = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    serving.start()
    try:
        if args.no_browser:
            serving.join()
        elif args.browser or not open_window(url, tracker, hooks, args.minimized, args.overlay_preview):
            hooks["show"] = lambda: webbrowser.open(url)
            threading.Timer(1.0, webbrowser.open, args=(url,)).start()
            print(f"\n  {TITLE} v{__version__}\n  -> {url}\n  (Ctrl+C pour quitter)\n", flush=True)
            while serving.is_alive():
                serving.join(0.5)  # short joins keep Ctrl+C responsive on Windows
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        tracker.stop()
        store.save()

if __name__ == "__main__":
    main()
