/** Safe, read-only update availability check. Does not download or run installers. */
import https from "node:https";

const endpoint="https://api.github.com/repos/ImIpscanning/WinBridge-MCP/releases?per_page=20";
export function selectGuiRelease(releases){
  if(!Array.isArray(releases))throw new Error("Invalid GitHub Releases payload.");
  const candidate=releases.find(item=>!item.draft && !item.prerelease &&
    /^((winbridge-)?control-center|gui)-v\d+\.\d+\.\d+$/i.test(item.tag_name||""));
  if(!candidate)return {published:false,message:"No hay una versión estable del Control Center publicada todavía."};
  return {published:true,tag:candidate.tag_name,version:candidate.tag_name.match(/\d+\.\d+\.\d+/)[0],
    page:candidate.html_url, published_at:candidate.published_at};
}
export async function checkUpdates(){
  return await new Promise((resolve,reject)=>{
    const req=https.get(endpoint,{headers:{
      "Accept":"application/vnd.github+json",
      "User-Agent":"WinBridge-Control-Center/0.1.0",
      "X-GitHub-Api-Version":"2022-11-28"
    }},response=>{
      if(response.statusCode!==200){
        response.resume();reject(new Error("GitHub Releases returned HTTP "+response.statusCode));return;
      }
      let contents="";
      response.setEncoding("utf8");
      response.on("data",chunk=>{
        contents+=chunk;
        if(contents.length>300000)req.destroy(new Error("Release response too large."));
      });
      response.on("end",()=>{
        try{resolve({...selectGuiRelease(JSON.parse(contents)),current_version:"0.1.0",
          auto_install:false});}catch(e){reject(e);}
      });
    });
    req.setTimeout(6500,()=>req.destroy(new Error("GitHub update check timed out.")));
    req.on("error",reject);
  });
}
