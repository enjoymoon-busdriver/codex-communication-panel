import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpEndpoint } from "./http.mjs";

test("local HTTP discovers both sidebar entrypoints and app-only settings; storage stays private", async t => {
  const temp=await mkdtemp(join(tmpdir(),"comm-sidebar-"));
  const previous=process.env.CODEX_COMMUNICATION_HOME;
  process.env.CODEX_COMMUNICATION_HOME=temp;
  t.after(async()=>{if(previous===undefined)delete process.env.CODEX_COMMUNICATION_HOME;else process.env.CODEX_COMMUNICATION_HOME=previous;await rm(temp,{recursive:true,force:true});});
  const srv=createHttpEndpoint();
  srv.listen(0,"127.0.0.1"); await once(srv,"listening");
  t.after(()=>{srv.closeAllConnections();srv.close();});
  const url=new URL("http://127.0.0.1:"+srv.address().port+"/mcp");
  const bad=await fetch(url,{method:"POST",headers:{origin:"https://unexpected.example"}});
  assert.equal(bad.status,403);
  const client=new Client({name:"test-client",version:"0.1"});
  await client.connect(new StreamableHTTPClientTransport(url));t.after(()=>client.close());
  const {tools}=await client.listTools();
  const open=tools.find(tool=>tool.name==="open_communication_panel");
  assert.deepEqual(open._meta["openai/ui"].entrypoints,[{type:"global"},{type:"thread"}]);
  const uri=open._meta.ui.resourceUri;
  assert.ok((await client.listResources()).resources.some(r=>r.uri===uri));
  const resource=(await client.readResource({uri})).contents[0];
  assert.equal(resource.mimeType,"text/html;profile=mcp-app");
  assert.match(resource.text,/<html\b/i);
  assert.match(resource.text,/<h1>传声筒<\/h1>/);
  assert.deepEqual(resource._meta["openai/ui"].availableDisplayModes,["inline","fullscreen"]);
  assert.equal(open.title,"传声筒");
  for(const name of ["get_panel_settings","set_panel_settings"]) {
    assert.deepEqual(tools.find(tool=>tool.name===name)._meta.ui.visibility,["app"]);
  }
  await writeFile(join(temp,"go-key"),"FAKE-CREDENTIAL");
  const initial=await client.callTool({name:"open_communication_panel",arguments:{}});
  assert.match(initial.content[0].text,/传声筒/);
  assert.equal(initial.structuredContent.hasKey.go,true);
  assert.doesNotMatch(JSON.stringify(initial),/FAKE-CREDENTIAL/);
  const saved=await client.callTool({name:"set_panel_settings",arguments:{enabled:true,provider:"custom",models:{go:"glm-5.3",deepseek:"deepseek-flash",custom:"test"},customBaseUrl:"https://local.example/v1"}});
  assert.equal(saved.structuredContent.provider,"custom");
  const path=fileURLToPath(new URL("./set-key.py",import.meta.url));
  const result=spawnSync("python3",[path,"custom"],{input:"dummy-local-secret\n",encoding:"utf8"});
  assert.equal(result.status,0);
  assert.doesNotMatch(result.stdout,/dummy-local-secret/);
  assert.deepEqual(JSON.parse(await readFile(join(temp,"custom-key"),"utf8")),{origin:"https://local.example",key:"dummy-local-secret"});
});

test("a configured forwarded origin requires its separate bearer", async t => {
  assert.throws(()=>createHttpEndpoint({publicOrigin:"https://public.example"}),/凭据/);
  const srv=createHttpEndpoint({publicOrigin:"https://public.example",bearer:"test-forward-token"});
  srv.listen(0,"127.0.0.1");await once(srv,"listening");
  t.after(()=>{srv.closeAllConnections();srv.close();});
  const url="http://127.0.0.1:"+srv.address().port+"/mcp";
  assert.equal((await fetch(url,{method:"POST"})).status,401);
  const client=new Client({name:"forward-test",version:"0.1"});
  await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:"Bearer test-forward-token",Origin:"https://public.example"}}}));
  assert.equal((await client.listTools()).tools.length,4);
  await client.close();
});
