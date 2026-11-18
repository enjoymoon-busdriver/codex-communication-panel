import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const fixedEndpoints = {
  go: "https://opencode.ai/inference/go/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};
const goModels = ["glm-5.3", "glm-5.3-flash", "deepseek-v4.1-flash"];
export const prompt = (await readFile(new URL("./prompt.txt", import.meta.url), "utf8")).trim();

async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readSettings(dir) {
  const text = await readOptional(join(dir, "communication-settings.json"));
  if (text === undefined) {
    const legacy = (await readOptional(join(dir, "communication-model")))?.trim() ?? "glm-5.3";
    return { enabled: legacy !== "off", provider: "go", models: { go: legacy } };
  }
  try {
    const settings = JSON.parse(text);
    if (typeof settings?.enabled !== "boolean") throw new Error();
    return settings;
  } catch {
    throw new Error("沟通层配置格式无效。");
  }
}

export function customEndpoint(base) {
  let url;
  try { url = new URL(base); } catch { throw new Error("自定义服务地址无效。"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("自定义服务需要 HTTPS（本地回环支持 HTTP），不能包含凭据、查询或片段。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
  return url;
}

async function providerKey(dir, provider, endpoint) {
  const raw = await readOptional(join(dir, provider + "-key"));
  if (provider !== "custom") {
    if (!raw?.trim()) throw new Error("此服务商尚未设置密钥。");
    return raw.trim();
  }
  if (!raw?.trim()) return ""; // Local compatible servers can operate without authentication.
  let credential;
  try { credential = JSON.parse(raw); } catch { throw new Error("自定义服务密钥格式无效。"); }
  if (credential?.origin !== endpoint.origin || (credential.endpoint && credential.endpoint !== endpoint.href) || typeof credential.key !== "string") {
    throw new Error("此密钥与自定义服务地址不匹配，请重新保存密钥。");
  }
  return credential.key.trim();
}

// Transport adapted from forge-delegate 1.2.4 lib.mjs::callDirect (MIT, see LICENSE).
export function settingsDir() {
  return process.env.CODEX_COMMUNICATION_HOME || join(homedir(), ".forge-delegate");
}

export async function communicate({ question, facts, uncertainties, thread_id }, meta = {}) {
  const dir = settingsDir();
  const { enabled, provider, models, customBaseUrl, promptOverride } = await readSettings(dir);
  if (!enabled) return "沟通层已关闭，本次未发送请求。请由主控直接回复。";
  if (!["go", "deepseek", "custom"].includes(provider)) throw new Error("服务商设置无效。");
  const model = models?.[provider];
  if (typeof model !== "string" || !model.trim() || (provider === "go" && !goModels.includes(model))) {
    throw new Error("沟通模型设置无效。");
  }
  const endpoint = provider === "custom" ? customEndpoint(customBaseUrl) : new URL(fixedEndpoints[provider]);
  const headers = { "Content-Type": "application/json", "User-Agent": "codex-communication-panel/0.1.0 (MCP)" };
  if (provider === "go") {
    const session = meta["codex/thread-id"] || meta["openai/codexThreadId"] || thread_id || process.env.CODEX_THREAD_ID;
    if (typeof session !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(session)) {
      throw new Error("OpenCode Go 需要当前 Codex 聊天的真实 UUID。");
    }
    headers["x-opencode-session"] = session;
  }
  const key = await providerKey(dir, provider, endpoint);
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(endpoint, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(90000),
    body: JSON.stringify({ model, messages: [
      { role: "system", content: promptOverride || prompt },
      { role: "user", content: JSON.stringify({ question, facts, uncertainties }) },
    ] }),
  }).catch(error => {
    // Surface only transport codes, never URLs, request bodies or server-provided text.
    const code = error.cause?.code || error.name;
    throw new Error(`服务商网络请求失败（${code}）。`);
  });
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
  let data;
  try { data = await res.json(); } catch { throw new Error("服务商未返回有效的 JSON。"); }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) throw new Error("服务商未返回可用正文。");
  return reply.trim();
}
