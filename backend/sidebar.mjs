import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { customEndpoint, prompt, readSettings, settingsDir } from "./communicate.mjs";

const uri = "ui://communication/settings.html";
const providers = ["go", "deepseek", "custom"];
const defaults = { go: "glm-5.3", deepseek: "deepseek-flash", custom: "" };
const modelsSchema = z.object({go:z.enum(["glm-5.3","glm-5.3-flash","deepseek-v4.1-flash"]),deepseek:z.enum(["deepseek-flash","deepseek-v4-pro"]),custom:z.string().max(200)}).strict();
const input = {enabled:z.boolean(),provider:z.enum(providers),models:modelsSchema,customBaseUrl:z.string().max(2048)};
const appOnly = {ui:{resourceUri:uri,visibility:["app"]}};
async function state() {
  const dir = settingsDir();
  const {enabled, provider, models, customBaseUrl} = await readSettings(dir);
  const hasKey = {};
  for (const name of providers) {
    try { await access(join(dir, name+"-key")); hasKey[name]=true; }
    catch (error) { if(error.code!=="ENOENT") throw error; hasKey[name]=false; }
  }
  const selected = Object.fromEntries(providers.map(name => [name, models?.[name] || defaults[name]]));
  if (selected.go === "off") selected.go = defaults.go;
  return {enabled, provider, models:selected, customBaseUrl:customBaseUrl || "", hasKey, prompt};
}
const reply = async () => ({ content:[], structuredContent:await state() });
export function registerPanel(server) {
  registerAppResource(server,"沟通模型面板",uri,{description:"在宿主中配置沟通模型。"}, async () => ({
    contents:[{uri,mimeType:RESOURCE_MIME_TYPE,text:await readFile(new URL("../panel/widget.html",import.meta.url),"utf8"),
      _meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}}}}],
  }));
  registerAppTool(server,"open_communication_panel",{
    title:"沟通模型",description:"打开沟通模型设置面板。",inputSchema:{},
    annotations:{readOnlyHint:true},
    _meta:{ui:{resourceUri:uri},"openai/ui":{entrypoints:[{type:"global"},{type:"thread"}]}},
  }, reply);
  registerAppTool(server,"get_panel_settings",{
    title:"读取沟通设置",inputSchema:{},annotations:{readOnlyHint:true},_meta:appOnly,
  }, reply);
  registerAppTool(server,"set_panel_settings",{
    title:"保存沟通设置",inputSchema:input,annotations:{readOnlyHint:false,openWorldHint:false},_meta:appOnly,
  }, async ({enabled, provider, models, customBaseUrl}) => {
    const dir=settingsDir();
    const previous=await readSettings(dir);
    if (!enabled) {
      // Switching off must remain possible if the form contains unfinished edits.
      provider=previous.provider;
      models=previous.models;
      customBaseUrl=previous.customBaseUrl || "";
    } else if (customBaseUrl) customEndpoint(customBaseUrl);
    if (enabled && provider==="custom" && (!customBaseUrl || !models.custom.trim())) throw new Error("请指定自定义地址与模型。");
    await mkdir(dir,{recursive:true,mode:0o700});
    const target=join(dir,"communication-settings.json");
    const tmp=target+"."+randomUUID();
    try {
      await writeFile(tmp,JSON.stringify({enabled,provider,models,customBaseUrl},null,2)+"\n",{mode:0o600,flag:"wx"});
      if ((previous.customBaseUrl || "") !== customBaseUrl) await rm(join(dir,"custom-key"),{force:true});
      await rename(tmp,target);
    } finally { await rm(tmp,{force:true}); }
    return reply();
  });
}
