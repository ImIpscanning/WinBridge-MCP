# WinBridge MCP

**A local Windows bridge for Claude Desktop — scoped file access, project editing, terminal diagnostics and desktop observation.**

WinBridge is an open-source [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server built with the official Python SDK v2. Claude Desktop launches it as a **local stdio subprocess**. There is **no listening TCP port, remote service or cloud relay** in this project. MCP tool results can still be sent to Claude by the desktop app when you approve tool usage.

## Features (v0.1)

| Module | Capabilities |
|---|---|
| Workspace | See configured roots, browse directories, read UTF-8 text, search project files |
| Editor | Create and overwrite text files, perform exact-match replacements, move files |
| Recovery | Delete files to a private recoverable trash folder, restore by ID |
| Terminal | Read-only `git status`, `git diff`, `git log`, and Python version diagnostics |
| Desktop | On-demand screen capture, visible window titles, open allowed folder in Explorer |
| Safety | Folder allowlist, sensitive-path exclusions, bounded text/file sizes, audit log |

> This is not unrestricted control of Windows. Arbitrary PowerShell/CMD execution, unrestricted file deletion, unattended clicking/typing, access to secret files and remote connections are intentionally **not provided**. Claude Desktop controls its own per-tool approval UI; MCP annotations are suggestions, not a replacement for hard server-side checks.

## Windows 10/11 install

Requires **Python 3.11+** and **Claude Desktop**. Clone the project, then run in PowerShell:

```powershell
git clone https://github.com/ImIpscanning/prueba.git
cd prueba
.\install.ps1
```

The installer creates a virtual environment, installs `mcp` and `mss`, makes `%USERPROFILE%\Documents\WinBridgeWorkspace`, and **merges** the `winbridge` entry into `%APPDATA%\Claude\claude_desktop_config.json`. It backs up an existing config to `.winbridge-backup` before editing it. Restart Claude Desktop afterwards.

### Add your project folders

Edit `%APPDATA%\Claude\claude_desktop_config.json` and adjust the `WINBRIDGE_ROOTS` environment variable to the exact folders you want Claude to access, separated by semicolons on Windows:

```json
{
  "mcpServers": {
    "winbridge": {
      "command": "C:\\PATH\\TO\\prueba\\.venv\\Scripts\\python.exe",
      "args": ["C:\\PATH\\TO\\prueba\\server.py"],
      "env": {
        "WINBRIDGE_ROOTS": "C:\\Users\\YOU\\Documents\\WinBridgeWorkspace;D:\\Projects",
        "WINBRIDGE_WRITE": "1",
        "WINBRIDGE_DESKTOP": "1"
      }
    }
  }
}
```

Set `WINBRIDGE_WRITE` to `0` for a read-only workspace. Set `WINBRIDGE_DESKTOP` to `0` to disable desktop access entirely. Do **not** add your entire disk or home folder as an allowlisted root. Restart Claude Desktop after modifying config.

## Try it in Claude Desktop

Try these requests, approving each tool when prompted:

1. "List the files in my WinBridge workspace."
2. "Create a README.md explaining a small Python project in my workspace."
3. "Find occurrences of TODO in my project files."
4. "Show git_status for my project."
5. "Take a screenshot of my desktop and describe the open application."

Each request is processed through MCP; no tool is executed until Claude asks to call it. Exact permission prompts depend on Claude Desktop's current settings.

## Tool reference

- `workspace_info`, `list_directory`, `read_file`, `search_text`
- `write_file`, `replace_text`, `move_file`
- `delete_file`, `restore_file`
- `terminal_task` (`git_status`, `git_diff`, `git_log`, `python_version`)
- `desktop_list_windows`, `desktop_screenshot`, `desktop_open_workspace`

Max text file size: 1 MB. `read_file` and search outputs are bounded. Directory listing is limited to 200 items. Text search stops at 1000 examined files. File deletion is recoverable; the local trash is stored in `.winbridge_trash` in the corresponding workspace.

## Development

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe server.py
```

The last command starts a stdio MCP server and appears idle until a compatible MCP host connects. You can also inspect the server with the MCP Inspector if you have Node.js installed.

## Security and permissions

WinBridge checks resolved paths against configured roots and blocks traversal outside them. `.git`, `.env`, credential/key file extensions and the internal audit/trash paths are restricted. Delete-to-trash is reversible. Operations run with the OS permissions of the signed-in user, so **do not run the program as Administrator**. Screenshots may include private data: review Claude's prompts before approving them. Use only on a PC you control.

Local activity is logged to `.winbridge_audit.jsonl` inside each workspace (best effort). For a full trusted audit trail or enterprise deployment, you would need more robust integrity protection and testing.

## Roadmap

- GUI to manage folder permissions and review actions
- Granular per-project read/write policy
- Safer structured build and test runners
- Workspace snapshots, undo history and file diff previews
- Controlled desktop interaction with explicit on-device approvals

**License:** MIT (see LICENSE).
