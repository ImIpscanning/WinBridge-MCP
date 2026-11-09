import test from "node:test";
import assert from "node:assert/strict";
import {
  desktopInput,
  desktopInputStatus,
  validateDesktopRequest,
  ALLOWED_HOTKEYS,
  WINDOWS_INPUT_SCRIPT
} from "../src/windows-input.mjs";

test("input permissions do not come from a Claude instruction",()=>{
  const status=desktopInputStatus({
    WINBRIDGE_DESKTOP:"1",WINBRIDGE_INPUT:"0",WINBRIDGE_INPUT_APPS:"notepad.exe;code.exe"
  });
  assert.equal(status.input_enabled,false);
  assert.equal(status.local_approval_per_action,true);
  assert.deepEqual(status.allowed_apps,["notepad.exe","code.exe"]);
});

test("mouse coordinates must be integer pixels",()=>{
  assert.deepEqual(validateDesktopRequest("click",{x:10,y:-12}),{
    action:"click",x:10,y:-12,button:"left"
  });
  assert.throws(()=>validateDesktopRequest("click",{x:10.4,y:5}),/integer/);
  assert.throws(()=>validateDesktopRequest("move",{x:NaN,y:0}),/integer/);
  assert.throws(()=>validateDesktopRequest("click",{x:10,y:5,button:"middle"}),/button/);
});

test("typing accepts Unicode but blocks controls and oversized text",()=>{
  assert.deepEqual(validateDesktopRequest("type",{text:"Hola, 世界!"}),{
    action:"type",text:"Hola, 世界!"
  });
  assert.throws(()=>validateDesktopRequest("type",{text:""}),/1 to 500/);
  assert.throws(()=>validateDesktopRequest("type",{text:"x".repeat(501)}),/1 to 500/);
  assert.throws(()=>validateDesktopRequest("type",{text:"bad\u0000"}),/control/);
});

test("only known editor hotkeys are accepted",()=>{
  for(const keys of ALLOWED_HOTKEYS)
    assert.equal(validateDesktopRequest("hotkey",{keys}).keys,keys);
  assert.throws(()=>validateDesktopRequest("hotkey",{keys:"win+r"}),/Unknown shortcut/);
  assert.throws(()=>validateDesktopRequest("hotkey",{keys:"ctrl+shift+esc"}),/Unknown shortcut/);
});

test("scroll is bounded and cannot be zero",()=>{
  assert.equal(validateDesktopRequest("scroll",{amount:-5}).amount,-5);
  assert.throws(()=>validateDesktopRequest("scroll",{amount:11}),/Scroll amount/);
  assert.throws(()=>validateDesktopRequest("scroll",{amount:0}),/Scroll amount/);
});

test("static helper rechecks foreground app and requires a local dialog",()=>{
  assert.match(WINDOWS_INPUT_SCRIPT,/GetForegroundWindow/);
  assert.match(WINDOWS_INPUT_SCRIPT,/WINBRIDGE_INPUT_APPS/);
  assert.match(WINDOWS_INPUT_SCRIPT,/MessageBoxDefaultButton\]::Button2/);
  assert.match(WINDOWS_INPUT_SCRIPT,/The active application changed/);
  assert.match(WINDOWS_INPUT_SCRIPT,/Test-PointInWindow/);
  assert.doesNotMatch(WINDOWS_INPUT_SCRIPT, /Invoke-Expression/);
});

test("Node input cannot execute outside Windows",()=>{
  if(process.platform!=="win32") {
    assert.throws(()=>desktopInput("hotkey",{keys:"ctrl+s"}),/Windows session/);
  }
});
