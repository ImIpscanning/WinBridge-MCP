/** Local, approval-gated mouse/keyboard input for selected Windows editors.
 *  No remotely reachable listener; untrusted text is sent as JSON in an env
 *  variable, never interpolated into PowerShell source.
 */
import { spawnSync } from "node:child_process";

export const DEFAULT_INPUT_APPS = "notepad.exe;code.exe";
export const ALLOWED_HOTKEYS = Object.freeze([
  "ctrl+a", "ctrl+c", "ctrl+f", "ctrl+s", "ctrl+v", "ctrl+y", "ctrl+z"
]);
const MAX_TYPED_CHARS = 500;

export function desktopInputStatus(env=process.env) {
  return {
    desktop_enabled: env.WINBRIDGE_DESKTOP === "1",
    input_enabled: env.WINBRIDGE_INPUT === "1",
    allowed_apps: (env.WINBRIDGE_INPUT_APPS ?? DEFAULT_INPUT_APPS)
      .split(";").map(s => s.trim().toLowerCase()).filter(Boolean),
    local_approval_per_action: true,
    allowed_hotkeys: ALLOWED_HOTKEYS,
    max_text_characters: MAX_TYPED_CHARS
  };
}

export function validateDesktopRequest(action, params={}) {
  const integer = n => Number.isSafeInteger(n);
  switch(action) {
    case "active_window":
      return { action };
    case "move":
    case "click": {
      const {x,y}=params;
      if(!integer(x) || !integer(y) || Math.abs(x)>100000 || Math.abs(y)>100000)
        throw new Error("Mouse coordinates must be finite integer screen pixels.");
      if(action==="click" && !["left","right"].includes(params.button ?? "left"))
        throw new Error("Mouse button must be left or right.");
      return {action,x,y,...(action==="click"?{button:params.button ?? "left"}:{})};
    }
    case "scroll": {
      if(!integer(params.amount) || params.amount===0 || Math.abs(params.amount)>10)
        throw new Error("Scroll amount must be an integer from -10 to 10, except zero.");
      return {action,amount:params.amount};
    }
    case "type": {
      if(typeof params.text!=="string" || !params.text.length ||
        params.text.length>MAX_TYPED_CHARS || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(params.text))
        throw new Error("Text must be 1 to 500 characters and contain no unsupported control characters.");
      return {action,text:params.text};
    }
    case "hotkey": {
      if(!ALLOWED_HOTKEYS.includes(params.keys))
        throw new Error("Unknown shortcut. Use an allowed editor hotkey.");
      return {action,keys:params.keys};
    }
    default: throw new Error("Unknown desktop operation.");
  }
}

