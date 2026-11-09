const {contextBridge,ipcRenderer}=require("electron");
// Narrow, typed IPC facade: the renderer cannot access Node or invoke arbitrary channels.
const bridge={
  snapshot:()=>ipcRenderer.invoke("winbridge:snapshot"),
  proposals:()=>ipcRenderer.invoke("winbridge:proposals"),
  saveProposal:(id,entry)=>ipcRenderer.invoke("winbridge:save-proposal",{id,entry}),
  dismissProposal:id=>ipcRenderer.invoke("winbridge:dismiss-proposal",{id}),
  addTask:entry=>ipcRenderer.invoke("winbridge:add-task",entry),
  removeTask:name=>ipcRenderer.invoke("winbridge:remove-task",{name}),
  previewTask:name=>ipcRenderer.invoke("winbridge:preview-task",{name}),
  runTask:name=>ipcRenderer.invoke("winbridge:run-task",{name}),
  stopTask:id=>ipcRenderer.invoke("winbridge:stop-task",{id}),
  taskStatus:id=>ipcRenderer.invoke("winbridge:task-status",{id}),
  listDirectory:path=>ipcRenderer.invoke("winbridge:list-directory",{path}),
  readFile:path=>ipcRenderer.invoke("winbridge:read-file",{path}),
  listTrash:()=>ipcRenderer.invoke("winbridge:list-trash"),
  restore:id=>ipcRenderer.invoke("winbridge:restore",{id}),
  activity:()=>ipcRenderer.invoke("winbridge:activity"),
  savePermissions:settings=>ipcRenderer.invoke("winbridge:save-permissions",settings),
  pause:paused=>ipcRenderer.invoke("winbridge:pause",{paused}),
  exportConfig:()=>ipcRenderer.invoke("winbridge:export"),
  importConfig:()=>ipcRenderer.invoke("winbridge:import"),
  chooseDirectory:()=>ipcRenderer.invoke("winbridge:choose-directory"),
  openReleases:()=>ipcRenderer.invoke("winbridge:open-releases"),
  openFolder:()=>ipcRenderer.invoke("winbridge:open-folder"),
  getLaunchAtLogin:()=>ipcRenderer.invoke("winbridge:login-status"),
  setLaunchAtLogin:value=>ipcRenderer.invoke("winbridge:login-set",{value})
};
contextBridge.exposeInMainWorld("winbridge",Object.freeze(bridge));
