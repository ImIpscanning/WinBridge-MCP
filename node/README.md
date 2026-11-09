# WinBridge MCP — Node.js edition v0.2 (preview)

A separate **Node.js / JavaScript** Model Context Protocol (MCP) server for Claude Desktop. It does **not** require Python, and it does **not** replace the Python edition in the repository.

Uses the official **MCP TypeScript SDK v2** (`@modelcontextprotocol/server`) in JavaScript ES modules. Launch method: local stdio subprocess, not an HTTP listener.

## Install — Windows 10/11

Prerequisites: **Node.js 20+**, npm, Git, Claude Desktop. Open an ordinary PowerShell window:

```powershell
git clone https://github.com/ImIpscanning/WinBridge-MCP.git
cd WinBridge-MCP
.\node\install-node.ps1
```

The installer runs npm install, creates `Documents\WinBridgeWorkspace`, backs up the existing Claude Desktop configuration, then registers a server named **`winbridge-node`** in `%APPDATA%\Claude\claude_desktop_config.json`. Close and reopen Claude Desktop afterward.

### If you already cloned the project

```powershell
cd WinBridge-MCP
git pull
.\node\install-node.ps1
```

### Select Node or Python

The Node installer does not delete other MCP connections. If you installed the Python edition, you may see two entries: `winbridge` (Python) and `winbridge-node` (Node.js). You can disable one in Claude Desktop configuration to avoid duplicate tools.

## Implemented tools

| Area | Tools |
|---|---|
| Workspace | `workspace_info`, `list_directory`, `read_file`, `search_text` |
| File management | `create_directory`, `write_file`, `preview_text_edit`, `replace_text`, `move_file`, `delete_file`, `trash_list`, `restore_file` |
| PowerShell / CMD | `terminal_catalog`, `terminal_start`, `terminal_status`, `terminal_stop` |
| Desktop observation | `desktop_list_windows`, `desktop_screenshot`, `desktop_open_workspace`, `desktop_active_window` |
| Desktop interaction | `desktop_input_status`, `desktop_move_cursor`, `desktop_click`, `desktop_type_text`, `desktop_hotkey`, `desktop_scroll` |

New terminal tasks run **without a fixed execution timeout** and can be stopped manually. However, they use **predefined diagnostic commands**, not unrestricted PowerShell or CMD scripts. Starting a job requires a local Windows Yes/No confirmation.

For screenshot capture and opening Explorer, local approval is also required. The **Node implementation now supports mouse movement, clicks, short Unicode text entry, editor hotkeys and scrolling**. Each input action is separately approved on the Windows PC and targets only approved foreground applications. This is not unattended or remote desktop control.

### Mouse and keyboard permission setup

The Windows installer sets these variables in the `winbridge-node` entry:

- `WINBRIDGE_DESKTOP=1` — enable desktop observation
- `WINBRIDGE_INPUT=1` — allow input actions only after a visible on-device Yes/No confirmation
- `WINBRIDGE_INPUT_APPS=notepad.exe;code.exe` — the list of approved foreground executables

To disable input immediately, change `WINBRIDGE_INPUT` to `0` and restart Claude Desktop. To authorize another trusted editor, add its **exact executable basename** to the app list, separated by a semicolon. Avoid browsers, terminals, admin utilities, login dialogs or apps containing sensitive information. Windows may block input to elevated applications.

**Input workflow:** ask `desktop_input_status` to verify permissions and `desktop_active_window` to obtain window bounds. Take a screenshot if needed, then ask `desktop_move_cursor`, `desktop_click`, `desktop_type_text`, `desktop_hotkey`, or `desktop_scroll`. A Windows confirmation window (default **No**) appears before each action. If the foreground application changes, the tool cancels the action. For scrolling, the cursor must already be inside the foreground window. On multi-monitor systems, `desktop_active_window` returns global screen coordinates.

The code uses the built-in Windows PowerShell and Win32 APIs, so **no native Node.js desktop automation dependency needs to be compiled**. It runs only in an interactive Windows session; headless CI tests validate the MCP protocol, not actual clicks.

## Configuration

In `%APPDATA%\Claude\claude_desktop_config.json`, the Node server entry should resemble:

```json
{
  "mcpServers": {
    "winbridge-node": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\PATH\\TO\\WinBridge-MCP\\node\\src\\server.mjs"],
      "env": {
        "WINBRIDGE_ROOTS": "C:\\Users\\YOU\\Documents\\WinBridgeWorkspace",
        "WINBRIDGE_WRITE": "1",
        "WINBRIDGE_DESKTOP": "1",
        "WINBRIDGE_INPUT": "1",
        "WINBRIDGE_INPUT_APPS": "notepad.exe;code.exe"
      }
    }
  }
}
```

This JSON is **illustrative**, not a replacement for an existing config. The installer automatically uses the paths detected on your computer. If `WINBRIDGE_ROOTS` contains multiple paths, separate them with semicolons on Windows. Use dedicated project folders only; avoid authorizing your whole drive.

## Try it in Claude Desktop

- "Using winbridge-node, show my workspace info."
- "Create a folder called demo and a README.md file inside it."
- "Preview replacing a sentence in README.md."
- "List the available CMD and PowerShell diagnostic tasks."
- "Start the PowerShell version task, show its output, and report whether it finished."
- "Ask for local approval to take a desktop screenshot."
- "Show the active window bounds, then with my approval type Hello in Notepad."
- "With my approval, save the open file in VS Code using Ctrl+S."

The active process is managed by Claude Desktop; you do not need to leave a Node command prompt open. Completely quitting Claude Desktop stops its stdio MCP server.

## Development

```powershell
cd node
npm install
npm run check
npm test
npm start
```

Running `npm start` manually leaves the stdio MCP process waiting for an MCP client; use Claude Desktop for normal operation.

## Security notes

The tools run with the privileges of the local Windows user. Don't run Claude Desktop as Administrator. Mouse and keyboard operations are restricted to local allowlisted editors and checked again after confirmation. Screenshots and file contents may be sent to Claude's model service when approved. The local server limits file paths, filters common secret paths and shows on-device dialogs for terminal jobs and screenshots.

Read [../SECURITY.md](../SECURITY.md). A future `.mcpb` desktop extension package could offer a simpler point-and-click installation, using Claude Desktop's included Node.js runtime.
