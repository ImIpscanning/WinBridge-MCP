import test from "node:test";
import assert from "node:assert/strict";
import {selectGuiRelease} from "../electron/updates.mjs";
test("update checker only recognizes stable GUI releases",()=>{
 const chosen=selectGuiRelease([
  {tag_name:"v9.9.9",draft:false,prerelease:false,html_url:"https://github.com/not-gui"},
  {tag_name:"gui-v0.2.0",draft:true,prerelease:false},
  {tag_name:"control-center-v0.1.2",draft:false,prerelease:false,
    html_url:"https://github.com/ImIpscanning/WinBridge-MCP/releases/tag/control-center-v0.1.2",
    published_at:"2026-11-09T12:00:00Z"}
 ]);
 assert.equal(chosen.published,true);
 assert.equal(chosen.version,"0.1.2");
 assert.match(chosen.page,/github\.com/);
});
test("unrelated repository releases cannot be treated as GUI updates",()=>{
 const info=selectGuiRelease([{tag_name:"gameevents-v20",draft:false,prerelease:false}]);
 assert.equal(info.published,false);
});
test("malformed release data fails closed",()=>{
 assert.throws(()=>selectGuiRelease({tag_name:"gui-v1.0.0"}),/Invalid/);
});
