import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "./app.mjs";
import { communicate } from "./communicate.mjs";
import { panelPublicKey } from "./key-envelope.mjs";

test("different server instances share one private key; app-only encrypted saves update the next model request", async t => {
  const dir = await mkdtemp(join(tmpdir(), "communication-secret-test-"));
  const previous = process.env.CODEX_COMMUNICATION_HOME;
  process.env.CODEX_COMMUNICATION_HOME = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEX_COMMUNICATION_HOME;
    else process.env.CODEX_COMMUNICATION_HOME = previous;
    await rm(dir, {recursive:true, force:true});
  });
  const keys = await Promise.all([panelPublicKey(dir),panelPublicKey(dir),panelPublicKey(dir)]);
  for (const key of keys) {
    assert.deepEqual(key, keys[0]);
    assert.equal(key.d, undefined);
  }
  if (process.platform !== "win32") assert.equal((await stat(join(dir,"panel-private.pem"))).mode & 0o777,0o600);

  async function client() {
    const [a,b] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    const proxy = new Client({name:"test",version:"1"});
    await Promise.all([server.connect(a),proxy.connect(b)]);
    t.after(()=>proxy.close());
    return proxy;
  }
  const reader = await client();
  const writer = await client();
  const state = (await reader.callTool({name:"get_panel_settings",arguments:{}})).structuredContent;
  const settings = {enabled:true,provider:"deepseek",models:state.models,customBaseUrl:""};
  const save = params => writer.callTool({name:"set_panel_settings",arguments:{...settings,...params}});
  const newPrompt = "请保留条件，直接给出结论。";
  const secret = "example-" + "a".repeat(512); // Longer than a single RSA-OAEP plaintext.
  const subtle = webcrypto.subtle;
  const utf8 = new TextEncoder();
  const b64 = bytes => Buffer.from(bytes).toString("base64");
  const rsa = await subtle.importKey("jwk", state.keyEncryptionJwk, {name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]);
  const aes = await subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encryptedKey = {
    iv:b64(iv),
    ciphertext:b64(await subtle.encrypt({name:"AES-GCM",iv},aes,utf8.encode(secret))),
    wrappedKey:b64(await subtle.encrypt({name:"RSA-OAEP",label:utf8.encode(JSON.stringify(["deepseek",""]))},rsa,await subtle.exportKey("raw",aes))),
  };
  assert.equal((await save({provider:"go",encryptedKey})).isError,true);
  await assert.rejects(readFile(join(dir,"go-key")), {code:"ENOENT"});
  const result=await save({encryptedKey,promptOverride:newPrompt});
  assert.equal(result.isError,undefined);
  assert.equal(result.structuredContent.prompt,newPrompt);
  assert.equal(result.structuredContent.hasKey.deepseek,true);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal((await readFile(join(dir,"deepseek-key"),"utf8")).trim(),secret);
  assert.ok(!(await readFile(join(dir,"communication-settings.json"),"utf8")).includes(secret));

  const prompts=[];
  t.mock.method(globalThis,"fetch",async (_url,options)=>{
    assert.equal(options.headers.Authorization,"Bearer "+secret);
    prompts.push(JSON.parse(options.body).messages[0].content);
    return Response.json({choices:[{message:{content:"完成"}}]});
  });
  const material={question:"完成了吗？",facts:[],uncertainties:[]};
  await communicate(material);
  assert.equal((await save({})).structuredContent.prompt,newPrompt);
  assert.equal((await save({promptOverride:null})).structuredContent.prompt,state.defaultPrompt);
  await communicate(material);
  assert.deepEqual(prompts,[newPrompt,state.defaultPrompt]);
});
