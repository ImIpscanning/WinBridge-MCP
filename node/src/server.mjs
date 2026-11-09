/** WinBridge MCP for Node.js — a separate, local stdio implementation. */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { Workspace } from "./workspace.mjs";
import { TerminalManager } from "./terminal.mjs";
import { listWindows, captureDesktop, openExplorer } from "./windows.mjs";
import { desktopInput, desktopInputStatus } from "./windows-input.mjs";
import { proposeCommand } from "./command-requests.mjs";
import { isEmergencyStopped } from "./control-state.mjs";

const workspace=Workspace.fromEnv();
const terminal=new TerminalManager(workspace);
const textResult=(data)=>({content:[{type:"text",text:JSON.stringify(data,null,2)}]});
const noArgs=z.object({});
const p=z.string().min(1).max(4096);
const index=z.number().int().min(0).max(100);
const pathSchema=z.object({path:p});
const readOnly={readOnlyHint:true,openWorldHint:false};
const write={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const destructive={readOnlyHint:false,destructiveHint:true,openWorldHint:false};

function createServer(){
  const server=new McpServer({name:"winbridge-node",version:"0.3.0"});
  function register(name,description,inputSchema,annotations,handler){
    server.registerTool(name,{description,inputSchema,annotations},async(args)=>{
      try{
        if(isEmergencyStopped() && !["workspace_info","terminal_catalog","terminal_status","terminal_stop",
          "desktop_input_status"].includes(name)) {
          throw new Error("Control Center emergency pause is active; new actions blocked.");
        }
        return textResult(await handler(args));
      }
      catch(e){return {isError:true,content:[{type:"text",text:String(e?.message??e).slice(0,1200)}]};}
    });
  }
  register("workspace_info","List permitted project roots.",noArgs,readOnly,()=>workspace.info());
  register("list_directory","List files within a configured workspace.",z.object({path:p.default("."),limit:z.number().int().min(1).max(200).default(100)}),readOnly,({path,limit})=>workspace.list(path,limit));
  register("read_file","Read a bounded UTF-8 text file in the workspace.",z.object({path:p,start_line:z.number().int().positive().default(1),max_lines:z.number().int().min(1).max(1000).default(300)}),readOnly,({path,start_line,max_lines})=>workspace.read(path,start_line,max_lines));
  register("search_text","Search authorized project text files.",z.object({query:z.string().min(1).max(200),limit:z.number().int().min(1).max(100).default(30)}),readOnly,({query,limit})=>workspace.search(query,limit));
  register("create_directory","Create an authorized project directory.",pathSchema,write,({path})=>workspace.createDirectory(path));
  register("write_file","Create or replace a UTF-8 text file in an authorized folder.",z.object({path:p,content:z.string().max(1_000_000),overwrite:z.boolean().default(false)}),write,({path,content,overwrite})=>workspace.write(path,content,overwrite));
  register("preview_text_edit","Show a text replacement preview without changing the file.",z.object({path:p,old_text:z.string().min(1),new_text:z.string()}),readOnly,({path,old_text,new_text})=>workspace.preview(path,old_text,new_text));
  register("replace_text","Replace a unique exact text match in an authorized file.",z.object({path:p,old_text:z.string().min(1),new_text:z.string()}),write,({path,old_text,new_text})=>workspace.replace(path,old_text,new_text));
  register("move_file","Move or rename a project file (no overwrite).",z.object({source:p,destination:p}),write,({source,destination})=>workspace.move(source,destination));
  register("delete_file","Move a file to recoverable project trash.",pathSchema,destructive,({path})=>workspace.remove(path));
  register("trash_list","List deleted files that can be recovered.",z.object({workspace_index:index.default(0)}),readOnly,({workspace_index})=>workspace.trash(workspace_index));
  register("restore_file","Restore a file using its restore ID.",z.object({restore_id:z.string().regex(/^[a-f0-9]{32}$/),workspace_index:index.default(0)}),write,({restore_id,workspace_index})=>workspace.restore(restore_id,workspace_index));
  register("terminal_catalog","List approved PowerShell, CMD and developer diagnostic tasks.",noArgs,readOnly,()=>terminal.catalog());
  register("terminal_start","Request on-device permission and start a terminal task without timeout.",z.object({name:z.string().min(1).max(64),cwd:p.default(".")}),write,({name,cwd})=>terminal.start(name,cwd));
  register("terminal_preview_custom","Preview a locally configured script's exact executable, arguments and working directory.",
    z.object({name:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i)}),readOnly,({name})=>terminal.previewCustom(name));
  register("terminal_propose_command","Propose a custom command for human review in WinBridge Control Center. Does not execute or authorize.",
    z.object({
      name:z.string().min(1).max(64),description:z.string().min(1).max(300),
      program:z.string().min(1).max(300),args:z.array(z.string().max(700)).max(24).default([]),
      cwd:p.default(".")
    }),write,(args)=>proposeCommand(workspace,args));
  register("terminal_start_custom","Start a Windows-user-configured script/task profile after local approval; no automatic timeout.",
    z.object({name:z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i)}),write,({name})=>terminal.startCustom(name));
  register("terminal_status","Check an asynchronous terminal job's output and exit status.",z.object({task_id:z.string().uuid()}),readOnly,({task_id})=>terminal.status(task_id));
  register("terminal_stop","Request manual termination of a running terminal job.",z.object({task_id:z.string().uuid()}),destructive,({task_id})=>terminal.stop(task_id));
  register("desktop_list_windows","List visible application window titles on Windows.",noArgs,readOnly,()=>listWindows());
  // Screenshot image is returned as image/png, not a text string.
  server.registerTool("desktop_screenshot",{description:"Request on-device approval and capture the primary screen.",inputSchema:noArgs,annotations:readOnly},async()=>{
    try{
      if(isEmergencyStopped())throw new Error("Control Center emergency pause is active.");
      return {content:[{type:"image",data:captureDesktop(),mimeType:"image/png"}]};
    }
    catch(e){return {isError:true,content:[{type:"text",text:String(e?.message??e)}]};}
  });
  register("desktop_open_workspace","With local approval, open an authorized directory in Windows Explorer.",z.object({path:p.default(".")}),write,({path})=>openExplorer(workspace,path));
  register("desktop_input_status","Show desktop input permissions, editor allowlist and available hotkeys.",noArgs,readOnly,()=>desktopInputStatus());
  register("desktop_active_window","Show current approved foreground application and its screen-coordinate bounds.",noArgs,readOnly,()=>desktopInput("active_window"));
  register("desktop_move_cursor","Move the mouse within the approved foreground application after Windows confirmation.",
    z.object({x:z.number().int(),y:z.number().int()}),write,({x,y})=>desktopInput("move",{x,y}));
  register("desktop_click","Perform one left/right click inside an approved foreground window, with Windows confirmation.",
    z.object({x:z.number().int(),y:z.number().int(),button:z.enum(["left","right"]).default("left")}),
    destructive,({x,y,button})=>desktopInput("click",{x,y,button}));
  register("desktop_type_text","Type up to 500 Unicode characters into an approved editor after Windows confirmation.",
    z.object({text:z.string().min(1).max(500)}),write,({text})=>desktopInput("type",{text}));
  register("desktop_hotkey","Send one approved Ctrl+editing shortcut into the foreground editor after Windows confirmation.",
    z.object({keys:z.enum(["ctrl+a","ctrl+c","ctrl+f","ctrl+s","ctrl+v","ctrl+y","ctrl+z"])}),
    destructive,({keys})=>desktopInput("hotkey",{keys}));
  register("desktop_scroll","Scroll within the approved foreground window after Windows confirmation.",
    z.object({amount:z.number().int().min(-10).max(10)}),write,({amount})=>desktopInput("scroll",{amount}));
  return server;
}

serveStdio(createServer);
