"""Windows desktop integration: tray icon, start with Windows, single instance, notifications.

Everything here is optional: without pystray/Pillow (or outside Windows) the app simply
runs without a tray icon.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import urllib.request

log = logging.getLogger(__name__)

APP_NAME = "TungTungTracker"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
RESULT = {"win": "Victoire", "loss": "Défaite", "draw": "Égalité"}


# ---------------------------------------------------------------------- icon
def icon_image(size: int = 256):
    """The app logo (same shape as static/img/favicon.svg) as a Pillow image."""
    from PIL import Image, ImageDraw

    scale = size / 32
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(6 * scale), fill="#0f1923")
    for poly in ([(5, 7), (12, 7), (18, 19), (14.5, 26)], [(27, 7), (20, 7), (15.7, 15.6), (19.2, 22.6)]):
        draw.polygon([(x * scale, y * scale) for x, y in poly], fill="#ff4655")
    return img


# ---------------------------------------------------------------------- start with Windows
def autostart_command() -> str | None:
    """Only the packaged exe can register itself (a script path would break on the next update)."""
    if not getattr(sys, "frozen", False):
        return None
    return f'"{sys.executable}" --minimized'


def autostart_enabled() -> bool:
    if sys.platform != "win32":
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            winreg.QueryValueEx(key, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(enabled: bool) -> bool:
    command = autostart_command()
    if sys.platform != "win32" or command is None:
        return False
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, command)
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except OSError:
                pass
    log.info("Démarrage avec Windows : %s", "activé" if enabled else "désactivé")
    return True


# ---------------------------------------------------------------------- single instance
class SingleInstance:
    """A lock file in the data folder. A second launch asks the first one to show its window."""

    def __init__(self, data_dir: str):
        self.lock_path = os.path.join(data_dir, "instance.lock")
        self.info_path = os.path.join(data_dir, "instance.json")
        self._handle = None

    def acquire(self) -> bool:
        os.makedirs(os.path.dirname(self.lock_path), exist_ok=True)
        self._handle = open(self.lock_path, "a+")
        try:
            if sys.platform == "win32":
                import msvcrt
                self._handle.seek(0)
                msvcrt.locking(self._handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self._handle.close()
            self._handle = None
            return False

    def publish(self, port: int, token: str) -> None:
        with open(self.info_path, "w", encoding="utf-8") as f:
            json.dump({"port": port, "pid": os.getpid(), "token": token}, f)

    def wake_existing(self) -> bool:
        """Ask the running instance to bring its window to the front."""
        try:
            with open(self.info_path, encoding="utf-8") as f:
                info = json.load(f)
            port, token = int(info["port"]), info["token"]
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/show", method="POST", headers={"X-Tracker": token})
            urllib.request.urlopen(req, timeout=3).close()
            return True
        except (OSError, ValueError, KeyError):
            return False


# ---------------------------------------------------------------------- tray icon
class Tray:
    def __init__(self, title: str, on_open, on_sync, on_quit, overlay: dict | None = None):
        self.title = title
        self.on_open, self.on_sync, self.on_quit = on_open, on_sync, on_quit
        self.overlay = overlay  # {"enabled": fn -> bool, "toggle": fn, "show": fn}
        self.icon = None
        self.told_background = False

    def start(self) -> bool:
        try:
            import pystray
        except ImportError:
            log.info("pystray absent : pas d'icône dans la zone de notification")
            return False
        can_autostart = autostart_command() is not None

        def toggle_autostart(_icon, _item):
            set_autostart(not autostart_enabled())

        menu = pystray.Menu(
            pystray.MenuItem("Ouvrir Tung Tung Tracker", lambda: self.on_open(), default=True),
            pystray.MenuItem("Synchroniser maintenant", lambda: self.on_sync()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Overlay pendant les parties", lambda: self.overlay and self.overlay["toggle"](),
                             checked=lambda _item: bool(self.overlay and self.overlay["enabled"]()),
                             visible=self.overlay is not None),
            pystray.MenuItem(self._overlay_label(), lambda: self.overlay and self.overlay["show"](),
                             visible=self.overlay is not None),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Lancer au démarrage de Windows", toggle_autostart,
                             checked=lambda _item: autostart_enabled(), enabled=can_autostart),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quitter", lambda: self.on_quit()),
        )
        self.icon = pystray.Icon(APP_NAME, icon_image(64), self.title, menu)
        self.icon.run_detached()
        return True

    def _overlay_label(self) -> str:
        key = (self.overlay or {}).get("key")
        return f"Afficher / masquer l'overlay ({key})" if key else "Afficher / masquer l'overlay"

    def notify(self, title: str, message: str) -> None:
        if not self.icon:
            return
        try:
            self.icon.notify(message, title)
        except Exception as exc:  # notifications are best effort
            log.debug("notification impossible: %s", exc)

    def went_to_background(self) -> None:
        if not self.told_background:
            self.told_background = True
            self.notify(self.title, "Le tracker continue en arrière-plan pour enregistrer tes matchs. "
                                    "Clic sur l'icône pour le rouvrir, clic droit pour quitter.")

    def stop(self) -> None:
        if self.icon:
            self.icon.stop()
            self.icon = None


# ---------------------------------------------------------------------- end-of-match notifications
def recap_text(match: dict) -> tuple[str, str]:
    result = RESULT.get(match.get("result"), "Match terminé")
    score = f" {match.get('my_score')}–{match.get('enemy_score')}" if match.get("my_score") or match.get("enemy_score") else ""
    rr = match.get("rr") or {}
    title = f"{result}{score}" + (f" · {rr['earned']:+d} RR" if "earned" in rr else "")
    parts = [f"{match.get('kills', 0)}/{match.get('deaths', 0)}/{match.get('assists', 0)}"]
    if match.get("acs") is not None:
        parts.append(f"{match['acs']} ACS")
    if match.get("hs_percent"):
        parts.append(f"{match['hs_percent']}% HS")
    return title, " · ".join(parts)


def watch_recaps(tracker, tray: Tray, stop: threading.Event) -> None:
    """Turn the tracker's "recap" events into Windows notifications."""
    seen = max((e["id"] for e in tracker.events), default=0)
    while not stop.wait(2):
        for event in list(tracker.events):
            if event["id"] <= seen:
                continue
            seen = event["id"]
            if event.get("kind") == "recap":
                match = tracker.store.data["matches"].get(event.get("match_id"))
                if match:
                    tray.notify(*recap_text(match))


