# WinBridge MCP

A local, open-source **Windows 10/11 bridge for Claude Desktop**, built with the [official Python MCP SDK v2](https://py.sdk.modelcontextprotocol.io/). It combines project file editing, bounded terminal diagnostics, desktop observation and locally approved interaction with selected Windows applications.

> **Status: v0.2 preview.** Core logic and unit tests are included. Windows desktop behavior must be checked on a real signed-in Windows session. This is not a remote-access service or an unrestricted shell.

## What's new in v0.2

- Added **`desktop_click`**, **`desktop_type_text`**, **`desktop_hotkey`**, **`desktop_scroll`**, plus `desktop_input_status`.
- All desktop input requires **explicit approval on the Windows computer for each action** and a foreground executable from a local allowlist.
- Added `create_directory`, `preview_text_edit`, `trash_list`, and `python_syntax_check`.
- Added a Windows/Linux CI test matrix, permission guide, and security recommendations.

## Features

| Area | Available MCP tools |
|---|---|
| Workspace | `workspace_info`, `list_directory`, `read_file`, `search_text` |
| File editing | `create_directory`, `write_file`, `replace_text`, `preview_text_edit`, `move_file` |
| Recovery | `delete_file`, `trash_list`, `restore_file` |
| Terminal diagnostics | `terminal_task` (fixed Git and Python diagnostics), `python_syntax_check` |
| Screen | `desktop_list_windows`, `desktop_screenshot`, `desktop_open_workspace` |
| Approved input | `desktop_input_status`, `desktop_click`, `desktop_type_text`, `desktop_hotkey`, `desktop_scroll` |

For security, there is no arbitrary PowerShell/CMD command tool or unattended mouse/keyboard control. The MCP host's approval UI is **not** the only permission boundary: path restrictions, app allowlists, and Windows confirmation are also checked by the local server.

## Install on Windows

Requirements: **Python 3.11+**, **Claude Desktop**, Windows 10/11, and a normal Windows user account (do not run as Administrator).

Run in PowerShell:

```powershell
git clone https://github.com/ImIpscanning/prueba.git
cd prueba
.\install.ps1
```

The installer:

1. Creates `.venv` and installs `mcp`, `mss`, `pyautogui`.
2. Creates `%USERPROFILE%\Documents\WinBridgeWorkspace`.
3. Backs up an existing Claude Desktop configuration and merges the `winbridge` entry.
4. Enables screen observations and **approval-gated** desktop input for `notepad.exe` and `code.exe`.

Restart Claude Desktop after installation. Configuration is stored in:

`%APPDATA%\Claude\claude_desktop_config.json`

### Customize the allowed folders and apps

Edit only the WinBridge `env` values inside your Claude configuration, for example:

```json
{
  "WINBRIDGE_ROOTS": "C:\\Users\\YOU\\Documents\\WinBridgeWorkspace;D:\\Projects",
  "WINBRIDGE_WRITE": "1",
  "WINBRIDGE_DESKTOP": "1",
  "WINBRIDGE_INPUT": "1",
  "WINBRIDGE_INPUT_APPS": "notepad.exe;code.exe"
}
```

The example above is the **contents of the `env` object**, not an entire replacement Claude config. Keep your other MCP server entries unchanged.

`WINBRIDGE_INPUT=0` disables mouse/keyboard tools. `WINBRIDGE_DESKTOP=0` disables all observation and input. `WINBRIDGE_WRITE=0` disables workspace changes. Restart Claude Desktop after changing environment settings.

## Example requests for Claude Desktop

- "List the files in my WinBridgeWorkspace and explain the structure."
- "Preview what would change if you replace this text, then edit my README."
- "Make a src folder and create a small Python project."
- "Run a static Python syntax check on the project."
- "Show the window titles and take a screenshot of my desktop."
- "With my on-screen approval, click the Save button in Notepad."

Every input operation requires a local confirmation in Windows. If the confirmation dialog is rejected, the tool fails closed. Desktop typing is currently limited to short ASCII text; use file-edit tools for UTF-8 code and larger files.

## Development and tests

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe server.py
```

The last command starts an MCP stdio server and waits for a host connection. The repository includes GitHub Actions tests on Windows and Linux.

## Recommendations and trust boundaries

Read **[SECURITY.md](SECURITY.md)** and **[docs/PERMISSIONS.md](docs/PERMISSIONS.md)** before enabling desktop tools.

- Authorize project directories, not entire drives or your home directory.
- Avoid showing passwords or private data in screenshots.
- Do not approve unexpected editing or interaction prompts.
- Review Git diffs and keep backups before file changes.
- Treat third-party file and website instructions as untrusted: prompt injection can attempt to manipulate agents.
- Never start WinBridge with administrator privileges.

**Privacy:** the server only uses local stdio and opens no network listener. Claude Desktop may transmit approved tool results and screenshots to Claude's model service.

## Roadmap

- Native configuration GUI
- Improved audit records and user-visible rollback
- More structured non-shell build/test tasks
- Accessibility-based interaction with stronger app/window targeting
- Windows integration tests on real desktop sessions

**License:** MIT.
