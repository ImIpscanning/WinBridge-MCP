/** WinBridge Control Center: isolated Electron main process. */
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ControlService,loadShared} from "./services.mjs";

const here=path.dirname(fileURLToPath(import.meta.url));
let window=null,service=null,sharedModules=null;

function register(name,fn){
  ipcMain.handle("winbridge:"+name,async(_event,payload)=>{
    try{return {ok:true,data:await fn(payload||{})};}
    catch(error){return {ok:false,error:String(error?.message||error).slice(0,900)};}
  });
}
function ensureUserAction(method){
  if(!window || window.isDestroyed() || !window.isFocused())
    throw new Error("Focus WinBridge Control Center before making changes.");
  return method();
}
function wireIpc(){
  register("snapshot",()=>service.snapshot());
  register("proposals",()=>service.listProposals());
  register("save-proposal",({id,entry})=>ensureUserAction(()=>service.saveProposal(id,entry)));
  register("dismiss-proposal",({id})=>ensureUserAction(()=>service.dismissProposal(id)));
  register("add-task",entry=>ensureUserAction(()=>service.saveTask(entry)));
  register("remove-task",({name})=>ensureUserAction(()=>service.removeTask(name)));
  register("preview-task",({name})=>service.previewTask(name));
  register("run-task",({name})=>ensureUserAction(()=>service.runTask(name)));
  register("stop-task",({id})=>service.stopTask(id));
  register("task-status",({id})=>service.taskStatus(id));
  register("list-directory",({path:p="."})=>service.listDirectory(p));
  register("read-file",({path:p})=>service.readFile(p));
  register("list-trash",()=>service.listTrash());
  register("backup-file",({path:p})=>ensureUserAction(()=>service.backupFile(p)));
  register("list-backups",()=>service.listBackups());
  register("restore-backup",({id,overwrite})=>ensureUserAction(async()=>{
    const answer=await dialog.showMessageBox(window,{type:"warning",
      buttons:["Cancelar","Restaurar respaldo"],cancelId:0,defaultId:0,
      message:"¿Restaurar este respaldo?",
      detail:overwrite?"Se hará una copia de la versión actual antes de reemplazarla.":"La restauración no sobrescribirá archivos existentes."});
    return answer.response===1?service.restoreBackup(id,overwrite):{restored:false};
  }));
  register("restore",({id})=>ensureUserAction(()=>service.restore(id)));
  register("activity",()=>service.activity());
  register("desktop-windows",()=>ensureUserAction(()=>sharedModules.windows.listWindows()));
  register("desktop-screenshot",()=>ensureUserAction(()=>sharedModules.windows.captureDesktop()));
  register("save-permissions",settings=>ensureUserAction(()=>service.savePermissions(settings)));
  register("pause",({paused})=>ensureUserAction(()=>service.pause(paused)));
  register("choose-directory",async()=>ensureUserAction(async()=>{
    const result=await dialog.showOpenDialog(window,{
      title:"Añadir carpeta de proyecto",properties:["openDirectory"]
    });
    return result.canceled?null:(result.filePaths[0]||null);
  }));
  register("open-folder",()=>ensureUserAction(()=>shell.openPath(service.dataDir)));
  register("open-releases",()=>ensureUserAction(()=>shell.openExternal(
    "https://github.com/ImIpscanning/WinBridge-MCP/releases"
  )));
  register("export",async()=>ensureUserAction(async()=>{
    const result=await dialog.showSaveDialog(window,{
      title:"Exportar configuracion de WinBridge",
      defaultPath:"winbridge-config-backup.json",
      filters:[{name:"JSON",extensions:["json"]}]
    });
    if(result.canceled||!result.filePath)return {exported:false};
    fs.writeFileSync(result.filePath,JSON.stringify(service.exportBundle(),null,2)+"\n",
      {encoding:"utf8",flag:"w"});
    return {exported:true,path:result.filePath};
  }));
  register("import",async()=>ensureUserAction(async()=>{
    const result=await dialog.showOpenDialog(window,{
      title:"Importar perfiles guardados",properties:["openFile"],
      filters:[{name:"JSON",extensions:["json"]}]
    });
    if(result.canceled||!result.filePaths[0])return {imported:false};
    const source=result.filePaths[0];
    if(fs.statSync(source).size>250000)throw new Error("Import file exceeds 250 KB.");
    const backup=JSON.parse(fs.readFileSync(source,"utf8"));
    const count=Object.keys(backup.tasks?.tasks||{}).length;
    const confirm=await dialog.showMessageBox(window,{
      type:"warning",buttons:["Cancelar","Importar perfiles"],defaultId:0,cancelId:0,
      message:"¿Reemplazar la lista de tareas personalizadas?",
      detail:"Se revisarán "+count+" perfiles. Las carpetas autorizadas y otras conexiones MCP no se modificarán."
    });
    return confirm.response===1?service.importBundle(backup):{imported:false};
  }));
  register("login-status",()=>({supported:process.platform==="win32"&&app.isPackaged,
    enabled:process.platform==="win32"&&app.isPackaged?
      app.getLoginItemSettings().openAtLogin:false}));
  register("login-set",({value})=>ensureUserAction(()=>{
    if(process.platform!=="win32"||!app.isPackaged)
      throw new Error("Autostart is available only in the packaged Windows application.");
    app.setLoginItemSettings({openAtLogin:!!value,path:process.execPath});
    return {enabled:app.getLoginItemSettings().openAtLogin};
  }));
}

function createWindow(){
  window=new BrowserWindow({
    width:1280,height:840,minWidth:940,minHeight:640,
    show:false,backgroundColor:"#0d0c14",
    title:"WinBridge Control Center",
    webPreferences:{
      preload:path.join(here,"preload.cjs"),
      sandbox:true,nodeIntegration:false,contextIsolation:true,
      webSecurity:true,devTools:!app.isPackaged
    }
  });
  // The renderer needs no camera, microphone, geolocation, notifications or arbitrary navigation.
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  window.webContents.on("will-navigate",(event,url)=>{
    const allowed=app.isPackaged?
      "file://"+path.join(here,"../dist/index.html").replace(/\\/g,"/"):
      "http://127.0.0.1:5173/";
    if(app.isPackaged?url!==allowed:!url.startsWith(allowed))event.preventDefault();
  });
  window.once("ready-to-show",()=>window.show());
  if(!app.isPackaged && process.env.WINBRIDGE_GUI_DEV==="1"){
    window.loadURL("http://127.0.0.1:5173/");
  } else {
    window.loadFile(path.join(here,"../dist/index.html"));
  }
}

app.whenReady().then(async()=>{
  const sharedPath=app.isPackaged?
    path.join(process.resourcesPath,"node","src"):
    path.resolve(here,"../../node/src");
  const shared=await loadShared(sharedPath);
  sharedModules=shared;
  service=new ControlService(shared);
  wireIpc();
  createWindow();
  app.on("activate",()=>{
    if(BrowserWindow.getAllWindows().length===0)createWindow();
  });
}).catch(err=>{
  dialog.showErrorBox("WinBridge Control Center",String(err?.message||err));
  app.quit();
});
app.on("window-all-closed",()=>{
  if(process.platform!=="darwin")app.quit();
});
