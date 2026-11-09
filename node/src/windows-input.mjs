/** Local, approval-gated mouse/keyboard input for selected Windows editors.
 *  No remotely reachable listener; untrusted text is sent as JSON in an env
 *  variable, never interpolated into PowerShell source.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
export const WINDOWS_INPUT_SCRIPT = readFileSync(new URL("./windows-input.ps1", import.meta.url), "utf8");

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
