import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export function windowsOnly() {
  if(process.platform!=="win32")throw new Error("Windows desktop tools require Windows 10/11.");
}
function powershell(script, envExtra={}) {
  windowsOnly();
  const r=spawnSync("powershell.exe", ["-NoProfile","-NonInteractive","-Command",script],{
    encoding:"utf8",shell:false,windowsHide:true,maxBuffer:2_000_000,
    env:{...process.env,...envExtra}
  });
  if(r.error)throw r.error;
  if(r.status!==0)throw new Error((r.stderr||r.stdout||"PowerShell task declined or failed.").slice(0,1000));
  return r.stdout.trim();
}
export function localApprove(description) {
  // User-provided text goes through an environment variable, never into script source.
  const script=`Add-Type -AssemblyName System.Windows.Forms
$r=[System.Windows.Forms.MessageBox]::Show($env:WINBRIDGE_APPROVAL_MESSAGE, 'WinBridge MCP - local approval', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning, [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
if ($r -eq [System.Windows.Forms.DialogResult]::Yes) { exit 0 } else { exit 1 }`;
  powershell(script,{WINBRIDGE_APPROVAL_MESSAGE:description.slice(0,900)+"\n\nApprove this action?"});
}
export function desktopEnabled() {
  if(process.env.WINBRIDGE_DESKTOP!=="1")throw new Error("Desktop access disabled (WINBRIDGE_DESKTOP).");
  windowsOnly();
}
export function listWindows() {
  desktopEnabled();
  const s=`Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 60 Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`;
  const value=powershell(s);
  if(!value)return [];
  const parsed=JSON.parse(value);
  return Array.isArray(parsed)?parsed:[parsed];
}
export function captureDesktop() {
  desktopEnabled();
  localApprove("Capture a screenshot of the currently visible Windows desktop. Sensitive information on the screen could be exposed to Claude.");
  const target=path.join(os.tmpdir(),"winbridge-"+crypto.randomUUID()+".png");
  const script=`Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap=New-Object System.Drawing.Bitmap($screen.Width,$screen.Height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($screen.Left,$screen.Top,0,0,$screen.Size)
  $bitmap.Save($env:WINBRIDGE_SCREENSHOT_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }`;
  try {
    powershell(script,{WINBRIDGE_SCREENSHOT_PATH:target});
    return fs.readFileSync(target).toString("base64");
  } finally {
    try{fs.unlinkSync(target);}catch{}
  }
}
export function openExplorer(workspace,target) {
  desktopEnabled();
  const folder=workspace.resolve(target,true);
  if(!fs.statSync(folder).isDirectory())throw new Error("Only workspace directories can be opened.");
  localApprove("Open Windows File Explorer in:\n"+folder);
  const result=spawnSync("explorer.exe",[folder],{shell:false,windowsHide:false,encoding:"utf8"});
  if(result.error)throw result.error;
  return {opened:folder};
}
