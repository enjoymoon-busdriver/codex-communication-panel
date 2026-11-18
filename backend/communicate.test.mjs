import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { communicate } from "./communicate.mjs";

const material = { question: "样例完成了吗？", facts: ["样例已归档"], uncertainties: ["尚未核对内容"] };
const settings = (provider, extra = {}) => ({
  enabled: true, provider, models: { go: "glm-5.3", deepseek: "deepseek-flash", custom: "test-model" }, ...extra,
});

async function isolated(t) {
  const dir = await mkdtemp(join(tmpdir(), "communication-test-"));
  const old = process.env.CODEX_COMMUNICATION_HOME;
  process.env.CODEX_COMMUNICATION_HOME = dir;
  t.after(async () => {
    if (old === undefined) delete process.env.CODEX_COMMUNICATION_HOME;
    else process.env.CODEX_COMMUNICATION_HOME = old;
    await rm(dir, { recursive: true, force: true });
  });
  const put = (file, value) => writeFile(join(dir, file), value, "utf8");
  return { put, configure: (s) => put("communication-settings.json", JSON.stringify(s)) };
}

test("Go defaults and legacy off work without migrating files", async t => {
  const { put } = await isolated(t);
  await put("go-key", "go-test-key");
  const id = randomUUID();
  const network = t.mock.method(globalThis, "fetch", async (url, req) => {
    assert.equal(url.href, "https://opencode.ai/inference/go/openai/v1/chat/completions");
    assert.equal(req.headers["x-opencode-session"], id);
    assert.equal(req.headers.Authorization, "Bearer go-test-key");
    assert.equal(JSON.parse(req.body).model, "glm-5.3");
    return Response.json({choices: [{message: {content: "归档完成"}}]});
  });
  assert.equal(await communicate({...material, thread_id:id}), "归档完成");
  await put("communication-model", "off");
  assert.match(await communicate(material), /已关闭/);
  assert.equal(network.mock.callCount(), 1);
});

test("DeepSeek uses its own key and receives only public request material", async t => {
  const { put, configure } = await isolated(t);
  await put("go-key", "unrelated-go-key");
  await put("deepseek-key", "deepseek-test-key");
  await configure(settings("deepseek"));
  t.mock.method(globalThis, "fetch", async (url, req) => {
    assert.equal(url.href, "https://api.deepseek.com/chat/completions");
    assert.equal(req.headers.Authorization, "Bearer deepseek-test-key");
    assert.equal(req.headers["x-opencode-session"], undefined);
    const body = JSON.parse(req.body);
    assert.equal(body.model, "deepseek-flash");
    assert.deepEqual(JSON.parse(body.messages[1].content), material);
    return Response.json({choices:[{message:{content:"ok"}}]});
  });
  assert.equal(await communicate({...material,thread_id:randomUUID()}), "ok");
});

test("custom server supports a path, has isolated credentials, and never follows redirects", async t => {
  const { configure, put } = await isolated(t);
  let redirected = false;
  const srv = createServer((req, res) => {
    if (req.url === "/elsewhere") { redirected = true; res.end(); return; }
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer local-test-key");
    assert.equal(req.headers["x-opencode-session"], undefined);
    res.writeHead(302, { Location: "/elsewhere" }).end();
  });
  srv.listen(0, "127.0.0.1");
  await once(srv, "listening");
  t.after(() => {srv.closeAllConnections(); srv.close();});
  const origin = "http://127.0.0.1:" + srv.address().port;
  await configure(settings("custom", {customBaseUrl:origin+"/v1/"}));
  await put("custom-key", JSON.stringify({origin:"https://other.example", key:"wrong-origin-key"}));
  await assert.rejects(communicate(material), /不匹配/);
  await put("custom-key", JSON.stringify({origin, key:"local-test-key"}));
  await assert.rejects(communicate(material), /网络请求失败/);
  assert.equal(redirected,false);
});

test("disabled makes no request even with incomplete configuration", async t => {
  const { configure } = await isolated(t);
  await configure({ enabled:false });
  const network = t.mock.method(globalThis,"fetch",() => assert.fail("unexpected network"));
  assert.match(await communicate(material), /已关闭/);
  assert.equal(network.mock.callCount(),0);
});

test("a compatible local server can return a final reply without a key", async t => {
  const { configure } = await isolated(t);
  await configure(settings("custom", {customBaseUrl:"http://localhost:11434/v1/chat/completions"}));
  t.mock.method(globalThis, "fetch", async (url, req) => {
    assert.equal(url.href, "http://localhost:11434/v1/chat/completions");
    assert.equal(req.headers.Authorization, undefined);
    assert.equal(req.headers["x-opencode-session"], undefined);
    assert.equal(JSON.parse(req.body).model, "test-model");
    return Response.json({ choices: [{ message: { content: "已收到。" } }] });
  });
  assert.equal(await communicate(material), "已收到。");
});
