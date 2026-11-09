import React,{useCallback,useEffect,useMemo,useState} from "react";
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowRight,
  Bell, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3,
  Code2, Copy, Download, ExternalLink, Eye, FileCode2, FileText,
  Folder, FolderOpen, HardDrive, Inbox, Info, Keyboard, LayoutDashboard,
  ListChecks, LockKeyhole, Menu, Monitor, Moon, MousePointer2, PauseCircle,
  Play, Plus, RefreshCw, RotateCcw, Save, Search, Settings2, Shield,
  ShieldAlert, ShieldCheck, SlidersHorizontal, Sun, Terminal,
  Trash2, Upload, X, XCircle
} from "lucide-react";

const MENU=[
 {id:"dashboard",label:"Dashboard",icon:LayoutDashboard},
 {id:"requests",label:"Aprobaciones",icon:Inbox},
 {id:"terminal",label:"Terminal Manager",icon:Terminal},
 {id:"files",label:"File Manager",icon:FolderOpen},
 {id:"desktop",label:"Desktop Manager",icon:Monitor},
 {id:"permissions",label:"Permisos",icon:ShieldCheck},
 {id:"activity",label:"Actividad",icon:Activity},
 {id:"settings",label:"Configuración",icon:Settings2}
];
const defaultTask={name:"",description:"",program:"",arguments:"",cwd:"."};
const dateString=value=>{
  if(!value)return "—";
  try{return new Date(value).toLocaleString("es",{dateStyle:"short",timeStyle:"short"});}
  catch{return String(value);}
};
async function api(method,...args){
 const f=window.winbridge?.[method];
 if(typeof f!=="function")throw new Error("No se encontró la conexión local con Electron.");
 const result=await f(...args);
 if(!result?.ok)throw new Error(result?.error||"La operación falló.");
 return result.data;
}
function IconButton({icon:Icon,title,onClick,disabled=false,variant=""}){
 return <button className={"icon-button "+variant} title={title} aria-label={title}
   disabled={disabled} onClick={onClick}><Icon size={17}/></button>;
}
function SectionHeading({title,subtitle,actions}){
 return <div className="section-heading">
  <div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>
  {actions&&<div className="heading-actions">{actions}</div>}
 </div>;
}
function Button({children,icon:Icon,variant="secondary",onClick,disabled=false,type="button"}){
 return <button className={"btn "+variant} onClick={onClick} disabled={disabled} type={type}>
  {Icon&&<Icon size={16}/>}<span>{children}</span>
 </button>;
}
function Stat({label,value,icon:Icon,note}){
 return <div className="stat-card">
  <div className="stat-top"><span className="stat-label">{label}</span><Icon size={18}/></div>
  <strong>{value}</strong><small>{note}</small>
 </div>;
}
function Empty({icon:Icon,title,detail,action}){
 return <div className="empty"><div className="empty-icon"><Icon size={26}/></div>
  <strong>{title}</strong><p>{detail}</p>{action}</div>;
}
function Panel({title,subtitle,action,children,className=""}){
 return <section className={"panel "+className}><div className="panel-header">
  <div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div>
  {action&&<div>{action}</div>}
 </div><div className="panel-body">{children}</div></section>;
}
function Field({label,value,onChange,placeholder,help,textarea=false,rows=3,disabled=false}){
 return <label className="field">
  <span>{label}</span>
  {textarea?<textarea rows={rows} value={value??""} onChange={e=>onChange(e.target.value)}
    placeholder={placeholder} disabled={disabled}/>:<input value={value??""} onChange={e=>onChange(e.target.value)}
    placeholder={placeholder} disabled={disabled}/>}
  {help&&<small>{help}</small>}
 </label>;
}
function Switch({checked,onChange,label,description,disabled=false}){
 return <div className="switch-row">
  <div><strong>{label}</strong><small>{description}</small></div>
  <button type="button" className={"switch "+(checked?"on":"")} aria-pressed={checked}
    aria-label={label} onClick={()=>onChange(!checked)} disabled={disabled}><span/></button>
 </div>;
}
function TaskEditor({form,setForm,onSave,onCancel,proposal=false,busy=false}){
 const update=(k,v)=>setForm(p=>({...p,[k]:v}));
 return <form className="editor-form" onSubmit={e=>{e.preventDefault();onSave();}}>
  <div className="form-grid">
   <Field label="Identificador de tarea" value={form.name} onChange={v=>update("name",v)}
     placeholder="compilar_proyecto" help="Letras, números, guiones y _"/>
   <Field label="Programa / ejecutable" value={form.program} onChange={v=>update("program",v)}
     placeholder="npm.cmd o powershell.exe"/>
  </div>
  <Field label="Descripción" value={form.description} onChange={v=>update("description",v)}
    placeholder="Compilar el proyecto local"/>
  <Field label="Argumentos (uno por línea)" textarea rows={4} value={form.arguments}
    onChange={v=>update("arguments",v)} placeholder={"run\nbuild"}
    help="Se guardan como una lista de argumentos; no se ejecutan al escribirlos aquí."/>
  <Field label="Carpeta de trabajo autorizada" value={form.cwd} onChange={v=>update("cwd",v)}
    placeholder="." help='Usa "." para la primera carpeta del workspace.'/>
  <div className="notice caution"><ShieldAlert size={17}/>
    {proposal?"Propuesta de Claude: revísala antes de incorporarla al catálogo. Guardar no ejecuta.":"Las tareas guardadas requieren confirmación local de Windows cada vez que se ejecutan."}
  </div>
  <div className="form-actions"><Button onClick={onCancel}>Cancelar</Button>
   <Button type="submit" icon={Save} variant="primary" disabled={busy}>Guardar tarea</Button></div>
 </form>;
}
const taskToForm=t=>({
 name:t?.name||"",description:t?.description||"",program:t?.program||"",
 arguments:Array.isArray(t?.args)?t.args.join("\n"):"",cwd:t?.cwd||"."
});
const formToTask=t=>({
 name:t.name,description:t.description,program:t.program,
 args:t.arguments?t.arguments.split(/\r?\n/).filter(x=>x.length>0):[],cwd:t.cwd||"."
});

