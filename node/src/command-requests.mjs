/** An MCP request is only a proposal. No agent-submitted command executes. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { controlHome } from "./control-state.mjs";
import { WorkspaceError } from "./workspace.mjs";
const MAX_FILES=150;
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function within(root,file) {
  const rel=path.relative(root,file);
  return rel==="" || (rel!==".." && !rel.startsWith(".."+path.sep) && !path.isAbsolute(rel));
}
export function queueDirectory(env=process.env) {
  return path.join(controlHome(env),"requests");
}
function checkedDir(workspace,env,create=false) {
  const dir=queueDirectory(env);
  if(create)fs.mkdirSync(dir,{recursive:true});
  if(!fs.existsSync(dir))return dir;
  const real=fs.realpathSync(dir);
  if(workspace?.roots?.some(root=>within(root,real)))
    throw new WorkspaceError("Request queue must not be inside an authorized workspace.");
  return dir;
}
function clean(input,max,name) {
  if(typeof input!=="string" || !input.trim() || input.length>max ||
     /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(input))
    throw new WorkspaceError("Invalid "+name+".");
  return input.trim();
}
export function validateProposal(p,workspace) {
  if(!p || typeof p!=="object" || Array.isArray(p))
    throw new WorkspaceError("Expected a structured command proposal.");
  const name=clean(p.name,64,"name");
  if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(name))
    throw new WorkspaceError("Name must use letters, digits, hyphens or underscores.");
  const description=clean(p.description,300,"description");
  const program=clean(p.program,300,"program");
  if(!Array.isArray(p.args) || p.args.length>24 ||
    p.args.some(arg=>typeof arg!=="string" || arg.length>700 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(arg)))
    throw new WorkspaceError("Arguments must be a string array (max 24 items).");
  const cwd=workspace.resolve(clean(p.cwd||".",4096,"working directory"),true);
  if(!fs.statSync(cwd).isDirectory())
    throw new WorkspaceError("Working directory is not a project folder.");
  return {name,description,program,args:[...p.args],cwd};
}
export function proposeCommand(workspace,p,env=process.env) {
  const payload=validateProposal(p,workspace);
  const dir=checkedDir(workspace,env,true);
  if(fs.readdirSync(dir).filter(x=>x.endsWith(".json")).length>=MAX_FILES)
    throw new WorkspaceError("Review or dismiss pending proposals before adding more.");
  const id=randomUUID(),created_at=new Date().toISOString();
  const proposal={id,created_at,status:"pending",source:"mcp-untrusted",...payload};
  fs.writeFileSync(path.join(dir,id+".json"),JSON.stringify(proposal,null,2),
    {encoding:"utf8",flag:"wx"});
  return {request_id:id,status:"pending_review",name:payload.name,
    message:"Sent to Control Center. Not executed or saved as a trusted task."};
}
export function listProposals(workspace,env=process.env) {
  const dir=checkedDir(workspace,env);
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).filter(x=>x.endsWith(".json") && ID.test(x.slice(0,-5)))
    .slice(-MAX_FILES).flatMap(name=>{
      const file=path.join(dir,name);
      try {
        if(fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size>10000)return [];
        const p=JSON.parse(fs.readFileSync(file,"utf8"));
        if(p.id!==name.slice(0,-5))return [];
        return [p];
      } catch{return [];}
    }).sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
export function dismissProposal(workspace,id,env=process.env) {
  if(!ID.test(id))throw new WorkspaceError("Invalid request ID.");
  const dir=checkedDir(workspace,env);
  const file=path.join(dir,id+".json");
  if(fs.existsSync(file) && fs.lstatSync(file).isFile())fs.unlinkSync(file);
  return {id,dismissed:true};
}
