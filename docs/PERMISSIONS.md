# Windows permissions guide

## Which permission happens where?

- **Windows:** controls the user account's file and application privileges.
- **Claude Desktop:** can ask whether a proposed MCP tool call should run. Claude's confirmation behavior depends on its version and settings.
- **WinBridge:** checks file paths, approved apps and tool operations itself.
- **User's own desktop:** shows an extra Windows Yes/No dialog for every click, typing, hotkey and scroll. The action does not execute if the user rejects it.

## Setup

1. Install using `install.ps1` in ordinary (non-admin) PowerShell.
2. Open `%APPDATA%\Claude\claude_desktop_config.json`.
3. Change `WINBRIDGE_ROOTS` to your specific projects, separated by semicolons.
4. Edit `WINBRIDGE_INPUT_APPS` if you want to interact with other *trusted* foreground editors.
5. Restart Claude Desktop. Inspect available tools with `desktop_input_status` and `workspace_info`.

## What works today (v0.2)

- Workspace: list, read, search, create folders/files, edit and move text files, preview changes, recover deleted files.
- Terminal: status, log, diff and other read-only Git checks; Python version; static Python syntax checks without executing project code.
- Screen: capture screenshot and inspect visible window titles.
- Input: approved-app mouse click, ASCII typing, basic editing hotkeys and scrolling. Every action needs direct approval on Windows.

## Deliberate limitations

This project does not provide an unsupervised arbitrary command executor, administrator escalation, a credential manager, keystroke monitoring, unattended login automation or a remote-control service. The desktop input module is not a full accessibility API; tests on actual Windows machines are still necessary.

## Quick troubleshooting

- **No tools in Claude?** Quit and reopen Claude Desktop, review the configuration JSON, inspect local MCP logs.
- **Desktop action refused?** Confirm `WINBRIDGE_DESKTOP` and `WINBRIDGE_INPUT` are both `1`, and the active app's executable is allowlisted.
- **Screenshots fail?** Check the desktop session is interactive, then re-run the installer.
- **File access denied?** Add the correct project folder to `WINBRIDGE_ROOTS`; do not bypass OS security.
