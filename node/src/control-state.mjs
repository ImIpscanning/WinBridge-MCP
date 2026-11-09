/** Shared emergency-pause state, controlled locally by the desktop app. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
export function controlHome(env=process.env) {
  return path.resolve(env.WINBRIDGE_CONTROL_HOME ||
    path.join(env.APPDATA || path.join(os.homedir(),"AppData","Roaming"),"WinBridge-MCP"));
}
export function emergencyFile(env=process.env) {
  return path.join(controlHome(env),"PAUSED");
}
export function isEmergencyStopped(env=process.env) {
  return fs.existsSync(emergencyFile(env));
}
export function setEmergencyStopped(stopped,env=process.env) {
  const file=emergencyFile(env);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if(stopped) {
    fs.writeFileSync(file,JSON.stringify({paused_at:new Date().toISOString(),
      reason:"Paused by WinBridge Control Center"})+"\n",{encoding:"utf8"});
  } else if(fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
  return {paused:isEmergencyStopped(env),
    note:"New MCP actions are paused; existing external jobs may keep running."};
}
