"""WinBridge MCP: local, bounded Windows workspace tools for Claude Desktop."""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import sys
from pathlib import Path

from mcp.server import MCPServer
from mcp.server.mcpserver import Image
from mcp.types import ToolAnnotations

from winbridge_core import Workspace, WorkspaceError

mcp = MCPServer('WinBridge MCP')
workspace = Workspace.from_environment()

READ = ToolAnnotations(read_only_hint=True, open_world_hint=False)
WRITE = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)
DELETE = ToolAnnotations(read_only_hint=False, destructive_hint=True, open_world_hint=False)


@mcp.tool(annotations=READ)
def workspace_info() -> dict:
    """Show exactly which local folders Claude may access and whether edits are enabled."""
    return workspace.roots_info()


@mcp.tool(annotations=READ)
def list_directory(path: str = '.', limit: int = 100) -> dict:
    """List names and types of files in an authorized folder; never traverse outside roots."""
    return workspace.list_directory(path, limit)


@mcp.tool(annotations=READ)
def read_file(path: str, start_line: int = 1, max_lines: int = 300) -> dict:
    """Read UTF-8 text, with line numbers and bounded output, from an authorized folder."""
    return workspace.read_file(path, start_line, max_lines)


@mcp.tool(annotations=READ)
def search_text(query: str, limit: int = 30) -> dict:
    """Find plain-text matches within authorized projects (max 1000 files scanned)."""
    return workspace.search_text(query, limit)


@mcp.tool(annotations=WRITE)
def write_file(path: str, content: str, overwrite: bool = False) -> str:
    """Create a UTF-8 file, or replace one with overwrite=true, in an authorized workspace."""
    return workspace.write_file(path, content, overwrite)


@mcp.tool(annotations=WRITE)
def replace_text(path: str, old_text: str, new_text: str) -> str:
    """Safely edit a file only when old_text matches exactly once."""
    return workspace.replace_text(path, old_text, new_text)


@mcp.tool(annotations=WRITE)
def move_file(source: str, destination: str) -> str:
    """Move or rename one file inside authorized workspace roots; no overwrite."""
    return workspace.move_file(source, destination)


@mcp.tool(annotations=DELETE)
def delete_file(path: str) -> dict:
    """Remove a file from the project by moving it to recoverable internal trash."""
    return workspace.delete_file(path)


@mcp.tool(annotations=WRITE)
def restore_file(restore_id: str, workspace_index: int = 0) -> str:
    """Restore a previously trashed file using its restore_id; never overwrite."""
    return workspace.restore_file(restore_id, workspace_index)


@mcp.tool(annotations=READ)
def terminal_task(task: str, cwd: str = '.') -> dict:
    """Run a safe terminal diagnostic: git_status, git_diff, git_log, python_version. No arbitrary shell."""
    return workspace.terminal_task(task, cwd)


@mcp.tool(annotations=READ)
def desktop_list_windows() -> list[str]:
    """List titles of currently visible Windows desktop windows, if enabled."""
    if os.environ.get('WINBRIDGE_DESKTOP', '0') != '1':
        raise WorkspaceError('Desktop observation is disabled by WINBRIDGE_DESKTOP.')
    if sys.platform != 'win32':
        raise WorkspaceError('This tool requires Windows.')
    titles: list[str] = []
    user32 = ctypes.windll.user32
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    enum_type = ctypes.WINFUNCTYPE(ctypes.c_int, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = [enum_type, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL

    @enum_type
    def callback(hwnd: int, _param: int) -> bool:
        if user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            buffer = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buffer, len(buffer))
            if buffer.value:
                titles.append(buffer.value[:200])
        return len(titles) < 80

    user32.EnumWindows(callback, 0)
    return titles


@mcp.tool(annotations=READ)
def desktop_screenshot() -> Image:
    """Capture the local Windows desktop on demand. May reveal private screen content."""
    if os.environ.get('WINBRIDGE_DESKTOP', '0') != '1':
        raise WorkspaceError('Screenshots are disabled by WINBRIDGE_DESKTOP.')
    if sys.platform != 'win32':
        raise WorkspaceError('This tool requires Windows.')
    try:
        import mss
        import mss.tools
    except ImportError as exc:
        raise WorkspaceError('Install the mss package to use screenshots.') from exc
    with mss.mss() as sct:
        screen = sct.grab(sct.monitors[0])
        png = mss.tools.to_png(screen.rgb, screen.size)
    return Image(data=png, format='png')


@mcp.tool(annotations=WRITE)
def desktop_open_workspace(path: str = '.') -> str:
    """Open an authorized workspace directory in Windows File Explorer (not other apps)."""
    if os.environ.get('WINBRIDGE_DESKTOP', '0') != '1':
        raise WorkspaceError('Desktop tools disabled by WINBRIDGE_DESKTOP.')
    if sys.platform != 'win32':
        raise WorkspaceError('This tool requires Windows.')
    directory = workspace.resolve(path, allow_root=True)
    if not directory.is_dir():
        raise WorkspaceError('Path must be an authorized directory.')
    os.startfile(str(directory))
    return f'Opened File Explorer at {directory}'



# Input permissions are opt-in and revalidated in the desktop module.
from winbridge_desktop_control import (
    input_status as _input_status,
    click as _desktop_click,
    type_text as _desktop_type_text,
    hotkey as _desktop_hotkey,
    scroll as _desktop_scroll,
)


@mcp.tool(annotations=READ)
def desktop_input_status() -> dict:
    """Show application allowlist and desktop input permission status."""
    return _input_status()


@mcp.tool(annotations=DELETE)
def desktop_click(x: int, y: int, button: str = 'left') -> dict:
    """Click once inside an allowed foreground app with local user confirmation."""
    return _desktop_click(x, y, button)


@mcp.tool(annotations=WRITE)
def desktop_type_text(text: str) -> dict:
    """Type short ASCII text in an allowed app with local user confirmation."""
    return _desktop_type_text(text)


@mcp.tool(annotations=DELETE)
def desktop_hotkey(keys: str) -> dict:
    """Press an allowed editor shortcut with local user confirmation."""
    return _desktop_hotkey(keys)


@mcp.tool(annotations=DELETE)
def desktop_scroll(amount: int) -> dict:
    """Scroll an allowed app with local user confirmation."""
    return _desktop_scroll(amount)


@mcp.tool(annotations=WRITE)
def create_directory(path: str) -> str:
    """Create a folder inside an authorized workspace."""
    return workspace.create_directory(path)


@mcp.tool(annotations=READ)
def preview_text_edit(path: str, old_text: str, new_text: str) -> dict:
    """Preview a bounded unified diff before editing a workspace text file."""
    return workspace.preview_text_edit(path, old_text, new_text)


@mcp.tool(annotations=READ)
def trash_list(workspace_index: int = 0) -> list[dict]:
    """List recent recoverable file deletions in a selected workspace."""
    return workspace.trash_list(workspace_index)


@mcp.tool(annotations=READ)
def python_syntax_check(path: str = '.') -> dict:
    """Statically parse .py files in a project, without executing Python code."""
    return workspace.python_syntax_check(path)


if __name__ == '__main__':
    # STDIO transport: Claude Desktop launches this process locally; no network listener.
    mcp.run()
