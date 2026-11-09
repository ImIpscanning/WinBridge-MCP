"""Windows desktop interaction tools with per-action local user consent.

This module never exposes unattended desktop automation. Each action requires
Windows MessageBox approval on the user's own machine. Foreground process and
window bounds are rechecked before dispatch.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import sys
from pathlib import Path
from typing import Any

from winbridge_core import WorkspaceError

MAX_TYPE_CHARS = 500
DEFAULT_APPS = "notepad.exe;code.exe"
ALLOWED_HOTKEYS = {
    "ctrl+s": ("ctrl", "s"),
    "ctrl+z": ("ctrl", "z"),
    "ctrl+y": ("ctrl", "y"),
    "ctrl+c": ("ctrl", "c"),
    "ctrl+v": ("ctrl", "v"),
    "ctrl+a": ("ctrl", "a"),
}


def _require_windows_input() -> None:
    if sys.platform != "win32":
        raise WorkspaceError("Desktop input requires an interactive Windows session.")
    if os.environ.get("WINBRIDGE_DESKTOP", "0") != "1":
        raise WorkspaceError("WINBRIDGE_DESKTOP is disabled.")
    if os.environ.get("WINBRIDGE_INPUT", "0") != "1":
        raise WorkspaceError("WINBRIDGE_INPUT is disabled. Opt in locally before using input.")


def _user32() -> Any:
    """Declare pointer-width-safe Win32 signatures for 32/64-bit Python."""
    user32 = ctypes.windll.user32
    user32.GetForegroundWindow.argtypes = []
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [
        wintypes.HWND, ctypes.POINTER(wintypes.DWORD)
    ]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.IsWindow.argtypes = [wintypes.HWND]
    user32.IsWindow.restype = wintypes.BOOL
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.MessageBoxW.argtypes = [
        wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT
    ]
    user32.MessageBoxW.restype = ctypes.c_int
    return user32


def _active_window() -> tuple[int, str, str]:
    """Return verified foreground HWND, title and executable filename."""
    _require_windows_input()
    user32 = _user32()
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        raise WorkspaceError("No active desktop window.")
    title_buffer = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.restype = ctypes.c_void_p
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
    if not handle:
        raise WorkspaceError("Cannot verify the foreground application's executable.")
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        size = ctypes.c_ulong(len(buffer))
        kernel32.QueryFullProcessImageNameW.argtypes = [
            ctypes.c_void_p, ctypes.c_ulong, ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_ulong)
        ]
        kernel32.QueryFullProcessImageNameW.restype = ctypes.c_bool
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            raise WorkspaceError("Cannot read foreground process name.")
        app = Path(buffer.value).name.casefold()
    finally:
        kernel32.CloseHandle(ctypes.c_void_p(handle))
    allowed = {
        a.strip().casefold()
        for a in os.environ.get("WINBRIDGE_INPUT_APPS", DEFAULT_APPS).split(";")
        if a.strip()
    }
    if app not in allowed:
        raise WorkspaceError(
            f"Foreground application {app!r} is not in WINBRIDGE_INPUT_APPS."
        )
    if not title_buffer.value:
        raise WorkspaceError("Active window has no visible title.")
    return hwnd, title_buffer.value[:180], app


def _approve(message: str, hwnd: int) -> None:
    """Fail closed unless a person explicitly selects Yes on the local PC."""
    # Yes=6; use warning icon, topmost, set foreground. No external approval API.
    MB_YESNO = 0x4
    MB_ICONWARNING = 0x30
    MB_TOPMOST = 0x40000
    MB_DEFBUTTON2 = 0x100  # Default to No; approval must be deliberate.
    choice = _user32().MessageBoxW(
        0, message[:1200] + "\n\nApprove this one action?", "WinBridge MCP",
        MB_YESNO | MB_ICONWARNING | MB_TOPMOST | MB_DEFBUTTON2,
    )
    if choice != 6:
        raise WorkspaceError("Desktop action rejected on the local Windows computer.")
    # Dialog focus can briefly shift. The window still needs to exist.
    if not _user32().IsWindow(hwnd):
        raise WorkspaceError("Target window disappeared during approval.")


def _gui() -> Any:
    try:
        import pyautogui
    except ImportError as exc:
        raise WorkspaceError("Missing pyautogui. Rerun install.ps1.") from exc
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.15
    return pyautogui


def input_status() -> dict:
    """Report current user-selected permissions, without reading private content."""
    return {
        "desktop_enabled": os.environ.get("WINBRIDGE_DESKTOP", "0") == "1",
        "input_enabled": os.environ.get("WINBRIDGE_INPUT", "0") == "1",
        "allowed_apps": [a.strip() for a in os.environ.get(
            "WINBRIDGE_INPUT_APPS", DEFAULT_APPS
        ).split(";") if a.strip()],
        "local_approval_required": True,
        "max_type_chars": MAX_TYPE_CHARS,
        "allowed_hotkeys": sorted(ALLOWED_HOTKEYS),
    }


def click(x: int, y: int, button: str = "left") -> dict:
    """Click once inside an authorized foreground window after local approval."""
    if button not in ("left", "right"):
        raise WorkspaceError("button must be left or right.")
    hwnd, title, app = _active_window()
    gui = _gui()
    width, height = gui.size()
    if not 0 <= x < width or not 0 <= y < height:
        raise WorkspaceError("Click coordinates are outside the primary display.")
    rect = wintypes.RECT()
    if not _user32().GetWindowRect(hwnd, ctypes.byref(rect)):
        raise WorkspaceError("Cannot locate the active window.")
    if not (rect.left <= x < rect.right and rect.top <= y < rect.bottom):
        raise WorkspaceError("Click must be inside the active application's window.")
    _approve(f"App: {app}\nWindow: {title}\nAction: {button} click at ({x}, {y})", hwnd)
    if not _user32().IsWindow(hwnd):
        raise WorkspaceError("Window changed before input.")
    # Revalidate the process and foreground to prevent cross-app clicks.
    new_hwnd, _, new_app = _active_window()
    if new_hwnd != hwnd or new_app != app:
        raise WorkspaceError("Foreground window changed; action canceled.")
    gui.click(x=x, y=y, button=button)
    return {"status": "clicked", "window": title, "button": button, "x": x, "y": y}


def type_text(text: str) -> dict:
    """Type limited plain text into an approved application, with visible consent."""
    if not isinstance(text, str) or not text or len(text) > MAX_TYPE_CHARS:
        raise WorkspaceError(f"Text length must be 1 to {MAX_TYPE_CHARS} characters.")
    if any((ord(c) < 32 and c not in "\r\n\t") for c in text):
        raise WorkspaceError("Control characters are not permitted.")
    # PyAutoGUI's write() uses key presses and is ASCII-focused on Windows.
    if any(ord(c) > 126 for c in text):
        raise WorkspaceError("Unicode typing is not supported in v0.2. Edit UTF-8 files with write_file.")
    hwnd, title, app = _active_window()
    preview = text[:350]
    _approve(f"App: {app}\nWindow: {title}\nType exactly:\n{preview}", hwnd)
    new_hwnd, _, new_app = _active_window()
    if hwnd != new_hwnd or app != new_app:
        raise WorkspaceError("Foreground window changed; action canceled.")
    _gui().write(text, interval=0.01)
    return {"status": "typed", "window": title, "characters": len(text)}


def hotkey(keys: str) -> dict:
    """Use only the short listed editing hotkeys, with per-action local approval."""
    if keys not in ALLOWED_HOTKEYS:
        raise WorkspaceError(f"Hotkey not allowed. Choose: {', '.join(sorted(ALLOWED_HOTKEYS))}")
    hwnd, title, app = _active_window()
    _approve(f"App: {app}\nWindow: {title}\nHotkey: {keys}", hwnd)
    new_hwnd, _, new_app = _active_window()
    if hwnd != new_hwnd or app != new_app:
        raise WorkspaceError("Foreground window changed; action canceled.")
    _gui().hotkey(*ALLOWED_HOTKEYS[keys])
    return {"status": "pressed", "window": title, "hotkey": keys}


def scroll(amount: int) -> dict:
    """Scroll the current approved app by a bounded amount after confirmation."""
    if not isinstance(amount, int) or not -10 <= amount <= 10 or amount == 0:
        raise WorkspaceError("Scroll amount must be between -10 and 10 and nonzero.")
    hwnd, title, app = _active_window()
    _approve(f"App: {app}\nWindow: {title}\nScroll: {amount}", hwnd)
    new_hwnd, _, new_app = _active_window()
    if hwnd != new_hwnd or app != new_app:
        raise WorkspaceError("Foreground window changed; action canceled.")
    _gui().scroll(amount)
    return {"status": "scrolled", "window": title, "amount": amount}
