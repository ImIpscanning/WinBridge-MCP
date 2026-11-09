/** Filesystem and local MCP configuration backend. Renderer never sees Node APIs. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

function inside(root,target) {
  const rel=path.relative(root,target);
  return rel==="" || (rel!==".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel));
}
function loadJson(file,fallback={}) {
  if(!fs.existsSync(file))return fallback;
  if(fs.statSync(file).size>2_000_000)throw new Error("Configuration file exceeds 2 MB.");
  return JSON.parse(fs.readFileSync(file,"utf8"));
}
function atomicJson(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=file+".tmp-"+randomUUID();
  try {
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+"\n",{encoding:"utf8",flag:"wx"});
    if(fs.existsSync(file)) fs.copyFileSync(file,file+".winbridge-backup");
    fs.renameSync(temp,file);
  } finally {try{fs.unlinkSync(temp);}catch{}}
}
function required(value,name,max=300) {
  if(typeof value!=="string" || !value.trim() || value.length>max ||
    /[\u0000-\u001F\u007F]/.test(value))
    throw new Error("Invalid "+name+".");
  return value.trim();
}
function toBool(value) {return value===true || value==="1";}
export async function loadShared(root) {
  const file=name=>pathToFileURL(path.resolve(root,name)).href;
  const [core,terminal,tasks,requests,emergency,windows] = await Promise.all([
    import(file("workspace.mjs")),import(file("terminal.mjs")),
    import(file("custom-tasks.mjs")),import(file("command-requests.mjs")),
    import(file("control-state.mjs")),import(file("windows.mjs"))
  ]);
  return {core,terminal,tasks,requests,emergency,windows};
}

export class ControlService {
  constructor(shared, options={}) {
    this.shared=shared;
    this.env=options.env || process.env;
    this.appdata=path.resolve(options.appdata || this.env.APPDATA ||
      path.join(os.homedir(),"AppData","Roaming"));
    this.dataDir=path.join(this.appdata,"WinBridge-MCP");
    this.configFile=path.join(this.appdata,"Claude","claude_desktop_config.json");
    this.tasksFile=path.join(this.dataDir,"custom-tasks.json");
    fs.mkdirSync(this.dataDir,{recursive:true});
    if(!fs.existsSync(this.tasksFile))atomicJson(this.tasksFile,{version:1,tasks:{}});
    // Use exactly the same user-owned configuration and emergency state as MCP.
    this.runtimeEnv={...this.env,APPDATA:this.appdata,
      WINBRIDGE_CONTROL_HOME:this.dataDir,WINBRIDGE_CUSTOM_TASKS_FILE:this.tasksFile};
    // TerminalManager currently reads from process.env; use consistent paths here.
    process.env.WINBRIDGE_CONTROL_HOME=this.dataDir;
    process.env.WINBRIDGE_CUSTOM_TASKS_FILE=this.tasksFile;
    this.refreshWorkspace();
  }
  readClaude() {
    const conf=loadJson(this.configFile,{mcpServers:{}});
    if(!conf || typeof conf!=="object" || Array.isArray(conf))throw new Error("Invalid Claude Desktop JSON.");
    return conf;
  }
  currentMcp() {
    const conf=this.readClaude();
    const entry=conf.mcpServers?.["winbridge-node"];
    return entry && typeof entry==="object"?entry:null;
  }
  settings() {
    const env=this.currentMcp()?.env || {};
    const fallback=path.join(os.homedir(),"Documents","WinBridgeWorkspace");
    return {
      roots:env.WINBRIDGE_ROOTS || fallback,
      writes:env.WINBRIDGE_WRITE!=="0",
      desktop:env.WINBRIDGE_DESKTOP==="1",
      input:env.WINBRIDGE_INPUT==="1",
      apps:env.WINBRIDGE_INPUT_APPS || "notepad.exe;code.exe"
    };
  }
  refreshWorkspace() {
    const settings=this.settings();
    const raw=settings.roots.split(path.delimiter).map(s=>s.trim()).filter(Boolean);
    // A newly installed GUI should still show its own default workspace.
    const root=path.join(os.homedir(),"Documents","WinBridgeWorkspace");
    if(!raw.length)raw.push(root);
    if(!fs.existsSync(raw[0]) && raw.length===1 && path.resolve(raw[0])===path.resolve(root))
      fs.mkdirSync(root,{recursive:true});
    this.workspace=new this.shared.core.Workspace(raw,settings.writes);
    this.terminal=new this.shared.terminal.TerminalManager(this.workspace);
  }
  validateTask(data) {
    if(!data || typeof data!=="object")throw new Error("Missing task.");
    const name=required(data.name,"task name",64);
    if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(name))throw new Error("Invalid task name.");
    const description=required(data.description,"description",250);
    const program=required(data.program,"executable",300);
    if(!Array.isArray(data.args)||data.args.length>32||
       data.args.some(a=>typeof a!=="string"||a.length>500||
           /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(a)))
      throw new Error("Arguments must be an array of strings.");
    const cwd=required(data.cwd||".","working directory",4096);
    const dir=this.workspace.resolve(cwd,true);
    if(!fs.statSync(dir).isDirectory())throw new Error("Task working folder does not exist.");
    if([program,...data.args].join(" ").length>750)
      throw new Error("Command exceeds the local approval preview length.");
    return {name,description,program,args:data.args.slice(),cwd};
  }
  listTasks() {
    return Object.values(this.shared.tasks.readCustomTasks(this.workspace,this.runtimeEnv))
      .map(x=>({name:x.name,description:x.description,
        program:x.argv[0],args:x.argv.slice(1),cwd:x.cwd}));
  }
  saveTask(data) {
    const parsed=this.validateTask(data);
    const doc=loadJson(this.tasksFile,{version:1,tasks:{}});
    if(doc.version!==1 || !doc.tasks || typeof doc.tasks!=="object")throw new Error("Invalid local task config.");
    doc.tasks[parsed.name]={
      description:parsed.description,program:parsed.program,
      args:parsed.args,cwd:parsed.cwd
    };
    atomicJson(this.tasksFile,doc);
    return {saved:parsed.name};
  }
  removeTask(name) {
    name=required(name,"task name",64);
    const doc=loadJson(this.tasksFile,{version:1,tasks:{}});
    if(doc.tasks) delete doc.tasks[name];
    atomicJson(this.tasksFile,doc);
    return {removed:name};
  }
  listProposals() {
    return this.shared.requests.listProposals(this.workspace,this.runtimeEnv);
  }
  saveProposal(id,edited) {
    const p=this.listProposals().find(x=>x.id===id);
    if(!p)throw new Error("Proposal not found. It may have been dismissed.");
    // This method is called ONLY from GUI IPC following a human button click.
    const task=this.validateTask(edited);
    this.saveTask(task);
    this.shared.requests.dismissProposal(this.workspace,id,this.runtimeEnv);
    return {saved:task.name,request_id:id};
  }
  dismissProposal(id) {
    return this.shared.requests.dismissProposal(this.workspace,id,this.runtimeEnv);
  }
  savePermissions(settings) {
    if(!settings || typeof settings!=="object")throw new Error("Missing settings.");
    const paths=required(settings.roots,"workspace roots",8000).split(path.delimiter).map(x=>x.trim()).filter(Boolean);
    if(!paths.length||paths.length>12)throw new Error("Choose 1 to 12 workspace folders.");
    const verified=paths.map(p=>{
      const real=fs.realpathSync(path.resolve(p));
      if(!fs.statSync(real).isDirectory())throw new Error("Workspace is not a directory.");
      const home=fs.realpathSync(os.homedir());
      const systemRoot=path.parse(real).root;
      if(real===home || real===systemRoot || inside(real,this.dataDir) || inside(real,path.dirname(this.configFile)))
        throw new Error("Do not authorize home folders, drives or the Control Center configuration.");
      return real;
    });
    const apps=required(settings.apps,"approved apps",1000).split(";").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(!apps.length||apps.length>20||apps.some(a=>!/^[a-z0-9_.-]+\.exe$/i.test(a)))
      throw new Error("Specify up to 20 Windows executable names, separated by semicolons.");
    const conf=this.readClaude();
    if(!conf.mcpServers || typeof conf.mcpServers!=="object")conf.mcpServers={};
    const old=conf.mcpServers["winbridge-node"];
    if(!old)throw new Error("Install WinBridge Node in Claude Desktop first.");
    conf.mcpServers["winbridge-node"]={...old,env:{
      ...(old.env||{}),
      WINBRIDGE_ROOTS:verified.join(path.delimiter),
      WINBRIDGE_WRITE:toBool(settings.writes)?"1":"0",
      WINBRIDGE_DESKTOP:toBool(settings.desktop)?"1":"0",
      WINBRIDGE_INPUT:toBool(settings.input)?"1":"0",
      WINBRIDGE_INPUT_APPS:apps.join(";"),
      WINBRIDGE_CUSTOM_TASKS_FILE:this.tasksFile,
      WINBRIDGE_CONTROL_HOME:this.dataDir
    }};
    atomicJson(this.configFile,conf);
    this.refreshWorkspace();
    return {saved:true,restart_claude_required:true};
  }
  snapshot() {
    const mcp=this.currentMcp();
    const queued=this.listProposals();
    const catalog=this.terminal.catalog();
    return {
      app_version:"0.1.0",
      configured:!!mcp,
      connection:"Configured in Claude Desktop; live connection not verified",
      settings:this.settings(),
      roots:this.workspace.roots,
      paused:this.shared.emergency.isEmergencyStopped(this.runtimeEnv),
      pending_requests:queued.length,
      custom_tasks:this.listTasks(),
      built_in_tasks:catalog.tasks,
      data_dir:this.dataDir,
      config_file:this.configFile,
      requests_path:this.shared.requests.queueDirectory(this.runtimeEnv),
      task_file:this.tasksFile,
      platform:process.platform,
      node_version:process.versions.node
    };
  }
  activity(limit=100) {
    const entries=[];
    for(const root of this.workspace.roots){
      const file=path.join(root,".winbridge_audit.jsonl");
      if(!fs.existsSync(file))continue;
      const size=fs.statSync(file).size;
      if(size>4_000_000){ /* tail of large logs only */ }
      const text=fs.readFileSync(file,"utf8");
      for(const line of text.trim().split(/\r?\n/).slice(-limit)){
        try{const entry=JSON.parse(line);entries.push({...entry,workspace:root});}catch{}
      }
    }
    return entries.sort((a,b)=>(b.at||"").localeCompare(a.at||"")).slice(0,limit);
  }
  listDirectory(p="."){return this.workspace.list(p,150);}
  readFile(p){return this.workspace.read(p,1,300);}
  listTrash(){return this.workspace.trash(0);}
  restore(id){return this.workspace.restore(id,0);}
  pause(v){return this.shared.emergency.setEmergencyStopped(!!v,this.runtimeEnv);}
  previewTask(name){return this.terminal.previewCustom(name);}
  runTask(name){
    if(this.shared.emergency.isEmergencyStopped(this.runtimeEnv))throw new Error("Emergency pause is active.");
    return this.terminal.startCustom(name);
  }
  taskStatus(id){return this.terminal.status(id);}
  stopTask(id){return this.terminal.stop(id);}
  exportBundle(){
    return {schema_version:1,exported_at:new Date().toISOString(),
      settings:this.settings(),
      tasks:loadJson(this.tasksFile,{version:1,tasks:{}})};
  }
  importBundle(bundle){
    if(!bundle || bundle.schema_version!==1 || !bundle.tasks || bundle.tasks.version!==1 ||
       !bundle.tasks.tasks || typeof bundle.tasks.tasks!=="object" || Array.isArray(bundle.tasks.tasks))
       throw new Error("Unsupported backup format.");
    const normalized={version:1,tasks:{}};
    for(const [name,task] of Object.entries(bundle.tasks.tasks)){
      const parsed=this.validateTask({name,...task});
      normalized.tasks[name]={
        description:parsed.description,program:parsed.program,args:parsed.args,cwd:parsed.cwd
      };
    }
    atomicJson(this.tasksFile,normalized);
    return {imported:Object.keys(normalized.tasks).length,
      note:"Only user task profiles imported. Permission settings remain unchanged."};
  }
}
