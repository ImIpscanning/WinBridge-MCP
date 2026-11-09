# WinBridge MCP — Node.js edition (preview)

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
| Desktop observation | `desktop_list_windows`, `desktop_screenshot`, `desktop_open_workspace` |

New terminal tasks run **without a fixed execution timeout** and can be stopped manually. However, they use **predefined diagnostic commands**, not unrestricted PowerShell or CMD scripts. Starting a job requires a local Windows Yes/No confirmation.

For screenshot capture and opening Explorer, local approval is also required. The Node implementation **does not yet include mouse clicks and keyboard typing**; those tools are currently available only in the Python edition with application allowlists and local approval.

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
        "WINBRIDGE_DESKTOP": "1"
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

The tools run with the privileges of the local Windows user. Don't run Claude Desktop as Administrator. Screenshots and file contents may be sent to Claude's model service when approved. The local server limits file paths, filters common secret paths and shows on-device dialogs for terminal jobs and screenshots.

Read [../SECURITY.md](../SECURITY.md). A future `.mcpb` desktop extension package could offer a simpler point-and-click installation, using Claude Desktop's included Node.js runtime.
