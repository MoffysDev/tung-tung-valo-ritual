"""Tung Tung Tracker — lance le serveur local et la synchro Valorant en arrière-plan.

    python app.py                  ouvre l'app dans sa propre fenêtre (pywebview) ou le navigateur
    python app.py --browser        force l'ouverture dans le navigateur
    python app.py [--port 5000] [--data db] [--offline] [--no-browser] [--verbose]

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
from tracker.server import create_app
from tracker.static_data import StaticData
from tracker.storage import Store
from tracker.worker import Tracker

FROZEN = getattr(sys, "frozen", False)
# Bundled files (static/) live in PyInstaller's temp dir; user data lives next to the exe.
BUNDLE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
HOME = os.path.dirname(sys.executable) if FROZEN else BUNDLE
TITLE = "Tung Tung Tracker"


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


def open_window(url: str) -> bool:
    """Show the app in a native window. Returns False when pywebview isn't available."""
    try:
        import webview
    except ImportError:
        return False
    webview.create_window(TITLE, url, width=1600, height=960, min_size=(1100, 700), background_color="#080e14")
    webview.start()  # blocks until the window is closed
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=TITLE)
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--data", default=os.path.join(HOME, "db"), help="dossier de la base locale")
    parser.add_argument("--browser", action="store_true", help="ouvrir dans le navigateur plutôt qu'une fenêtre")
    parser.add_argument("--no-browser", action="store_true", help="serveur seul, sans rien ouvrir")
    parser.add_argument("--offline", action="store_true", help="consulter la base sans contacter Riot")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

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
    server = make_server("127.0.0.1", port, create_app(tracker, os.path.join(BUNDLE, "static")), threaded=True)
    url = f"http://127.0.0.1:{port}"
    log.info("Tung Tung Tracker v%s -> %s", __version__, url)

    serving = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    serving.start()
    try:
        if args.no_browser:
            serving.join()
        elif args.browser or not open_window(url):
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