// A static PowerShell script with fixed capabilities; no arbitrary commands are accepted.
// Windows Forms is used for the user prompt. Win32 input only targets a verified app.
export const WINDOWS_INPUT_SCRIPT = String.raw\`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WinBridgeNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder title, int capacity);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint Type; public INPUTUNION U; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT Mi;
        [FieldOffset(0)] public KEYBDINPUT Ki;
        [FieldOffset(0)] public HARDWAREINPUT Hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int Dx, Dy; public uint MouseData, Flags, Time; public IntPtr Extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort Vk, Scan; public uint Flags, Time; public IntPtr Extra;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint Message; public ushort WParamL, WParamH; }
    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint SendInput(uint count, INPUT[] input, int size);

    private static void Key(ushort vk, ushort scan, uint flags) {
        var input = new INPUT();
        input.Type = 1; input.U.Ki = new KEYBDINPUT { Vk=vk, Scan=scan, Flags=flags };
        if (SendInput(1,new INPUT[]{input},Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new InvalidOperationException("Windows refused keyboard input.");
    }
    public static void TypeText(string text) {
        foreach (char ch in text) {
            if (ch=='\\n' || ch=='\\r') { Key(13,0,0); Key(13,0,2); continue; }
            if (ch=='\\t') { Key(9,0,0); Key(9,0,2); continue; }
            Key(0,ch,4); Key(0,ch,6); // KEYEVENTF_UNICODE + KEYEVENTF_KEYUP
        }
    }
    public static void EditorShortcut(char letter) {
        byte code = checked((byte)Char.ToUpperInvariant(letter));
        keybd_event(0x11,0,0,UIntPtr.Zero);
        try { keybd_event(code,0,0,UIntPtr.Zero); keybd_event(code,0,2,UIntPtr.Zero); }
        finally { keybd_event(0x11,0,2,UIntPtr.Zero); }
    }
    public static void MouseClick(string button) {
        uint down = button=="right" ? 0x0008u : 0x0002u;
        uint up = button=="right" ? 0x0010u : 0x0004u;
        mouse_event(down,0,0,0,UIntPtr.Zero);
        mouse_event(up,0,0,0,UIntPtr.Zero);
    }
    public static void MouseScroll(int amount) {
        mouse_event(0x0800u,0,0,unchecked((uint)(amount*120)),UIntPtr.Zero);
    }
}
'@ | Out-Null

function Get-VerifiedWindow {
    $hwnd = [WinBridgeNative]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { throw 'No active Windows application.' }
    [uint32]$pidValue = 0
    [void][WinBridgeNative]::GetWindowThreadProcessId($hwnd,[ref]$pidValue)
    if ($pidValue -eq 0) { throw 'Could not verify foreground process.' }
    $process = [System.Diagnostics.Process]::GetProcessById([int]$pidValue)
    $exe = [System.IO.Path]::GetFileName($process.MainModule.FileName).ToLowerInvariant()
    $allowed = @($env:WINBRIDGE_INPUT_APPS -split ';' |
       ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ })
    if ($exe -notin $allowed) { throw "Foreground app '$exe' is not allowed." }
    $titleBuffer = New-Object System.Text.StringBuilder 256
    [void][WinBridgeNative]::GetWindowTextW($hwnd,$titleBuffer,$titleBuffer.Capacity)
    if ($titleBuffer.Length -eq 0) { throw 'Foreground window must have a visible title.' }
    $rect = New-Object WinBridgeNative+RECT
    if (-not [WinBridgeNative]::GetWindowRect($hwnd,[ref]$rect)) { throw 'Window rectangle unavailable.' }
    return @{ Handle=$hwnd; App=$exe; Title=$titleBuffer.ToString(); Rect=$rect }
}
function Test-PointInWindow($window,[int]$x,[int]$y) {
    $r = $window.Rect
    $v = [System.Windows.Forms.SystemInformation]::VirtualScreen
    return ($x -ge $r.Left -and $x -lt $r.Right -and
            $y -ge $r.Top -and $y -lt $r.Bottom -and
            $x -ge $v.Left -and $x -lt $v.Right -and
            $y -ge $v.Top -and $y -lt $v.Bottom)
}
try {
    if ($env:WINBRIDGE_DESKTOP -ne '1' -or $env:WINBRIDGE_INPUT -ne '1') {
        throw 'Desktop input is disabled in the local Claude Desktop configuration.'
    }
    $json = [Text.Encoding]::UTF8.GetString(
        [Convert]::FromBase64String($env:WINBRIDGE_INPUT_REQUEST))
    $request = $json | ConvertFrom-Json
    [void][WinBridgeNative]::SetProcessDPIAware()
    $window = Get-VerifiedWindow

    if ($request.action -eq 'active_window') {
        $result = @{
            app=$window.App; title=$window.Title
            bounds=@{left=$window.Rect.Left;top=$window.Rect.Top;
                     right=$window.Rect.Right;bottom=$window.Rect.Bottom}
        }
        $result | ConvertTo-Json -Depth 4 -Compress
        exit 0
    }

    $details = switch ($request.action) {
      'move' { "Move cursor to ($($request.x), $($request.y))" }
      'click' { "$($request.button) click at ($($request.x), $($request.y))" }
      'type' { "Type $($request.text.Length) characters:\`n" + $request.text.Substring(0,[Math]::Min(300,$request.text.Length)) }
      'hotkey' { "Press $($request.keys)" }
      'scroll' { "Scroll $($request.amount) notches" }
      default { throw 'Unsupported input action.' }
    }
    if ($request.action -in @('move','click') -and -not
        (Test-PointInWindow $window ([int]$request.x) ([int]$request.y))) {
        throw 'Mouse coordinates must be inside the approved foreground window.'
    }
    if ($request.action -eq 'scroll') {
        $cursor = New-Object WinBridgeNative+POINT
        if (-not [WinBridgeNative]::GetCursorPos([ref]$cursor) -or -not
           (Test-PointInWindow $window $cursor.X $cursor.Y)) {
            throw 'Cursor must be inside the approved foreground window to scroll.'
        }
    }
    $message = "App: $($window.App)\`nWindow: $($window.Title)\`n\`n$details\`n\`nApprove this action?"
    $answer = [System.Windows.Forms.MessageBox]::Show(
      $message, 'WinBridge MCP - input approval',
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning,
      [System.Windows.Forms.MessageBoxDefaultButton]::Button2)
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
        throw 'Windows user declined desktop input.'
    }
    $after = Get-VerifiedWindow
    if ($after.Handle -ne $window.Handle -or $after.App -ne $window.App) {
        throw 'The active application changed while approval was requested.'
    }
    if ($request.action -in @('move','click') -and -not
        (Test-PointInWindow $after ([int]$request.x) ([int]$request.y))) {
        throw 'Window moved; input canceled.'
    }
    switch ($request.action) {
      'move' {
        if (-not [WinBridgeNative]::SetCursorPos([int]$request.x,[int]$request.y)) {
            throw 'Windows refused to move the cursor.'
        }
      }
      'click' {
        if (-not [WinBridgeNative]::SetCursorPos([int]$request.x,[int]$request.y)) {
            throw 'Windows refused to position the mouse.'
        }
        [WinBridgeNative]::MouseClick([string]$request.button)
      }
      'type' { [WinBridgeNative]::TypeText([string]$request.text) }
      'hotkey' {
        $hotkey = [string]$request.keys
        if ($hotkey -notin @('ctrl+a','ctrl+c','ctrl+f','ctrl+s','ctrl+v','ctrl+y','ctrl+z')) {
           throw 'Unsupported keyboard shortcut.'
        }
        [WinBridgeNative]::EditorShortcut($hotkey.Substring(5,1))
      }
      'scroll' {
        $amount = [int]$request.amount
        if ($amount -eq 0 -or [Math]::Abs($amount) -gt 10) {
            throw 'Invalid scroll amount.'
        }
        [WinBridgeNative]::MouseScroll($amount)
      }
      default { throw 'Unsupported input action.' }
    }
    @{ status='completed'; action=$request.action; app=$window.App;
       window=$window.Title } | ConvertTo-Json -Compress
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
\`;

export function desktopInput(action,params={},env=process.env) {
  const request=validateDesktopRequest(action,params);
  const status=desktopInputStatus(env);
  if(process.platform!=="win32")throw new Error("Desktop input requires an interactive Windows session.");
  if(!status.desktop_enabled || !status.input_enabled)
    throw new Error("Enable WINBRIDGE_DESKTOP=1 and WINBRIDGE_INPUT=1 in Claude Desktop config.");
  if(!status.allowed_apps.length)
    throw new Error("WINBRIDGE_INPUT_APPS must list at least one approved app.");
  const request64=Buffer.from(JSON.stringify(request),"utf8").toString("base64");
  const child=spawnSync("powershell.exe",[
    "-NoProfile","-NonInteractive","-NoLogo","-Command",WINDOWS_INPUT_SCRIPT
  ],{
    encoding:"utf8",shell:false,windowsHide:true,maxBuffer:200_000,
    env:{...env,WINBRIDGE_INPUT_APPS:status.allowed_apps.join(";"),
      WINBRIDGE_INPUT_REQUEST:request64}
  });
  if(child.error)throw child.error;
  if(child.status!==0)
    throw new Error((child.stderr || "Local desktop action was declined or failed.").trim().slice(0,1200));
  const lines=(child.stdout||"").trim().split(/\r?\n/).filter(Boolean);
  if(!lines.length)throw new Error("No result returned from Windows input helper.");
  return JSON.parse(lines.at(-1));
}
