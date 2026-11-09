import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceError } from "./workspace.mjs";
import { localApprove, windowsOnly } from "./windows.mjs";
import { readCustomTasks } from "./custom-tasks.mjs";

const OUTPUT_LIMIT=20_000, ACTIVE_LIMIT=4;
const TASKS=Object.freeze({
  powershell_version:["powershell.exe","-NoProfile","-NonInteractive","-NoLogo","-Command","$PSVersionTable.PSVersion.ToString()"],
  powershell_processes:["powershell.exe","-NoProfile","-NonInteractive","-NoLogo","-Command","Get-Process | Sort-Object ProcessName | Select-Object -First 40 ProcessName,Id | Format-Table -AutoSize"],
  powershell_services:["powershell.exe","-NoProfile","-NonInteractive","-NoLogo","-Command","Get-Service | Sort-Object Name | Select-Object -First 40 Name,Status | Format-Table -AutoSize"],
  cmd_version:["cmd.exe","/d","/c","ver"],
  cmd_directory:["cmd.exe","/d","/c","dir"],
  cmd_where_python:["cmd.exe","/d","/c","where python"],
  git_status:["git","-c","core.fsmonitor=false","status","--short"],
  git_log:["git","-c","core.fsmonitor=false","log","-5","--oneline"],
  git_diff:["git","-c","core.fsmonitor=false","--no-pager","diff","--no-ext-diff","--"],
  node_version:[process.execPath,"--version"]
});
export class TerminalManager {
  constructor(workspace) {this.workspace=workspace;this.jobs=new Map();}
  catalog() {
    const custom=readCustomTasks(this.workspace);
    return {
      tasks:Object.keys(TASKS),
      custom_tasks:Object.values(custom).map(task=>({name:task.name,description:task.description})),
      execution_timeout:null,
      manual_stop:true,
      local_approval:true,
      arbitrary_shell:false,
      note:"Custom commands must be configured locally outside the MCP workspace."
    };
  }
  async start(name,cwd=".") {
    if(!Object.hasOwn(TASKS,name))throw new WorkspaceError("Unsupported terminal task: use terminal_catalog.");
    return this._start(name,TASKS[name],cwd);
  }
  async startCustom(name) {
    const custom=readCustomTasks(this.workspace);
    if(!Object.hasOwn(custom,name))throw new WorkspaceError("Unknown custom task. Configure it locally first.");
    const task=custom[name];
    return this._start("custom:"+name,task.argv,task.cwd);
  }
  async _start(name,args,cwd) {
    windowsOnly();
    const dir=this.workspace.resolve(cwd,true);
    if(!fs.statSync(dir).isDirectory())throw new WorkspaceError("Working directory must exist.");
    const active=[...this.jobs.values()].filter(t=>t.status==="running").length;
    if(active>=ACTIVE_LIMIT)throw new WorkspaceError("Four running tasks is the maximum.");
    const command=args.join(" ");
    const message="Start the following task?\n\nTask: "+name+
      "\nCommand: "+command+"\nWorkspace: "+dir+
      "\n\nNo execution timeout; use terminal_stop to cancel.";
    // The local dialog helper clips its text; reject any task that would be
    // truncated so the user always sees every executable argument.
    if(message.length>850)throw new WorkspaceError("Command display exceeds local approval dialog limit.");
    localApprove(message);
    const job={id:randomUUID(),name,cwd:dir,started_at:new Date().toISOString(),status:"running",exit_code:null,output:"",truncated:false};
    this.jobs.set(job.id,job);
    const child=spawn(args[0],args.slice(1),{cwd:dir,windowsHide:true,shell:false,stdio:["ignore","pipe","pipe"]});
    job.child=child;
    function collect(chunk) {
      const text=chunk.toString("utf8");
      job.output+=text;
      if(job.output.length>OUTPUT_LIMIT){job.output=job.output.slice(-OUTPUT_LIMIT);job.truncated=true;}
    }
    child.stdout.on("data",collect);
    child.stderr.on("data",collect);
    child.on("error",err=>{collect(Buffer.from(String(err)));job.status="error";});
    child.on("close",code=>{job.status="finished";job.exit_code=code;});
    this.workspace.audit("terminal_start:"+name,dir);
    return {task_id:job.id,status:job.status,task:name,timeout_seconds:null};
  }
  status(id) {
    const job=this.jobs.get(id);
    if(!job)throw new WorkspaceError("Unknown terminal task ID.");
    const {child,...data}=job;
    return data;
  }
  stop(id) {
    const job=this.jobs.get(id);
    if(!job)throw new WorkspaceError("Unknown terminal task ID.");
    if(job.status!=="running")return {task_id:id,status:job.status};
    job.child.kill();
    this.workspace.audit("terminal_stop:"+job.name,path.resolve(job.cwd));
    return {task_id:id,status:"stop_requested"};
  }
}
