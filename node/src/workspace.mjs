import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export class WorkspaceError extends Error {}
const LIMIT = 1_000_000;
const SKIP = new Set([".git", ".venv", "node_modules", "__pycache__", ".winbridge_trash"]);
const BLOCK = new Set([".env", ".ssh", ".aws", ".gnupg", ".git", ".winbridge_trash", ".winbridge_audit.jsonl", "credentials.json", "secrets.json", "id_rsa", "id_ed25519"]);
function sensitive(part) {
  const s = part.toLowerCase();
  return BLOCK.has(s) || /^\.env\./.test(s) || /^credentials\./.test(s) || /^secrets\./.test(s) || /\.(pem|p12|pfx|key|kdbx)$/i.test(s);
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}
function assertText(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > LIMIT) {
    throw new WorkspaceError("Text must be UTF-8 and at most 1 MB.");
  }
}
function readSmall(p) {
  if (!fs.statSync(p).isFile() || fs.statSync(p).size > LIMIT) throw new WorkspaceError("Text file must be <= 1 MB.");
  const data = fs.readFileSync(p);
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (decoded.includes("\0")) throw new WorkspaceError("Binary data is not allowed.");
  return decoded;
}
export class Workspace {
  constructor(roots, writable = true) {
    if (!roots?.length) throw new WorkspaceError("No workspace roots configured.");
    this.roots = roots.map(r => fs.realpathSync(path.resolve(r)));
    for (const root of this.roots) if (!fs.statSync(root).isDirectory()) throw new WorkspaceError("Invalid root.");
    this.writable = writable;
  }
  static fromEnv() {
    const env = process.env.WINBRIDGE_ROOTS;
    const fallback = path.join(os.homedir(), "Documents", "WinBridgeWorkspace");
    if (!env) fs.mkdirSync(fallback, { recursive: true });
    return new Workspace(env ? env.split(path.delimiter).map(s => s.trim()).filter(Boolean) : [fallback], process.env.WINBRIDGE_WRITE !== "0");
  }
  rootOf(target) {
    const root = this.roots.find(r => inside(r, target));
    if (!root) throw new WorkspaceError("Path is outside authorized workspace roots.");
    return root;
  }
  resolve(input, allowRoot = false) {
    if (typeof input !== "string" || !input.trim()) throw new WorkspaceError("Nonempty path required.");
    let proposed = path.resolve(path.isAbsolute(input) ? input : path.join(this.roots[0], input));
    const rawRoot = this.rootOf(proposed);
    // Check each ancestor as resolved by the OS, including symlinks and junctions.
    let ancestor = proposed;
    const missing = [];
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (ancestor === parent) throw new WorkspaceError("Path cannot be resolved.");
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
    let resolved = path.join(fs.realpathSync(ancestor), ...missing);
    const root = this.rootOf(resolved);
    if (root !== rawRoot) throw new WorkspaceError("Path escapes its configured root.");
    if (!allowRoot && resolved === root) throw new WorkspaceError("Choose an item inside the workspace.");
    const segments = path.relative(root, resolved).split(path.sep).filter(Boolean);
    if (segments.some(sensitive)) throw new WorkspaceError("Sensitive/internal paths are unavailable.");
    return resolved;
  }
  writeRequired() { if (!this.writable) throw new WorkspaceError("WINBRIDGE_WRITE is disabled."); }
  info() { return { roots:this.roots, writes_enabled:this.writable, max_text_bytes:LIMIT }; }
  audit(action, target) {
    try {
      const root=this.rootOf(target);
      fs.appendFileSync(path.join(root,".winbridge_audit.jsonl"), JSON.stringify({at:new Date().toISOString(), action, path:target})+"\n");
    } catch { /* best effort */ }
  }
  list(input=".", limit=100) {
    const dir=this.resolve(input,true);
    if (!fs.statSync(dir).isDirectory()) throw new WorkspaceError("Directory not found.");
    const entries=[];
    for (const d of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (sensitive(d.name)) continue;
      try {
        const p=this.resolve(path.join(dir,d.name));
        entries.push({name:d.name,path:p,type:fs.statSync(p).isDirectory()?"directory":"file"});
      } catch { /* skip disallowed links */ }
      if(entries.length>=Math.max(1,Math.min(200,limit)))break;
    }
    return {directory:dir,entries};
  }
  read(input,start=1,count=300) {
    const p=this.resolve(input), lines=readSmall(p).split(/\r?\n/);
    const from=Math.max(1,start), to=Math.min(lines.length,from+Math.min(1000,Math.max(1,count))-1);
    return {path:p,lines_total:lines.length,content:lines.slice(from-1,to).map((t,i)=>`${i+from}: ${t}`).join("\n")};
  }
  createDirectory(input) {
    this.writeRequired();
    const p=this.resolve(input);
    fs.mkdirSync(p,{recursive:true});
    this.audit("create_directory",p);
    return {created:p};
  }
  write(input,text,overwrite=false) {
    this.writeRequired();assertText(text);
    const p=this.resolve(input);
    if(fs.existsSync(p) && (!fs.statSync(p).isFile() || !overwrite)) throw new WorkspaceError("File exists; overwrite not authorized.");
    fs.mkdirSync(path.dirname(p),{recursive:true});
    const tmp=path.join(path.dirname(p),".winbridge-tmp-"+crypto.randomUUID());
    try {
      fs.writeFileSync(tmp,text,{encoding:"utf8",flag:"wx"});
      if(!overwrite && fs.existsSync(p))throw new WorkspaceError("File exists.");
      fs.renameSync(tmp,p);
    } finally {if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
    this.audit("write_file",p);
    return {path:p,bytes:Buffer.byteLength(text,"utf8")};
  }
  preview(input,oldText,newText) {
    if(!oldText)throw new WorkspaceError("oldText must not be empty.");
    const p=this.resolve(input), source=readSmall(p), parts=source.split(oldText);
    if(parts.length!==2)throw new WorkspaceError("oldText must occur exactly once.");
    const target=parts.join(newText);assertText(target);
    return {path:p,preview: { before:source.slice(0,6000), after:target.slice(0,6000) }, applied:false};
  }
  replace(input,oldText,newText) {
    this.writeRequired();
    const p=this.resolve(input), source=readSmall(p);
    if(!oldText || source.split(oldText).length!==2)throw new WorkspaceError("oldText must occur once.");
    return this.write(p,source.replace(oldText,newText),true);
  }
  move(from,to) {
    this.writeRequired();
    const a=this.resolve(from), b=this.resolve(to);
    if(!fs.statSync(a).isFile() || fs.existsSync(b))throw new WorkspaceError("Source must be a file and target must not exist.");
    fs.mkdirSync(path.dirname(b),{recursive:true});
    fs.renameSync(a,b);this.audit("move_file",b);return {from:a,to:b};
  }
  remove(input) {
    this.writeRequired();
    const p=this.resolve(input);
    if(!fs.statSync(p).isFile() || fs.lstatSync(p).isSymbolicLink())throw new WorkspaceError("Only regular files may be trashed.");
    const trash=path.join(this.rootOf(p),".winbridge_trash");
    fs.mkdirSync(trash,{recursive:true});
    const id=crypto.randomUUID().replaceAll("-","");
    fs.renameSync(p,path.join(trash,id+".file"));
    fs.writeFileSync(path.join(trash,id+".json"),JSON.stringify({original:p}),{flag:"wx"});
    this.audit("delete_file_to_trash",p);
    return {restore_id:id,path:p};
  }
  trash(index=0) {
    const root=this.roots[index];if(!root)throw new WorkspaceError("Invalid workspace index.");
    const dir=path.join(root,".winbridge_trash");if(!fs.existsSync(dir))return [];
    return fs.readdirSync(dir).filter(n=>/^[a-f0-9]{32}\.json$/.test(n)).slice(0,100).flatMap(n=>{
      try {
        const id=n.slice(0,32), meta=JSON.parse(fs.readFileSync(path.join(dir,n),"utf8"));
        if(!fs.existsSync(path.join(dir,id+".file")))return [];
        const original=this.resolve(meta.original);
        return [{restore_id:id,original}];
      } catch {return [];}
    });
  }
  restore(id,index=0) {
    this.writeRequired();
    if(!/^[a-f0-9]{32}$/.test(id))throw new WorkspaceError("Invalid restore ID.");
    const root=this.roots[index];if(!root)throw new WorkspaceError("Invalid workspace index.");
    const dir=path.join(root,".winbridge_trash");
    const src=path.join(dir,id+".file"),meta=path.join(dir,id+".json");
    if(!fs.existsSync(src)||!fs.existsSync(meta))throw new WorkspaceError("Restore item not found.");
    const original=this.resolve(JSON.parse(fs.readFileSync(meta,"utf8")).original);
    if(fs.existsSync(original))throw new WorkspaceError("Restore path already exists.");
    fs.mkdirSync(path.dirname(original),{recursive:true});
    fs.renameSync(src,original);fs.unlinkSync(meta);this.audit("restore_file",original);
    return {restored:original};
  }
  search(query,limit=30) {
    if(typeof query!=="string" || !query || query.length>200)throw new WorkspaceError("Search query must contain 1-200 chars.");
    const matches=[];let scanned=0;const cap=Math.min(100,Math.max(1,limit));
    for(const root of this.roots) {
      const stack=[root];
      while(stack.length && scanned<1000 && matches.length<cap) {
        const dir=stack.pop();
        for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
          if(sensitive(entry.name)||SKIP.has(entry.name)||entry.isSymbolicLink())continue;
          let p;try{p=this.resolve(path.join(dir,entry.name));}catch{continue;}
          if(entry.isDirectory())stack.push(p);
          else if(entry.isFile()) {
            try{
              if(fs.statSync(p).size>LIMIT)continue;
              scanned++;
              const lines=readSmall(p).split(/\r?\n/);
              for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(query.toLowerCase())) {
                matches.push({file:p,line:i+1,text:lines[i].slice(0,250)});
                if(matches.length>=cap)break;
              }
            } catch {/* skip invalid text */}
          }
          if(scanned>=1000||matches.length>=cap)break;
        }
      }
    }
    return {matches,scanned,truncated:scanned>=1000||matches.length>=cap};
  }
}
