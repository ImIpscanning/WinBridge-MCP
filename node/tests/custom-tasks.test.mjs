import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace, WorkspaceError } from "../src/workspace.mjs";
import { customTasksPath, readCustomTasks } from "../src/custom-tasks.mjs";

function withFixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"winbridge-custom-test-"));
  try {
    const workspaceRoot=path.join(root,"workspace");
    const privateDir=path.join(root,"settings");
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(privateDir);
    const workspace=new Workspace([workspaceRoot]);
    const config=path.join(privateDir,"custom-tasks.json");
    const env={WINBRIDGE_CUSTOM_TASKS_FILE:config};
    const save=tasks=>fs.writeFileSync(config,JSON.stringify({version:1,tasks}),"utf8");
    return run({root,workspace,config,env,save});
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test("loads user-owned named PowerShell/CMD profiles outside the workspace",()=>withFixture(({workspace,env,save})=>{
  save({
    build_ps:{description:"PowerShell build",program:"powershell.exe",
      args:["-NoProfile","-File","C:\\Trusted\\build.ps1"],cwd:"."},
    list_cmd:{description:"CMD listing",program:"cmd.exe",
      args:["/d","/c","dir"],cwd:"."}
  });
  const tasks=readCustomTasks(workspace,env);
  assert.deepEqual(Object.keys(tasks).sort(),["build_ps","list_cmd"]);
  assert.deepEqual(tasks.build_ps.argv,["powershell.exe","-NoProfile","-File","C:\\Trusted\\build.ps1"]);
  assert.equal(tasks.build_ps.cwd,workspace.roots[0]);
  assert.equal(customTasksPath(env),env.WINBRIDGE_CUSTOM_TASKS_FILE);
}));

test("models cannot use a task config placed within a writable project",()=>withFixture(({workspace,save})=>{
  const untrusted=path.join(workspace.roots[0],"custom-tasks.json");
  fs.writeFileSync(untrusted,JSON.stringify({version:1,tasks:{}}));
  assert.throws(
    ()=>readCustomTasks(workspace,{WINBRIDGE_CUSTOM_TASKS_FILE:untrusted}),
    WorkspaceError
  );
}));

test("missing profile file results in no custom tools, not arbitrary shell fallback",()=>withFixture(({workspace,env})=>{
  assert.deepEqual(Object.keys(readCustomTasks(workspace,env)),[]);
}));

test("malformed configuration fails closed",()=>withFixture(({workspace,env,config,save})=>{
  fs.writeFileSync(config,"not valid json");
  assert.throws(()=>readCustomTasks(workspace,env),/valid JSON/);
  save({bad:{description:"Bad",program:"cmd.exe",args:"/c dir",cwd:"."}});
  assert.throws(()=>readCustomTasks(workspace,env),/argument vector/);
  save({"bad command":{description:"Bad",program:"cmd.exe",args:[],cwd:"."}});
  assert.throws(()=>readCustomTasks(workspace,env),/task name/);
}));

test("profiles may not choose an unauthorized working directory",()=>withFixture(({workspace,env,root,save})=>{
  save({bad:{description:"outside",program:"cmd.exe",args:["/d","/c","ver"],cwd:root}});
  assert.throws(()=>readCustomTasks(workspace,env),WorkspaceError);
}));

test("symlink from private settings into workspace is refused",{
  skip:process.platform==="win32" ? "Windows user may lack symlink privileges" : false
},()=>withFixture(({workspace,env,config})=>{
  const target=path.join(workspace.roots[0],"task.json");
  fs.writeFileSync(target,JSON.stringify({version:1,tasks:{}}));
  fs.symlinkSync(target,config);
  assert.throws(()=>readCustomTasks(workspace,env),WorkspaceError);
}));

test("normal task profiles do not silently accept arbitrary command strings",()=>withFixture(({workspace,env,save})=>{
  save({build:{description:"Build",program:"npm.cmd",args:["run","build"],cwd:"."}});
  const all=readCustomTasks(workspace,env);
  assert.ok(Object.hasOwn(all,"build"));
  assert.ok(!Object.hasOwn(all,"powershell -Command arbitrary"));
}));
