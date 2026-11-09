# WinBridge MCP - local installer for Claude Desktop on Windows 10/11.
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$venv = Join-Path $project '.venv'
$pythonExe = Join-Path $venv 'Scripts\python.exe'
$workspace = Join-Path $HOME 'Documents\WinBridgeWorkspace'
$configDir = Join-Path $env:APPDATA 'Claude'
$configPath = Join-Path $configDir 'claude_desktop_config.json'

Write-Host 'Installing WinBridge MCP...' -ForegroundColor Cyan
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv $venv
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv $venv
} else {
    throw 'Python 3.11 or newer is required. Install Python, then rerun this script.'
}
if ($LASTEXITCODE -ne 0) { throw 'Failed to create Python virtual environment.' }
& $pythonExe -m pip install -r (Join-Path $project 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Failed to install Python dependencies.' }
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
New-Item -ItemType Directory -Force -Path $configDir | Out-Null

if (Test-Path $configPath) {
    Copy-Item $configPath ($configPath + '.winbridge-backup') -Force
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    $config = [pscustomobject]@{}
}
if ($null -eq $config.mcpServers) {
    $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{}) -Force
}
$entry = [pscustomobject]@{
    command = $pythonExe
    args = @((Join-Path $project 'server.py'))
    env = [pscustomobject]@{
        WINBRIDGE_ROOTS = $workspace
        WINBRIDGE_WRITE = '1'
        WINBRIDGE_DESKTOP = '1'
    }
}
$config.mcpServers | Add-Member -NotePropertyName 'winbridge' -NotePropertyValue $entry -Force
$json = $config | ConvertTo-Json -Depth 25
# Windows PowerShell 5.1 adds a UTF-8 BOM with Set-Content; Claude expects plain JSON.
[System.IO.File]::WriteAllText($configPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Configured Claude Desktop: $configPath" -ForegroundColor Green
Write-Host "Workspace: $workspace"
Write-Host 'Restart Claude Desktop to load WinBridge MCP.' -ForegroundColor Yellow
Write-Host 'Claude Desktop may still request approval for individual tool calls.'
