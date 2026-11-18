import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "传声筒", version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
const field = id => document.getElementById(id);
const providers = ["go", "deepseek", "custom"];
let saved;
let resetPrompt = false;
const encode = value => new TextEncoder().encode(value);
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function encryptKey(value, args) {
  const cryptoApi = globalThis.crypto?.subtle;
  if (!cryptoApi) throw new Error("当前宿主不支持加密保存密钥。");
  const rsa = await cryptoApi.importKey("jwk", saved.keyEncryptionJwk, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["encrypt"]);
  const aes = await cryptoApi.generateKey({name:"AES-GCM", length:256}, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const label = encode(JSON.stringify([args.provider, args.provider === "custom" ? new URL(args.customBaseUrl).origin : ""]));
  return {wrappedKey:base64(await cryptoApi.encrypt({name:"RSA-OAEP",label},rsa,await cryptoApi.exportKey("raw",aes))),
    iv:base64(iv), ciphertext:base64(await cryptoApi.encrypt({name:"AES-GCM",iv},aes,encode(value)))};
}

function updateEditor() {
  const provider = field("provider").value;
  field("editor").disabled = !field("enabled").checked;
  for (const section of document.querySelectorAll("[data-id]")) {
    section.hidden = section.dataset.id !== provider;
    for (const input of section.querySelectorAll("input,select")) input.disabled = section.hidden;
  }
  const message = saved?.hasKey?.[provider] ? "已配置密钥。" : "尚未配置密钥。";
  field("key").textContent = message;
  field("secret").disabled = !saved?.keyEncryptionJwk;
  if (!saved?.keyEncryptionJwk) field("key").textContent += " 请更新后端以编辑密钥。";
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
  field("secret").value = "";
  resetPrompt = false;
  field("prompt").value = state.prompt || "";
  field("prompt").readOnly = typeof state.defaultPrompt !== "string";
  field("reset").disabled = field("prompt").readOnly;
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
field("provider").addEventListener("change", () => {field("secret").value = "";updateEditor();});
field("url").addEventListener("input", () => {field("secret").value = "";});
field("reset").addEventListener("click", () => {field("prompt").value=saved.defaultPrompt;resetPrompt=true;});
field("prompt").addEventListener("input", () => {resetPrompt=false;});
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
    if (enabled && field("secret").value.trim()) args.encryptedKey = await encryptKey(field("secret").value.trim(), args);
    if (resetPrompt) args.promptOverride = null;
    else {
      const prompt = field("prompt").value.trim();
      if (!prompt) throw new Error("提示词不能为空，请输入内容或点击“恢复默认提示词”。");
      if (prompt !== saved.prompt) args.promptOverride = prompt;
    }
    const result = await app.callServerTool({ name: "set_panel_settings", arguments: args });
    if (!result.isError && ("promptOverride" in args || args.encryptedKey)) {
      const state=result.structuredContent;
      if (!state?.keyEncryptionJwk || typeof state.defaultPrompt !== "string" ||
          (args.encryptedKey && !state.hasKey?.[args.provider]) ||
          ("promptOverride" in args && state.prompt !== (args.promptOverride ?? state.defaultPrompt))) {
        throw new Error("后端未确认密钥或提示词已保存，请检查版本。");
      }
    }
    applyResult(result);
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