export default function App(){
 const [page,setPage]=useState("dashboard");
 const [theme,setTheme]=useState(()=>localStorage.getItem("winbridge-theme")||"dark");
 const [snapshot,setSnapshot]=useState(null);
 const [requests,setRequests]=useState([]);
 const [activity,setActivity]=useState([]);
 const [folder,setFolder]=useState(".");
 const [listing,setListing]=useState(null);
 const [selectedFile,setSelectedFile]=useState(null);
 const [trash,setTrash]=useState([]);
 const [windows,setWindows]=useState([]);
 const [screenshot,setScreenshot]=useState(null);
 const [jobs,setJobs]=useState([]);
 const [editing,setEditing]=useState(false);
 const [proposalId,setProposalId]=useState(null);
 const [form,setForm]=useState(defaultTask);
 const [settings,setSettings]=useState(null);
 const [autoStart,setAutoStart]=useState(null);
 const [banner,setBanner]=useState(null);
 const [busy,setBusy]=useState(false);
 const [search,setSearch]=useState("");
 const [sidebar,setSidebar]=useState(true);
 const [now,setNow]=useState(new Date());

 useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("winbridge-theme",theme);},[theme]);

 const show=(message,type="success")=>setBanner({message,type,key:Date.now()});
 const loadAll=useCallback(async()=>{
  try{
   const [snap,req,logs]=await Promise.all([api("snapshot"),api("proposals"),api("activity")]);
   setSnapshot(snap);setRequests(req);setActivity(logs);
   setSettings(old=>old||snap.settings);
  }catch(error){show(error.message,"error");}
 },[]);
 const refreshJobs=useCallback(async()=>{
  setJobs(previous=>{
   if(!previous.some(j=>j.status==="running"||j.status==="starting"))return previous;
   Promise.all(previous.filter(j=>j.status==="running"||j.status==="starting")
    .map(j=>api("taskStatus",j.id).catch(()=>null))).then(updated=>{
      setJobs(old=>old.map(job=>{
       const current=updated.find(p=>p?.id===job.id);
       return current?{...current}:job;
      }));
   });
   return previous;
  });
 },[]);
 useEffect(()=>{
  loadAll();
  const id=setInterval(()=>{loadAll();refreshJobs();setNow(new Date());},5000);
  return()=>clearInterval(id);
 },[loadAll,refreshJobs]);
 useEffect(()=>{if(page==="files")readDirectory(folder);},[page,folder]);
 useEffect(()=>{if(page==="settings")api("getLaunchAtLogin").then(setAutoStart).catch(()=>{});},[page]);

 async function act(run,success="Cambios guardados"){
  setBusy(true);
  try{const result=await run();show(success);await loadAll();return result;}
  catch(error){show(error.message,"error");return null;}
  finally{setBusy(false);}
 }
 async function readDirectory(dir){
  try{const data=await api("listDirectory",dir);setListing(data);setSelectedFile(null);}
  catch(error){setListing(null);show(error.message,"error");}
 }
 function openNewTask(){
  setProposalId(null);setForm({...defaultTask});setEditing(true);setPage("terminal");
 }
 function reviewProposal(request){
  setProposalId(request.id);setForm(taskToForm(request));setEditing(true);setPage("terminal");
 }
 async function saveTask(){
  if(!/^[a-z][a-z0-9_-]{0,63}$/i.test(form.name)){show("El identificador de tarea no es válido.","error");return;}
  const payload=formToTask(form);
  const done=await act(()=>proposalId?api("saveProposal",proposalId,payload):
   api("addTask",payload),proposalId?"Propuesta revisada y guardada":"Tarea guardada en el catálogo local");
  if(done){setEditing(false);setProposalId(null);}
 }
 async function runTask(name){
  const result=await act(()=>api("runTask",name),"Tarea iniciada tras la aprobación local");
  if(result?.task_id)setJobs(old=>[{id:result.task_id,name,status:"running",output:"",started_at:new Date().toISOString()},...old]);
 }
 async function viewJob(id){
  try{const info=await api("taskStatus",id);setJobs(old=>old.map(j=>j.id===id?info:j));}
  catch(error){show(error.message,"error");}
 }
 async function selectFile(file){
  try{const data=await api("readFile",file.path);setSelectedFile({name:file.name,...data});}
  catch(error){show(error.message,"error");}
 }
 async function getTrash(){
  try{setTrash(await api("listTrash"));}
  catch(error){show(error.message,"error");}
 }
 async function getWindows(){
  try{setWindows(await api("desktopWindows"));}
  catch(error){show(error.message,"error");}
 }
 async function getScreenshot(){
  try{setBusy(true);const data=await api("desktopScreenshot");setScreenshot(data);}
  catch(error){show(error.message,"error");}
  finally{setBusy(false);}
 }
 const filteredTasks=useMemo(()=>(snapshot?.custom_tasks||[]).filter(t=>
  (t.name+" "+t.description).toLowerCase().includes(search.toLowerCase())),[snapshot,search]);
 const selectedNav=MENU.find(x=>x.id===page)||MENU[0];
 const safeStatus=snapshot?.configured?"Configurado":"Sin instalar";
 const paused=snapshot?.paused;

 return <div className={"app-shell "+(!sidebar?"collapsed":"")}>
  <aside className="sidebar">
   <div className="brand"><div className="brand-mark"><span>W</span></div>
    <div className="brand-text"><strong>WINBRIDGE</strong><small>CONTROL CENTER</small></div>
    <IconButton icon={Menu} title="Contraer menú" onClick={()=>setSidebar(s=>!s)}/></div>
   <div className="nav-label">WORKSPACE</div>
   <nav>{MENU.map(item=><button key={item.id} title={item.label}
    className={"nav-item "+(page===item.id?"active":"")}
    onClick={()=>{setPage(item.id);setEditing(false);}}>
    <item.icon size={19}/><span>{item.label}</span>
    {item.id==="requests"&&requests.length>0&&<b className="count">{requests.length}</b>}
   </button>)}</nav>
   <div className="sidebar-bottom">
    <div className="side-status"><span className={"status-dot "+(paused?"danger":snapshot?.configured?"good":"warn")}/>
     <div><strong>{paused?"Pausado":safeStatus}</strong><small>{paused?"Nuevas acciones bloqueadas":"Claude Desktop · Node.js"}</small></div>
    </div>
    <div className="version">v0.1.0 <span>·</span> Electron / React</div>
   </div>
  </aside>
  <main className="main">
   <header className="topbar"><div className="crumb"><span>WinBridge</span><ChevronRight size={15}/><strong>{selectedNav.label}</strong></div>
    <div className="top-actions">
     <span className="clock">{now.toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}</span>
     <button className={"top-status "+(paused?"danger":snapshot?.configured?"configured":"missing")}>
       <span className="status-dot"/>{paused?"Pausa activa":safeStatus}</button>
     <IconButton icon={RefreshCw} title="Actualizar datos" onClick={loadAll}/>
     <IconButton icon={theme==="dark"?Sun:Moon} title="Cambiar tema" onClick={()=>setTheme(x=>x==="dark"?"light":"dark")}/>
    </div>
   </header>
   <div className="content">
    {banner&&<div className={"toast "+banner.type}><span>{banner.message}</span>
      <button onClick={()=>setBanner(null)}><X size={16}/></button></div>}

    {page==="dashboard"&&<>
     <div className="welcome">
      <div className="welcome-copy"><span className="eyebrow">CONTROL LOCAL DE TU IA</span>
       <h1>Tu PC, bajo tu control.</h1>
       <p>Gestiona las herramientas que Claude puede utilizar, revisa solicitudes y administra tu espacio de trabajo.</p>
       <div className="welcome-actions">
        <Button icon={Inbox} variant="primary" onClick={()=>setPage("requests")}>Revisar solicitudes</Button>
        <Button icon={Settings2} onClick={()=>setPage("permissions")}>Configurar permisos</Button>
       </div></div>
      <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/>
       <div className="core-icon"><ShieldCheck size={47}/></div>
       <span className="hero-chip one"><Terminal size={14}/> MCP</span>
       <span className="hero-chip two"><CheckCircle2 size={14}/> Windows</span>
      </div>
     </div>
     <div className="stats-grid">
      <Stat icon={ServerIcon} label="Conexión MCP" value={safeStatus}
        note={snapshot?.configured?"Configuración detectada; sesión no verificada":"Ejecuta el instalador Node.js"}/>
      <Stat icon={Inbox} label="Por revisar" value={requests.length} note="Comandos propuestos por Claude"/>
      <Stat icon={Terminal} label="Tareas propias" value={snapshot?.custom_tasks?.length||0} note="Configuradas localmente"/>
      <Stat icon={Activity} label="Acciones registradas" value={activity.length} note="Eventos recientes del workspace"/>
     </div>
     <div className="two-column">
      <Panel title="Solicitudes recientes" subtitle="Ninguna propuesta se ejecuta automáticamente."
       action={<Button onClick={()=>setPage("requests")}>Ver todas <ArrowRight size={15}/></Button>}>
       {requests.length?requests.slice(0,4).map(req=><div className="activity-row" key={req.id}>
        <div className="tiny-icon orange"><Terminal size={16}/></div>
        <div className="grow"><strong>{req.name}</strong><small>{req.program} · {dateString(req.created_at)}</small></div>
        <Button onClick={()=>reviewProposal(req)}>Revisar</Button></div>):
        <Empty icon={CheckCircle2} title="Todo al día" detail="No tienes solicitudes pendientes de revisión."/>}
      </Panel>
      <Panel title="Actividad reciente" subtitle="Últimas operaciones registradas localmente."
       action={<Button onClick={()=>setPage("activity")}>Historial <ArrowRight size={15}/></Button>}>
       {activity.length?activity.slice(0,5).map((event,i)=><div className="activity-row" key={i}>
        <div className="tiny-icon"><Activity size={16}/></div>
        <div className="grow"><strong>{event.action||event.operation||"Acción"}</strong>
        <small className="truncate">{event.path||event.workspace||"Workspace"}</small></div>
        <time>{dateString(event.at)}</time></div>):
        <Empty icon={Clock3} title="Sin registros todavía" detail="Los eventos de WinBridge aparecerán aquí."/>}
      </Panel>
     </div>
    </>}

    {page==="requests"&&<>
      <SectionHeading title="Centro de aprobaciones"
       subtitle="Claude puede proponer tareas. Solo tú decides cuáles se guardan y pueden ejecutarse."
       actions={<Button icon={RefreshCw} onClick={loadAll}>Actualizar</Button>}/>
      <div className="notice caution"><ShieldAlert size={18}/>
        <div><strong>Solicitudes no confiables</strong><p>Revisa el ejecutable, argumentos y directorio. Guardar crea una tarea; ejecutar requiere otra aprobación local en Windows.</p></div>
      </div>
      {requests.length?<div className="request-grid">{requests.map(req=><article className="request-card" key={req.id}>
       <div className="request-top"><span className="pill orange"><Clock3 size={13}/> Pendiente</span><small>{dateString(req.created_at)}</small></div>
       <h3>{req.name}</h3><p>{req.description}</p>
       <div className="code-preview"><div><span>PROGRAMA</span><code>{req.program}</code></div>
        <div><span>ARGUMENTOS</span><code>{req.args?.join(" ")||"(ninguno)"}</code></div>
        <div><span>DIRECTORIO</span><code>{req.cwd}</code></div></div>
       <div className="request-footer">
        <Button icon={Trash2} onClick={()=>act(()=>api("dismissProposal",req.id),"Solicitud descartada")}>Descartar</Button>
        <Button icon={Eye} variant="primary" onClick={()=>reviewProposal(req)}>Revisar y guardar</Button>
       </div></article>)}</div>:
       <Empty icon={Inbox} title="No tienes solicitudes pendientes" detail="Cuando Claude envíe una propuesta con terminal_propose_command, aparecerá aquí."/>}
     </>}

    {page==="terminal"&&<>
      <SectionHeading title="Terminal Manager" subtitle="Gestiona tus comandos autorizados, scripts y procesos locales."
        actions={<Button icon={Plus} variant="primary" onClick={openNewTask}>Nueva tarea</Button>}/>
      {editing?<Panel title={proposalId?"Revisar propuesta de Claude":"Crear tarea personalizada"}
        subtitle={proposalId?"Modifica lo que quieras antes de guardarla.":"Cada comando se conserva fuera de las carpetas editables por Claude."}>
        <TaskEditor form={form} setForm={setForm} onSave={saveTask} onCancel={()=>{setEditing(false);setProposalId(null);}} proposal={!!proposalId} busy={busy}/>
       </Panel>:<>
       <div className="terminal-info"><div className="terminal-info-icon"><Terminal size={22}/></div>
        <div><strong>Ejecutor de tareas locales</strong>
        <p>Perfiles configurados por ti, ejecución sin timeout automático, salida de procesos y cancelación manual.</p></div>
        <span className="pill purple"><Shield size={14}/> Aprobación local</span></div>
       <div className="panel">
        <div className="panel-header"><div><h3>Mis tareas guardadas</h3><p>{filteredTasks.length} perfiles locales</p></div>
          <label className="search"><Search size={16}/><input value={search}
             onChange={e=>setSearch(e.target.value)} placeholder="Buscar tareas..."/></label></div>
        <div className="panel-body no-pad">
         {filteredTasks.length?filteredTasks.map(task=><div className="task-row" key={task.name}>
           <div className="task-icon"><Code2 size={20}/></div>
           <div className="grow"><strong>{task.name}</strong><small>{task.description}</small>
            <code>{task.program} {(task.args||[]).join(" ")}</code></div>
           <div className="task-actions">
            <IconButton icon={Eye} title="Ver argumentos" onClick={()=>act(()=>api("previewTask",task.name),"Argumentos revisados en la configuración")}/>
            <IconButton icon={Trash2} title="Eliminar tarea" onClick={()=>{
              if(window.confirm("¿Eliminar la tarea "+task.name+" del catálogo?"))
                act(()=>api("removeTask",task.name),"Tarea eliminada");
             }}/>
            <Button icon={Play} variant="primary" disabled={paused||busy}
             onClick={()=>runTask(task.name)}>Ejecutar</Button></div>
          </div>):<Empty icon={Terminal} title="Todavía no hay tareas propias"
           detail="Agrega comandos que tú revisaste y quieres reutilizar." action={<Button icon={Plus} onClick={openNewTask}>Crear primera tarea</Button>}/>}
        </div>
       </div>
       <Panel title="Procesos iniciados desde la GUI"
        subtitle="Se mantienen activos mientras Control Center esté abierto y la tarea no haya terminado."
        action={<Button icon={RefreshCw} onClick={refreshJobs}>Actualizar</Button>}>
        {jobs.length?jobs.map(job=><div className="job" key={job.id}>
         <div className="job-header"><div><strong>{job.name}</strong><small>{dateString(job.started_at)}</small></div>
          <span className={"pill "+(job.status==="running"?"purple":job.exit_code===0?"green":"orange")}>{job.status}</span></div>
         <pre>{job.output||"Sin salida todavía..."}</pre>
         <div className="job-actions"><Button icon={RefreshCw} onClick={()=>viewJob(job.id)}>Consultar</Button>
          {job.status==="running"&&<Button icon={XCircle} variant="danger"
           onClick={()=>act(()=>api("stopTask",job.id),"Se solicitó detener la tarea")}>Detener</Button>}</div>
        </div>):<Empty icon={Terminal} title="Sin procesos en esta sesión" detail="Aquí aparecerán los procesos que inicies desde la GUI."/>}
       </Panel>
       </>}
      </>}

    {page==="files"&&<>
      <SectionHeading title="File Manager" subtitle="Explora y revisa únicamente tus carpetas autorizadas."
       actions={<Button icon={Trash2} onClick={getTrash}>Papelera</Button>}/>
      <div className="files-layout"><Panel title="Explorador" subtitle={listing?.directory||folder}
       action={<div className="heading-actions">
          <IconButton icon={ArrowLeft} title="Volver" onClick={()=>{
           const target=listing?.directory;
           if(!target)return;
           const parts=target.split(/[\\/]/);parts.pop();
           setFolder(parts.join("/")||".");
          }}/>
          <IconButton icon={RefreshCw} title="Actualizar" onClick={()=>readDirectory(folder)}/></div>}>
        {listing?.entries?.length?listing.entries.map(item=><button className="file-row" key={item.path}
          onClick={()=>item.type==="directory"?setFolder(item.path):selectFile(item)}>
          {item.type==="directory"?<Folder size={18}/>:<FileText size={18}/>}
          <span>{item.name}</span><ChevronRight size={15}/></button>):
         <Empty icon={FolderOpen} title="Carpeta vacía" detail="Aquí aparecerán tus proyectos y archivos."/>}
       </Panel><Panel title="Vista previa" subtitle={selectedFile?.path||"Selecciona un archivo de texto"}>
        {selectedFile?<pre className="file-content">{selectedFile.content}</pre>:
        <Empty icon={FileCode2} title="Selecciona un archivo" detail="Se mostrarán hasta 300 líneas de texto."/>}
       </Panel></div>
      {trash.length>0&&<Panel title="Papelera recuperable" subtitle="Los archivos eliminados se pueden restaurar.">
       {trash.map(item=><div className="activity-row" key={item.restore_id}>
        <div className="tiny-icon"><Trash2 size={16}/></div><div className="grow"><strong>{item.original}</strong></div>
        <Button icon={RotateCcw} onClick={()=>act(async()=>{const r=await api("restore",item.restore_id);getTrash();return r;},"Archivo restaurado")}>Restaurar</Button>
       </div>)}</Panel>}
     </>}

    {page==="desktop"&&<>
     <SectionHeading title="Desktop Manager" subtitle="Observa ventanas y controla qué aplicaciones están permitidas."
      actions={<Button icon={RefreshCw} onClick={getWindows}>Ver ventanas</Button>}/>
     <div className="two-column">
      <Panel title="Vista de escritorio" subtitle="Captura manual tras confirmación en Windows."
       action={<Button icon={Monitor} variant="primary" disabled={busy}
        onClick={getScreenshot}>Capturar pantalla</Button>}>
        {screenshot?<img className="screenshot" alt="Captura local autorizada" src={"data:image/png;base64,"+screenshot}/>:
        <Empty icon={Monitor} title="Sin captura" detail="Para proteger tu privacidad, ninguna captura se realiza automáticamente."/>}
      </Panel>
      <Panel title="Aplicaciones visibles" subtitle="La lista refleja títulos de ventanas de Windows.">
       {windows.length?windows.slice(0,35).map((w,i)=><div className="activity-row" key={i}>
        <div className="tiny-icon"><Monitor size={16}/></div><div className="grow">
         <strong>{w.MainWindowTitle||"Ventana"}</strong><small>{w.ProcessName||"Aplicación"} · PID {w.Id||"—"}</small>
        </div></div>):<Empty icon={Monitor} title="Lista aún no consultada" detail="Pulsa «Ver ventanas» para consultar las aplicaciones visibles."/>}
      </Panel>
     </div>
     <Panel title="Control de entrada" subtitle="Los clics y la escritura solo se permiten en las aplicaciones que autorizaste.">
      <div className="info-columns"><div><span>CONTROL DEL ESCRITORIO</span>
       <strong>{snapshot?.settings?.input?"Habilitado con aprobación":"Deshabilitado"}</strong></div>
       <div><span>APLICACIONES</span><strong>{snapshot?.settings?.apps||"Sin apps"}</strong></div></div>
      <Button icon={ShieldCheck} onClick={()=>setPage("permissions")}>Gestionar permisos</Button>
     </Panel>
    </>}

    {page==="permissions"&&<>
     <SectionHeading title="Permission Center" subtitle="Los permisos reales los aplica el servidor MCP, no solo la interfaz."
      actions={<span className="pill purple"><LockKeyhole size={14}/> Configuración local</span>}/>
     <div className={"emergency "+(paused?"stopped":"")}>
      <div className="emergency-icon"><PauseCircle size={26}/></div>
      <div className="grow"><strong>{paused?"Nuevas acciones MCP pausadas":"Interruptor de emergencia"}</strong>
       <p>{paused?"No se iniciarán nuevas operaciones hasta reanudar. Los procesos existentes pueden continuar.":"Pausa inmediatamente las nuevas acciones del servidor MCP. No interrumpe automáticamente procesos ya iniciados."}</p></div>
      <Button variant={paused?"primary":"danger"} icon={paused?Play:PauseCircle}
        onClick={()=>act(()=>api("pause",!paused),paused?"Nuevas acciones reanudadas":"Nuevas acciones pausadas")}>
        {paused?"Reanudar":"Pausar"}
      </Button></div>
     <Panel title="Permisos del servidor Node" subtitle="Se guardan en Claude Desktop. Reinícialo después de cambiarlos.">
      {settings&&<div className="permission-form">
       <Field textarea rows={2} label="Carpetas autorizadas (separadas por ;)"
        value={settings.roots} onChange={v=>setSettings(s=>({...s,roots:v}))}
        help="No autorices todo el disco, tu carpeta personal ni archivos de credenciales."/>
       <Button icon={FolderOpen} onClick={async()=>{
         try{const dir=await api("chooseDirectory");if(dir)setSettings(s=>({
          ...s,roots:s.roots?s.roots+";"+dir:dir
         }));}catch(error){show(error.message,"error");}
        }}>Añadir carpeta</Button>
       <div className="switches">
        <Switch label="Modificar archivos" description="Crear, editar y restaurar archivos dentro del workspace."
         checked={settings.writes} onChange={v=>setSettings(s=>({...s,writes:v}))}/>
        <Switch label="Observar escritorio" description="Permitir capturas y enumeración de ventanas."
         checked={settings.desktop} onChange={v=>setSettings(s=>({...s,desktop:v}))}/>
        <Switch label="Mouse y teclado" description="Acciones con confirmación local individual."
         checked={settings.input} onChange={v=>setSettings(s=>({...s,input:v}))}/>
       </div>
       <Field label="Aplicaciones permitidas" value={settings.apps}
        onChange={v=>setSettings(s=>({...s,apps:v}))}
        placeholder="notepad.exe;code.exe"
        help="Introduce nombres exactos de archivos .exe, separados por punto y coma."/>
       <div className="notice"><Info size={17}/><span>Las aprobaciones de Claude y las confirmaciones de Windows son independientes. Cambiar permisos requiere reiniciar Claude Desktop.</span></div>
       <div className="form-actions"><Button icon={RotateCcw} onClick={()=>setSettings(snapshot?.settings)}>Descartar cambios</Button>
         <Button icon={Save} variant="primary" disabled={busy}
          onClick={()=>act(()=>api("savePermissions",settings),"Permisos guardados. Reinicia Claude Desktop.")}>Guardar permisos</Button></div>
      </div>}
     </Panel>
    </>}

    {page==="activity"&&<>
     <SectionHeading title="Historial de actividad" subtitle="Registros locales de acciones del workspace."
      actions={<Button icon={RefreshCw} onClick={loadAll}>Actualizar</Button>}/>
     <Panel title="Eventos recientes" subtitle="Registro de auditoría de WinBridge (mejor esfuerzo).">
      {activity.length?activity.map((event,i)=><div className="activity-row" key={i}>
       <div className="tiny-icon"><Activity size={16}/></div>
       <div className="grow"><strong>{event.operation||event.action||"Acción"}</strong>
        <small className="truncate">{event.path||event.workspace}</small></div>
       <time>{dateString(event.at)}</time></div>):
       <Empty icon={Activity} title="No se registraron eventos" detail="Las operaciones aparecerán cuando empieces a usar WinBridge."/>}
     </Panel>
    </>}

    {page==="settings"&&<>
     <SectionHeading title="Configuración" subtitle="Administra la instalación, el aspecto y tus copias de seguridad."/>
     <div className="two-column">
      <Panel title="Aplicación" subtitle="Preferencias del Control Center.">
       <Switch label="Tema claro" description="Alterna entre apariencia oscura y clara."
        checked={theme==="light"} onChange={v=>setTheme(v?"light":"dark")}/>
       <Switch label="Iniciar con Windows" description="Disponible en la aplicación .exe instalada."
        checked={!!autoStart?.enabled} disabled={!autoStart?.supported}
        onChange={v=>act(async()=>{const result=await api("setLaunchAtLogin",v);
          setAutoStart({...autoStart,enabled:result.enabled});return result;},"Inicio automático actualizado")}/>
       <div className="detail-row"><span>Versión Control Center</span><strong>0.1.0</strong></div>
       <div className="detail-row"><span>Motor Node.js</span><strong>{snapshot?.node_version||"—"}</strong></div>
       <div className="detail-row"><span>Estado MCP</span><strong>{safeStatus}</strong></div>
      </Panel>
      <Panel title="Copias de seguridad" subtitle="Exporta o importa los perfiles personalizados.">
       <p className="panel-description">La importación reemplaza la lista de perfiles tras tu confirmación. No cambia las conexiones MCP ni los permisos de carpetas.</p>
       <div className="stack-actions">
        <Button icon={ArrowDownToLine} onClick={()=>act(()=>api("exportConfig"),"Copia de seguridad creada")}>Exportar configuración</Button>
        <Button icon={Upload} onClick={()=>act(()=>api("importConfig"),"Importación procesada")}>Importar perfiles</Button>
       </div>
      </Panel>
     </div>
     <Panel title="Instalación y actualizaciones" subtitle="Accede a las rutas locales o consulta versiones publicadas.">
      <div className="detail-row"><span>Datos de WinBridge</span><code>{snapshot?.data_dir||"—"}</code></div>
      <div className="detail-row"><span>Configuración de Claude</span><code>{snapshot?.config_file||"—"}</code></div>
      <div className="detail-row"><span>Archivo de tareas</span><code>{snapshot?.task_file||"—"}</code></div>
      <div className="stack-actions"><Button icon={FolderOpen} onClick={()=>act(()=>api("openFolder"),"Directorio abierto")}>Abrir carpeta de datos</Button>
       <Button icon={ExternalLink} onClick={()=>api("openReleases").catch(e=>show(e.message,"error"))}>Consultar versiones en GitHub</Button></div>
      <div className="notice"><CircleHelp size={17}/><span>Las actualizaciones todavía se verifican manualmente. Un instalador firmado y actualizaciones automáticas requieren preparar publicaciones oficiales.</span></div>
     </Panel>
    </>}
   </div>
  </main>
 </div>;
}
function ServerIcon(props){return <Monitor {...props}/>;}
