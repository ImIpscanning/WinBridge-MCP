import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const entry=path.resolve(here,"../src/server.mjs");

test("Node MCP server initializes and lists workspace tools over stdio",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"winbridge-mcp-ci-"));
  const child=spawn(process.execPath,[entry],{
    env:{...process.env,WINBRIDGE_ROOTS:root,WINBRIDGE_WRITE:"0",WINBRIDGE_DESKTOP:"0"},
    stdio:["pipe","pipe","pipe"],windowsHide:true
  });
  const received=new Map();
  let stdout="",stderr="";
  const waiters=new Map();
  let timer;
  const awaitId=id=>new Promise((resolve,reject)=>{
    if(received.has(id))return resolve(received.get(id));
    waiters.set(id,{resolve,reject});
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data",data=>{
    stdout+=data;
    let i;
    while((i=stdout.indexOf("\n"))>=0){
      const line=stdout.slice(0,i).trim();
      stdout=stdout.slice(i+1);
      if(!line)continue;
      let obj;
      try{obj=JSON.parse(line);}catch(e){continue;}
      if(obj.id!==undefined){
        received.set(obj.id,obj);
        const w=waiters.get(obj.id);
        if(w){waiters.delete(obj.id);w.resolve(obj);}
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data",data=>{stderr+=data;});
  const send=obj=>child.stdin.write(JSON.stringify(obj)+"\n");
  try{
    const deadline=new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("MCP stdio handshake timeout. "+stderr.slice(0,500))),12000);
    });
    send({jsonrpc:"2.0",id:1,method:"initialize",params:{
      protocolVersion:"2026-07-28",
      capabilities:{},clientInfo:{name:"winbridge-smoke-test",version:"0.1.0"}
    }});
    const init=await Promise.race([awaitId(1),deadline]);
    assert.ok(init.result,JSON.stringify(init));
    send({jsonrpc:"2.0",method:"notifications/initialized"});
    send({jsonrpc:"2.0",id:2,method:"tools/list",params:{}});
    const listed=await Promise.race([awaitId(2),deadline]);
    assert.ok(listed.result,JSON.stringify(listed));
    const names=listed.result.tools.map(tool=>tool.name);
    assert.ok(names.includes("workspace_info"));
    assert.ok(names.includes("terminal_catalog"));
    assert.ok(names.includes("desktop_screenshot"));
    assert.ok(names.includes("restore_file"));
    for (const name of [
      "desktop_input_status", "desktop_active_window", "desktop_move_cursor",
      "desktop_click", "desktop_type_text", "desktop_hotkey", "desktop_scroll"
    ]) assert.ok(names.includes(name), "Missing MCP tool: " + name);
  } finally {
    clearTimeout(timer);
    child.kill();
    try{child.stdin.end();}catch{}
    fs.rmSync(root,{recursive:true,force:true});
  }
});
