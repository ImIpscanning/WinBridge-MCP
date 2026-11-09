/**
 * Custom terminal task profiles, edited locally by the Windows user.
 *
 * A model may request a profile by name but cannot provide arbitrary command
 * strings, executable paths, or script contents through this API.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkspaceError } from "./workspace.mjs";

const NAME_PATTERN=/^[a-z][a-z0-9_-]{0,63}$/i;

export function customTasksPath(env=process.env) {
  if (env.WINBRIDGE_CUSTOM_TASKS_FILE) return path.resolve(env.WINBRIDGE_CUSTOM_TASKS_FILE);
  const appdata=env.APPDATA || path.join(os.homedir(),"AppData","Roaming");
  return path.join(appdata,"WinBridge-MCP","custom-tasks.json");
}
export function readCustomTasks(workspace, env=process.env) {
  const configPath=customTasksPath(env);
  // Resolve the parent even if the config does not yet exist, disallowing a
  // user task file that Claude can write through a configured workspace.
  const parent=path.dirname(configPath);
  if (fs.existsSync(parent)) {
    const realParent=fs.realpathSync(parent);
    const target=path.join(realParent,path.basename(configPath));
    if (workspace.roots.some(root=>{
      const rel=path.relative(root,target);
      return rel==="" || (rel!==".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel));
    })) throw new WorkspaceError("Custom task configuration must be outside writable project roots.");
  }
  if(!fs.existsSync(configPath)) return {};
  const realFile=fs.realpathSync(configPath);
  if (workspace.roots.some(root=>{
    const rel=path.relative(root,realFile);
    return rel==="" || (rel!==".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel));
  })) throw new WorkspaceError("Custom task config cannot be a symlink into a workspace.");
  const file=fs.statSync(configPath);
  if(!file.isFile() || file.size>40_000) throw new WorkspaceError("Invalid custom tasks configuration.");
  let parsed;
  try{parsed=JSON.parse(fs.readFileSync(configPath,"utf8"));}
  catch{throw new WorkspaceError("Custom tasks config must be valid JSON.");}
  if(!parsed || parsed.version!==1 || !parsed.tasks || Array.isArray(parsed.tasks) || typeof parsed.tasks!=="object")
    throw new WorkspaceError("Custom task config must contain version=1 and a tasks object.");
  const tasks=Object.create(null);
  for(const [name,entry] of Object.entries(parsed.tasks)){
    if(!NAME_PATTERN.test(name)) throw new WorkspaceError("Invalid custom task name.");
    if(!entry || typeof entry!=="object" || Array.isArray(entry)) throw new WorkspaceError("Invalid task: "+name);
    if(typeof entry.program!=="string" || !entry.program.trim() || entry.program.length>300)
      throw new WorkspaceError("Invalid program for: "+name);
    if(!Array.isArray(entry.args) || entry.args.length>32 || entry.args.some(s=>typeof s!=="string" || s.length>500))
      throw new WorkspaceError("Invalid argument vector for: "+name);
    if(typeof entry.cwd!=="string" || !entry.cwd.trim() || entry.cwd.length>4096)
      throw new WorkspaceError("Invalid working directory for: "+name);
    if(typeof entry.description!=="string" || entry.description.length>250)
      throw new WorkspaceError("Invalid description for: "+name);
    const cwd=workspace.resolve(entry.cwd,true);
    if(!fs.statSync(cwd).isDirectory())throw new WorkspaceError("Task cwd must be a project directory.");
    const argv=[entry.program,...entry.args];
    if(argv.join(" ").length>750) throw new WorkspaceError("Custom command too long to show in local approval.");
    tasks[name]={name,description:entry.description,argv,cwd};
  }
  return tasks;
}
