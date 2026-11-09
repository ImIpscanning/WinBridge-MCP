"""Local Windows terminal tasks for WinBridge MCP.

Approved, predefined project diagnostics for PowerShell and CMD. Tasks run
asynchronously: there is NO execution time limit. Clients can poll output
or stop a running task. Arbitrary shell expressions are not accepted.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys
from threading import RLock, Thread
from typing import Any
from uuid import uuid4

from winbridge_core import Workspace, WorkspaceError

MAX_TASKS = 8
MAX_CAPTURED_CHARS = 20_000

# Each command is a fixed argv vector. Neither PowerShell scripts nor CMD
# expressions are constructed from arbitrary LLM-provided command strings.
TASKS: dict[str, tuple[str, ...]] = {
    "powershell_version": (
        "powershell.exe", "-NoProfile", "-NonInteractive", "-NoLogo",
        "-Command", "$PSVersionTable.PSVersion.ToString()",
    ),
    "powershell_processes": (
        "powershell.exe", "-NoProfile", "-NonInteractive", "-NoLogo",
        "-Command",
        "Get-Process | Sort-Object ProcessName | Select-Object -First 40 ProcessName,Id | Format-Table -AutoSize",
    ),
    "powershell_services": (
        "powershell.exe", "-NoProfile", "-NonInteractive", "-NoLogo",
        "-Command",
        "Get-Service | Sort-Object Name | Select-Object -First 40 Name,Status | Format-Table -AutoSize",
    ),
    "cmd_version": ("cmd.exe", "/d", "/c", "ver"),
    "cmd_directory": ("cmd.exe", "/d", "/c", "dir"),
    "cmd_where_python": ("cmd.exe", "/d", "/c", "where python"),
    "git_status": ("git", "-c", "core.fsmonitor=false", "status", "--short"),
    "git_diff": ("git", "-c", "core.fsmonitor=false", "diff", "--"),
    "git_log": ("git", "-c", "core.fsmonitor=false", "log", "-5", "--oneline"),
    "python_version": (sys.executable, "--version"),
}


@dataclass
class Task:
    task_id: str
    name: str
    cwd: str
    process: subprocess.Popen[str]
    started_at: str
    output: deque[str] = field(default_factory=deque)
    captured_chars: int = 0
    truncated: bool = False
    lock: RLock = field(default_factory=RLock)


class TerminalManager:
    """Manager of locally approved Windows terminal tasks with manual stop."""

    def __init__(self, workspace: Workspace):
        self.workspace = workspace
        self._tasks: dict[str, Task] = {}
        self._lock = RLock()

    def catalog(self) -> dict[str, Any]:
        return {
            "platform": "Windows",
            "tasks": sorted(TASKS),
            "execution_timeout": None,
            "has_manual_stop": True,
            "local_approval_required": True,
            "arbitrary_shell_commands": False,
        }

    @staticmethod
    def _approve(name: str, cwd: Path, executable: str) -> None:
        if sys.platform != "win32":
            raise WorkspaceError("Windows terminal tools require Windows.")
        # Default No: actual local user approval is required to launch.
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        user32.MessageBoxW.argtypes = [
            wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.UINT
        ]
        user32.MessageBoxW.restype = ctypes.c_int
        message = (
            f"Requested task: {name}\nExecutable: {executable}\n"
            f"Working directory: {cwd}\n\n"
            "No automatic execution time limit.\n"
            "Start this terminal task?"
        )
        MB_YESNO, MB_ICONWARNING, MB_TOPMOST, MB_DEFBUTTON2 = 4, 0x30, 0x40000, 0x100
        result = user32.MessageBoxW(
            0, message, "WinBridge MCP — terminal approval",
            MB_YESNO | MB_ICONWARNING | MB_TOPMOST | MB_DEFBUTTON2
        )
        if result != 6:
            raise WorkspaceError("Terminal task was not approved on this computer.")

    @staticmethod
    def _drain(task: Task) -> None:
        try:
            if task.process.stdout is None:
                return
            for chunk in task.process.stdout:
                # Bound stored output; keep the most recent text for inspection.
                if len(chunk) > MAX_CAPTURED_CHARS:
                    chunk = chunk[-MAX_CAPTURED_CHARS:]
                    with task.lock:
                        task.truncated = True
                with task.lock:
                    task.output.append(chunk)
                    task.captured_chars += len(chunk)
                    while task.captured_chars > MAX_CAPTURED_CHARS:
                        old = task.output.popleft()
                        task.captured_chars -= len(old)
                        task.truncated = True
        finally:
            if task.process.stdout:
                task.process.stdout.close()

    def start(self, name: str, cwd: str = ".") -> dict:
        if name not in TASKS:
            raise WorkspaceError("Unknown terminal task. See terminal_catalog.")
        if sys.platform != "win32":
            raise WorkspaceError("Windows terminal tools require Windows.")
        directory = self.workspace.resolve(cwd, allow_root=True)
        if not directory.is_dir():
            raise WorkspaceError("Working directory must be an authorized directory.")
        command = TASKS[name]
        self._approve(name, directory, command[0])

        with self._lock:
            active = sum(1 for t in self._tasks.values() if t.process.poll() is None)
            if active >= MAX_TASKS:
                raise WorkspaceError("Too many running terminal tasks. Stop or finish one first.")
            # Old completed entries can be discarded; running entries are preserved.
            completed = [ident for ident, task in self._tasks.items()
                         if task.process.poll() is not None]
            if len(completed) > 40:
                for ident in completed[:-40]:
                    self._tasks.pop(ident, None)
            try:
                process = subprocess.Popen(
                    list(command), cwd=directory, shell=False,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, encoding="utf-8", errors="replace",
                    bufsize=1,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
            except OSError as exc:
                raise WorkspaceError(f"Cannot start terminal task: {exc}") from exc
            ident = uuid4().hex
            task = Task(
                task_id=ident, name=name, cwd=str(directory), process=process,
                started_at=datetime.now(timezone.utc).isoformat(),
            )
            self._tasks[ident] = task
            Thread(target=self._drain, args=(task,), daemon=True).start()
            self.workspace._audit(f"terminal_start:{name}", directory)
            return {"task_id": ident, "task": name, "status": "running",
                    "cwd": str(directory), "timeout_seconds": None}

    def status(self, task_id: str) -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
        if task is None:
            raise WorkspaceError("Unknown terminal task ID.")
        exit_code = task.process.poll()
        with task.lock:
            output = "".join(task.output)
            truncated = task.truncated
        return {
            "task_id": task.task_id,
            "task": task.name,
            "cwd": task.cwd,
            "started_at": task.started_at,
            "running": exit_code is None,
            "exit_code": exit_code,
            "output": output,
            "output_truncated": truncated,
        }

    def stop(self, task_id: str) -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
        if task is None:
            raise WorkspaceError("Unknown terminal task ID.")
        if task.process.poll() is not None:
            return {"task_id": task_id, "status": "finished"}
        task.process.terminate()
        self.workspace._audit(f"terminal_stop:{task.name}", Path(task.cwd))
        return {"task_id": task_id, "status": "termination_requested"}