def start_recap_watcher(tracker, tray: Tray, stop: threading.Event) -> None:
    threading.Thread(target=watch_recaps, args=(tracker, tray, stop), name="recap-notify", daemon=True).start()



# ---------------------------------------------------------------------- windows without stealing focus
def _own_window(title: str) -> int:
    """Handle of this process' top-level window with that exact title (0 if none)."""
    if sys.platform != "win32":
        return 0
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = ctypes.c_void_p(0)
    pid = os.getpid()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def callback(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid:
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if buf.value == title:
                found.value = hwnd
                return False
        return True

    user32.EnumWindows(callback, 0)
    return found.value or 0


def show_without_focus(title: str) -> bool:
    """Show a window on top WITHOUT activating it, so the game keeps the keyboard and mouse."""
    hwnd = _own_window(title)
    if not hwnd:
        return False
    import ctypes
    user32 = ctypes.windll.user32
    SW_SHOWNOACTIVATE, HWND_TOPMOST = 4, -1
    SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x1, 0x2, 0x10, 0x40
    user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_SHOWWINDOW)
    return True


def hide_window(title: str) -> bool:
    hwnd = _own_window(title)
    if hwnd:
        import ctypes
        ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    return bool(hwnd)


# ---------------------------------------------------------------------- global hotkey
MOD_ALT = 0x1
# (modifiers, virtual key, label): Alt+O, or Alt+P if another app already owns it.
# Alt has no default bind in Valorant; Alt+Z is avoided (NVIDIA overlay), Ctrl+letter too (Ctrl+X = cut…).
SHORTCUTS = ((MOD_ALT, 0x4F, "Alt+O"), (MOD_ALT, 0x50, "Alt+P"))


class Hotkey:
    """System-wide shortcut through RegisterHotKey — the standard Windows API used by Discord or OBS.
    It is not a keyboard hook: Windows only tells us when this exact key is pressed."""

    def __init__(self, callback, keys=SHORTCUTS):
        self.callback = callback
        self.keys = keys
        self.key_name = ""
        self._thread_id = 0
        self._ready = threading.Event()

    def start(self) -> str:
        if sys.platform != "win32":
            return ""
        threading.Thread(target=self._run, name="hotkey", daemon=True).start()
        self._ready.wait(2)
        return self.key_name

    def _run(self) -> None:
        import ctypes
        from ctypes import wintypes
        user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
        MOD_NOREPEAT, WM_HOTKEY = 0x4000, 0x0312
        self._thread_id = kernel32.GetCurrentThreadId()
        for mods, vk, label in self.keys:
            if user32.RegisterHotKey(None, 1, mods | MOD_NOREPEAT, vk):
                self.key_name = label
                break
        self._ready.set()
        if not self.key_name:
            log.warning("Raccourci de l'overlay indisponible (Alt+O et Alt+P déjà pris par un autre logiciel)")
            return
        log.info("Raccourci de l'overlay : %s (thread %s)", self.key_name, self._thread_id)
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY:
                try:
                    self.callback()
                except Exception:
                    log.exception("raccourci overlay")
        user32.UnregisterHotKey(None, 1)

    def stop(self) -> None:
        if self._thread_id:
            import ctypes
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, 0x0012, 0, 0)  # WM_QUIT
