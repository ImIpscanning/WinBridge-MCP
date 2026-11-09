# WinBridge Control Center

A Windows desktop management app built using **Electron + React + Vite** for the [WinBridge Node.js MCP server](../node/README.md).

The GUI is **not an alternative MCP runtime**. Claude Desktop starts its own separate `winbridge-node` stdio server. The Control Center edits its local configuration and provides a review interface for command proposals.

## Features

| Section | Functions |
|---|---|
| Dashboard | Show installation/configuration status, pending command proposals, task count and latest audit events |
| Approvals | Review a proposal sent by Claude, edit its executable/arguments, save it as a user-owned task profile, or dismiss it |
| Terminal Manager | Add/remove trusted custom profiles; inspect and run saved tasks; check output and stop jobs launched in the GUI |
| File Manager | Browse/read authorized text files, save private snapshots, browse backup history, restore previous versions with confirmation, restore recoverable trash |
| Desktop Manager | View window titles, request a manually approved screenshot, review editor permissions |
| Permission Center | Edit allowed project roots, workspace writes, desktop observation and app allowlist; pause new MCP actions |
| History | Read recent WinBridge audit log entries |
| Settings | Dark/light themes, config export/import, start GUI at login (packaged Windows), check signed-off GUI release tags on GitHub, and open Releases |

### Command approval flow

1. Claude calls the **`terminal_propose_command`** MCP tool, providing a structured proposal containing a display name, executable, arguments and workspace.
2. The MCP server writes it into a **pending review inbox** under `%APPDATA%\WinBridge-MCP\requests`. No process launches and no profile is trusted yet.
3. Open Control Center → **Aprobaciones**. Read the entire proposal and select **Revisar y guardar**.
4. Edit the proposed task if necessary, then click **Guardar tarea**. Only this local human interaction adds it to `%APPDATA%\WinBridge-MCP\custom-tasks.json`.
5. Claude can then request `terminal_preview_custom` and `terminal_start_custom`. **Each execution still requires Windows approval**, defaults to No, has no fixed timeout, and can be manually canceled.

A proposal cannot directly approve itself or execute. The server does not offer arbitrary agent-supplied shell execution. Windows OS permissions remain in force. Use only reviewed scripts and avoid running the application as Administrator.

### File backups

Select a text file in **File Manager** and choose **Respaldar**. Backups are copied to `%APPDATA%\WinBridge-MCP\backups`, outside the model-writable project folders. Click **Respaldos** to list available versions.

- Restore without overwrite only if the original file no longer exists.
- **Reemplazar** asks for confirmation and first backs up the current version.
- Backup operations are restricted to authorized workspace files (maximum 20 MB per snapshot), and restoration is permitted only while workspace writes are enabled.
- File snapshots are local and don't upload anything automatically.

### Emergency pause

**Pausar** writes a marker outside the MCP-writable workspace. The Node.js MCP server checks the marker before starting new tool actions. **It does not terminate existing processes.** Restarting Claude Desktop is needed to apply changes to its environment-based permissions; the pause marker is effective on subsequent tool calls without restarting.

## Install prebuilt Windows EXE

1. Open [GitHub Actions — WinBridge Control Center](https://github.com/ImIpscanning/WinBridge-MCP/actions/workflows/control-center.yml).
2. Open a successful **Windows** workflow run.
3. Download the **WinBridge-Control-Center-Windows-x64** artifact and extract its ZIP.
4. Run the `.exe` installer. The app is currently **unsigned**, so Windows SmartScreen may warn; only install a build you trust.
5. Install the Node MCP separately using the instructions in [node/README.md](../node/README.md) if it isn't installed yet.

The GUI is only a management interface; it does not install Claude Desktop or automatically add arbitrary commands.

## Development

Requires **Node.js 22+** (recommended), npm and Windows to test desktop interaction.

```powershell
git clone https://github.com/ImIpscanning/WinBridge-MCP.git
cd WinBridge-MCP\gui
npm install
npm run check
npm test
npm run build
npm run dev
```

`npm run dev` runs Vite on the loopback address `127.0.0.1:5173` and starts the Electron app. The dev server is only a local UI development endpoint and is not an MCP HTTP endpoint.

Build an unsigned Windows installer:

```powershell
cd gui
npm run dist:win
```

Output is in `gui/dist-installer`. GitHub Actions can build it on a Windows runner.

## Privacy and security

- Electron uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a restrictive Content Security Policy and a narrowly scoped preload API.
- It does **not** expose an HTTP control API or a remotely accessible terminal.
- The renderer never directly reads files or invokes system shells; all operations go through validated main-process handlers.
- Claude proposals are rendered as untrusted text, never executed on receipt.
- Custom task profiles and the approval queue live outside model-writable project folders.
- Changing the MCP tool permissions requires restarting Claude Desktop. An emergency pause affects subsequent Node MCP actions without restarting.
- Screenshot/desktop input may expose sensitive information. Do not approve unexpected prompts.
- Backups and audit logs are local; the audit log is best-effort, not tamper-evident.
- Electron updates are **checked manually** against GitHub's releases API, considering only stable Control Center release tags. The GUI never downloads or executes an update automatically. Signed automatic updates require a separate signed release workflow.

## Roadmap

- Native Windows desktop-session integration tests for actual mouse actions
- Signed Windows installers and opt-in verified auto-updates
- Persistent task monitoring across separately launched GUI and Claude MCP processes
- File snapshot and restore history

**License:** MIT (repository root).
