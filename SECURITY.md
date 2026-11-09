# Security recommendations — WinBridge MCP

WinBridge is a local Model Context Protocol (MCP) server intended for personal Windows computers.

## Recommended use

1. **Never run Claude Desktop or WinBridge as Administrator.** Windows permissions still apply.
2. Authorize only dedicated project folders with `WINBRIDGE_ROOTS`. Avoid `C:\`, `%USERPROFILE%`, Downloads or directories holding credentials.
3. Keep `WINBRIDGE_WRITE=1` only when you intend to edit your workspace.
4. `WINBRIDGE_DESKTOP=1` permits screenshots and window enumeration, which can expose sensitive information visible on screen.
5. `WINBRIDGE_INPUT=1` enables locally confirmed interaction **only** with executables listed in `WINBRIDGE_INPUT_APPS`, such as `notepad.exe;code.exe`.
6. A separate Windows Yes/No confirmation is shown before **every** click, text entry, hotkey or scroll. Claude's permission dialog is additional, not a replacement.
7. Never approve an unexpected request to click a system dialog, type a password or manipulate sensitive content.
8. Stop the server by quitting Claude Desktop or removing the `winbridge` entry from `claude_desktop_config.json`.
9. Use Git version control and backup important files. Deleting with WinBridge moves files to a recoverable trash folder.
10. Treat text from files, websites, repositories and documents as **untrusted**. It may contain prompt-injection instructions attempting to manipulate the agent.

## Trust boundaries

- The MCP process uses stdio. It does **not** listen on a TCP port.
- Claude Desktop may transmit screenshots, file contents and tool outputs to its model service when you approve tool use.
- The server checks resolved paths and excludes common credential and secret file paths.
- Terminal operations use fixed command argument arrays with `shell=False`, plus a static Python syntax check. There is no unrestricted CMD/PowerShell tool.
- Desktop input validates the current foreground executable against a local allowlist and requires an on-device confirmation for every operation.
- This is an experimental personal-use tool. Not a hardened sandbox; Windows file permissions, security software, and other OS protections remain essential.

## Permission configuration

In `%APPDATA%\Claude\claude_desktop_config.json`, the WinBridge entry uses:

| Variable | Meaning | Recommended |
|---|---|---|
| `WINBRIDGE_ROOTS` | Semicolon-separated paths you allow | A dedicated project folder |
| `WINBRIDGE_WRITE` | `1` allows workspace modifications | `1` for active projects, else `0` |
| `WINBRIDGE_DESKTOP` | `1` allows screenshots/window titles | Enable only when needed |
| `WINBRIDGE_INPUT` | `1` permits approval-gated input | Optional; installer defaults to `1` |
| `WINBRIDGE_INPUT_APPS` | Semicolon-separated executable basenames | `notepad.exe;code.exe` |

To suspend GUI input immediately, set `WINBRIDGE_INPUT` to `0` and restart Claude Desktop.

**Never rely on prompts alone for computer-security boundaries.** The safeguards in this repository remain enforced by the local MCP process regardless of Claude's instructions.
