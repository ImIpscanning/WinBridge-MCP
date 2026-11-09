# WinBridge MCP Node.js installer for Claude Desktop (Windows 10/11).
# Run in a normal PowerShell window, not as Administrator.
$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$entryFile = Join-Path $project 'src\server.mjs'
$workspace = Join-Path $HOME 'Documents\WinBridgeWorkspace'
$configDir = Join-Path $env:APPDATA 'Claude'
$configPath = Join-Path $configDir 'claude_desktop_config.json'
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand -or $null -eq $npmCommand) {
    throw 'Node.js 20+ with npm is required. Install the official Node.js LTS release first.'
}
$nodeVersion = & $nodeCommand.Source --version
$major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
if ($major -lt 20) { throw "Node.js 20 or newer is required. Installed: $nodeVersion" }

Write-Host "Installing WinBridge MCP (Node.js $nodeVersion)..." -ForegroundColor Cyan
Push-Location $project
try {
    & $npmCommand.Source install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    & $nodeCommand.Source --check $entryFile
    if ($LASTEXITCODE -ne 0) { throw 'Node server syntax check failed.' }
    & $nodeCommand.Source --check (Join-Path $project 'src\windows-input.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop input module syntax check failed.' }
} finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $workspace | Out-Null
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
if (Test-Path $configPath) {
    Copy-Item $configPath ($configPath + '.winbridge-node-backup') -Force
    $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
    $config = [pscustomobject]@{}
}
if ($null -eq $config.mcpServers) {
    $config | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{}) -Force
}
$entry = [pscustomobject]@{
    command = $nodeCommand.Source
    args = @($entryFile)
    env = [pscustomobject]@{
        WINBRIDGE_ROOTS = $workspace
        WINBRIDGE_WRITE = '1'
        WINBRIDGE_DESKTOP = '1'
        WINBRIDGE_INPUT = '1'
        WINBRIDGE_INPUT_APPS = 'notepad.exe;code.exe'
    }
}
$config.mcpServers | Add-Member -NotePropertyName 'winbridge-node' -NotePropertyValue $entry -Force
$json = $config | ConvertTo-Json -Depth 30
[System.IO.File]::WriteAllText($configPath,$json,(New-Object System.Text.UTF8Encoding($false)))
Write-Host 'WinBridge Node registered as winbridge-node in Claude Desktop.' -ForegroundColor Green
Write-Host "Configuration: $configPath"
Write-Host 'Close and reopen Claude Desktop to use the new Node MCP tools.' -ForegroundColor Yellow
Write-Host 'The Python winbridge entry is preserved; disable it manually if you want only Node tools.'
