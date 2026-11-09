import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Workspace, WorkspaceError } from "../src/workspace.mjs";
import { TerminalManager } from "../src/terminal.mjs";

function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"winbridge-node-test-"));
  try {return fn(new Workspace([root]),root);}
  finally {fs.rmSync(root,{recursive:true,force:true});}
}
test("workspace root and traversal protection",()=>fixture((w,root)=>{
  assert.deepEqual(w.info().roots,[fs.realpathSync(root)]);
  assert.throws(()=>w.resolve("../outside"),WorkspaceError);
  assert.throws(()=>w.resolve(".env"),WorkspaceError);
  assert.throws(()=>w.resolve("credentials.json"),WorkspaceError);
}));
test("creates, reads and replaces scoped text files",()=>fixture((w)=>{
  w.createDirectory("app/src");
  w.write("app/src/hello.txt","hello world\n");
  assert.match(w.read("app/src/hello.txt").content,/hello world/);
  const preview=w.preview("app/src/hello.txt","world","node");
  assert.equal(preview.applied,false);
  assert.match(w.read("app/src/hello.txt").content,/world/);
  w.replace("app/src/hello.txt","world","node");
  assert.match(w.read("app/src/hello.txt").content,/hello node/);
}));
test("trash and restore a file without permanently deleting it",()=>fixture((w)=>{
  w.write("a.txt","recoverable");
  const removed=w.remove("a.txt");
  assert.equal(w.trash().length,1);
  assert.throws(()=>w.read("a.txt"));
  w.restore(removed.restore_id);
  assert.equal(w.trash().length,0);
  assert.match(w.read("a.txt").content,/recoverable/);
}));
test("rejects writes outside writable workspace",()=>fixture((w,root)=>{
  const readOnly=new Workspace([root],false);
  assert.throws(()=>readOnly.write("nope.txt","bad"),WorkspaceError);
  assert.throws(()=>readOnly.createDirectory("nope"),WorkspaceError);
}));
test("text search returns paths and matched line numbers",()=>fixture((w)=>{
  w.write("one.txt","alpha\nneedle\ngamma");
  const x=w.search("needle");
  assert.equal(x.matches[0].line,2);
}));
test("terminal catalog contains fixed PowerShell and CMD tasks with no timeout",()=>fixture((w)=>{
  const t=new TerminalManager(w).catalog();
  assert.ok(t.tasks.includes("powershell_version"));
  assert.ok(t.tasks.includes("cmd_version"));
  assert.equal(t.execution_timeout,null);
  assert.equal(t.arbitrary_shell,false);
  assert.equal(t.manual_stop,true);
}));
test("terminal rejects unsupported command strings",async()=>fixture(async(w)=>{
  const t=new TerminalManager(w);
  await assert.rejects(()=>t.start("cmd.exe /c anything"),WorkspaceError);
}));
