import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ControlService,loadShared} from "../electron/services.mjs";
const here=path.dirname(fileURLToPath(import.meta.url));
const shared=await loadShared(path.resolve(here,"../../node/src"));

function fixture(callback) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"winbridge-gui-test-"));
  const previousFile=process.env.WINBRIDGE_CUSTOM_TASKS_FILE;
  const previousHome=process.env.WINBRIDGE_CONTROL_HOME;
  try {
    const data=path.join(root,"AppData"),workspace=path.join(root,"Projects");
    fs.mkdirSync(path.join(data,"Claude"),{recursive:true});
    fs.mkdirSync(workspace,{recursive:true});
    const config=path.join(data,"Claude","claude_desktop_config.json");
    fs.writeFileSync(config,JSON.stringify({
      mcpServers:{
        other_tool:{command:"other.exe",args:["--test"]},
        "winbridge-node":{command:"node.exe",args:["server.mjs"],
          env:{WINBRIDGE_ROOTS:workspace,WINBRIDGE_WRITE:"1",
            WINBRIDGE_DESKTOP:"1",WINBRIDGE_INPUT:"0",
            WINBRIDGE_INPUT_APPS:"notepad.exe;code.exe"}}
      }
    }));
    const service=new ControlService(shared,{appdata:data});
    return callback({service,workspace,root,data,config});
  } finally {
    if(previousFile===undefined)delete process.env.WINBRIDGE_CUSTOM_TASKS_FILE;
    else process.env.WINBRIDGE_CUSTOM_TASKS_FILE=previousFile;
    if(previousHome===undefined)delete process.env.WINBRIDGE_CONTROL_HOME;
    else process.env.WINBRIDGE_CONTROL_HOME=previousHome;
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test("dashboard distinguishes configured MCP from verified connection",()=>fixture(({service})=>{
  const snap=service.snapshot();
  assert.equal(snap.configured,true);
  assert.match(snap.connection,/not verified/);
  assert.equal(snap.pending_requests,0);
  assert.equal(snap.settings.writes,true);
}));

test("GUI saves explicitly reviewed custom task profiles",()=>fixture(({service})=>{
  const data={name:"build_app",description:"Locally reviewed npm build",
    program:"npm.cmd",args:["run","build"],cwd:"."};
  service.saveTask(data);
  const tasks=service.listTasks();
  assert.equal(tasks.length,1);
  assert.equal(tasks[0].name,"build_app");
  assert.deepEqual(tasks[0].args,["run","build"]);
  const preview=service.previewTask("build_app");
  assert.equal(preview.launched,false);
  assert.equal(preview.execution_timeout,null);
  service.removeTask("build_app");
  assert.equal(service.listTasks().length,0);
}));

test("agent proposal never runs, only appears in review queue",()=>fixture(({service})=>{
  const proposed=shared.requests.proposeCommand(service.workspace,{
    name:"build_app",description:"Proposed build",program:"npm.cmd",
    args:["run","build"],cwd:"."
  },service.runtimeEnv);
  assert.equal(proposed.status,"pending_review");
  assert.equal(service.listTasks().length,0);
  assert.equal(service.listProposals().length,1);
  const item=service.listProposals()[0];
  service.saveProposal(item.id,{name:"build_app",description:"Reviewed build",
    program:"npm.cmd",args:["run","build"],cwd:"."});
  assert.equal(service.listProposals().length,0);
  assert.equal(service.listTasks()[0].name,"build_app");
}));

test("request rejection dismisses without registering command",()=>fixture(({service})=>{
  const req=shared.requests.proposeCommand(service.workspace,{
    name:"test_one",description:"Untrusted proposal",program:"npm.cmd",
    args:["test"],cwd:"."
  },service.runtimeEnv);
  service.dismissProposal(req.request_id);
  assert.equal(service.listProposals().length,0);
  assert.equal(service.listTasks().length,0);
}));

test("local emergency pause persists in separate shared file",()=>fixture(({service})=>{
  assert.equal(service.snapshot().paused,false);
  const paused=service.pause(true);
  assert.equal(paused.paused,true);
  assert.equal(service.snapshot().paused,true);
  assert.throws(()=>service.runTask("build_app"),/pause/);
  service.pause(false);
  assert.equal(service.snapshot().paused,false);
}));

test("saving permission changes preserves other MCP entries",()=>fixture(({service,config,workspace})=>{
  const changed=service.savePermissions({
    roots:workspace,writes:false,desktop:false,input:false,
    apps:"notepad.exe;code.exe"
  });
  assert.equal(changed.restart_claude_required,true);
  const data=JSON.parse(fs.readFileSync(config,"utf8"));
  assert.equal(data.mcpServers.other_tool.command,"other.exe");
  assert.equal(data.mcpServers["winbridge-node"].env.WINBRIDGE_WRITE,"0");
  assert.equal(data.mcpServers["winbridge-node"].env.WINBRIDGE_INPUT,"0");
  assert.equal(service.snapshot().settings.writes,false);
}));

test("rejecting broad home and control center directories",()=>fixture(({service,data})=>{
  assert.throws(()=>service.savePermissions({
    roots:data,writes:true,desktop:true,input:true,apps:"notepad.exe"
  }),/Do not authorize/);
}));

test("import validates task payloads and does not change permissions",()=>fixture(({service,config})=>{
  const settingsBefore=JSON.parse(fs.readFileSync(config,"utf8"));
  const data={schema_version:1,tasks:{version:1,tasks:{
    syntax:{description:"Display version",program:"node.exe",args:["--version"],cwd:"."}
  }}};
  assert.equal(service.importBundle(data).imported,1);
  assert.equal(service.listTasks().length,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(config,"utf8")),settingsBefore);
  assert.throws(()=>service.importBundle({schema_version:99}),/Unsupported/);
}));
