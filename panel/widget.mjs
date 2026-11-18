import { App } from "@modelcontextprotocol/ext-apps/app-with-deps";

const app = new App({ name: "Communication model settings", version: "1.0.0" });
const field = id => document.getElementById(id);
const providers = ["go", "deepseek", "custom"];
let saved;

function updateEditor() {
  const provider = field("provider").value;
  field("editor").disabled = !field("enabled").checked;
  for (const section of document.querySelectorAll("[data-id]")) {
    section.hidden = section.dataset.id !== provider;
    for (const input of section.querySelectorAll("input,select")) input.disabled = section.hidden;
  }
  const message = saved?.hasKey?.[provider] ? "已配置密钥。" : "尚未配置密钥。";
  field("key").textContent = message + " 本地设置命令：python3 backend/set-key.py " + provider;
}

function applyResult(result) {
  if (result?.isError) {
    const message = result.content?.find(item => item.type === "text")?.text;
    throw new Error(message || "工具调用失败。");
  }
  const state = result?.structuredContent;
  if (!state || !providers.includes(state.provider)) throw new Error("未收到完整的模型设置。");
  saved = state;
  field("enabled").checked = state.enabled;
  field("provider").value = state.provider;
  for (const provider of providers) field(provider).value = state.models?.[provider] || "";
  field("url").value = state.customBaseUrl || "";
  field("prompt").textContent = state.prompt || "";
  field("controls").disabled = false;
  updateEditor();
}

function report(error) {
  field("status").textContent = error.message || "读取或保存设置失败。";
}

app.ontoolresult = result => {
  try {
    applyResult(result);
    field("status").textContent = "";
  } catch (error) {
    report(error);
  }
};
field("enabled").addEventListener("change", updateEditor);
field("provider").addEventListener("change", updateEditor);
field("settings").addEventListener("submit", async event => {
  event.preventDefault();
  const enabled = field("enabled").checked;
  const args = { enabled, provider: enabled ? field("provider").value : saved.provider,
    models: { ...saved.models }, customBaseUrl: saved.customBaseUrl || "" };
  if (enabled) {
    args.models[args.provider] = field(args.provider).value.trim();
    if (args.provider === "custom") args.customBaseUrl = field("url").value.trim();
  }
  field("controls").disabled = true;
  try {
    applyResult(await app.callServerTool({ name: "set_panel_settings", arguments: args }));
    field("status").textContent = "已保存，下次沟通时生效。";
  } catch (error) {
    report(error);
  } finally {
    field("controls").disabled = false;
  }
});

try {
  await app.connect();
  if (!saved) {
    const result = await app.callServerTool({ name: "get_panel_settings", arguments: {} });
    if (!saved) applyResult(result);
    field("status").textContent = "";
  }
} catch (error) {
  report(error);
}
