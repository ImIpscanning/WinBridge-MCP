import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Workspace} from "../src/workspace.mjs";
import {proposeCommand,listProposals,dismissProposal} from "../src/command-requests.mjs";
import {setEmergencyStopped,isEmergencyStopped} from "../src/control-state.mjs";

function fixture(run) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"winbridge-queue-"));
  try {
    const root=path.join(tmp,"project"),control=path.join(tmp,"control");
    fs.mkdirSync(root,{recursive:true});fs.mkdirSync(control,{recursive:true});
    const workspace=new Workspace([root]);
    const env={APPDATA:control,WINBRIDGE_CONTROL_HOME:path.join(control,"WinBridge-MCP")};
    return run({workspace,root,env});
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
}
test("a command proposal goes to review inbox without executing",()=>fixture(({workspace,root,env})=>{
  const marker=path.join(root,"should-not-exist.txt");
  const result=proposeCommand(workspace,{
    name:"build_one",description:"Untrusted proposal",program:"cmd.exe",
    args:["/d","/c","echo hello > should-not-exist.txt"],cwd:"."
  },env);
  assert.equal(result.status,"pending_review");
  assert.equal(fs.existsSync(marker),false);
  const inbox=listProposals(workspace,env);
  assert.equal(inbox.length,1);
  assert.equal(inbox[0].source,"mcp-untrusted");
  assert.equal(inbox[0].name,"build_one");
  dismissProposal(workspace,result.request_id,env);
  assert.equal(listProposals(workspace,env).length,0);
  assert.equal(fs.existsSync(marker),false);
}));
test("queue rejects placement inside a model-writable folder",()=>fixture(({workspace,root,env})=>{
  env.WINBRIDGE_CONTROL_HOME=path.join(root,".control");
  assert.throws(()=>proposeCommand(workspace,{
    name:"build",description:"Test",program:"cmd.exe",args:["/c","ver"],cwd:"."
  },env),/outside|inside an authorized workspace/);
}));
test("proposal metadata requires bounded structured arguments",()=>fixture(({workspace,env})=>{
  assert.throws(()=>proposeCommand(workspace,{
    name:"anything",description:"test",program:"cmd.exe",
    args:"/c echo anything",cwd:"."
  },env),/Arguments/);
  assert.throws(()=>proposeCommand(workspace,{
    name:"bad name!",description:"test",program:"cmd.exe",
    args:[],cwd:"."
  },env),/Name/);
}));
test("the emergency pause is persistent, reversible and separate from workspace",()=>fixture(({workspace,root,env})=>{
  assert.equal(isEmergencyStopped(env),false);
  setEmergencyStopped(true,env);
  assert.equal(isEmergencyStopped(env),true);
  assert.equal(fs.existsSync(path.join(root,"PAUSED")),false);
  setEmergencyStopped(false,env);
  assert.equal(isEmergencyStopped(env),false);
}));
