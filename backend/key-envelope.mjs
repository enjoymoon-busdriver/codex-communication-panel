import {
  constants, createDecipheriv, createPrivateKey, createPublicKey,
  generateKeyPair, privateDecrypt, randomUUID,
} from "node:crypto";
import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const generatePair = promisify(generateKeyPair);

async function readPrivateKey(dir) {
  const path = join(dir, "panel-private.pem");
  try { return createPrivateKey(await readFile(path)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { privateKey } = await generatePair("rsa", { modulusLength: 2048 });
  const temp = path + "." + randomUUID();
  try {
    await writeFile(temp, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
    // Publish a complete key without ever replacing a competing server's key.
    try { await link(temp, path); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  } finally { await rm(temp, { force: true }); }
  return createPrivateKey(await readFile(path));
}

export async function panelPublicKey(dir) {
  return createPublicKey(await readPrivateKey(dir)).export({ format: "jwk" });
}

export async function unwrapCredential(dir, envelope, provider, origin) {
  const privateKey = await readPrivateKey(dir);
  let aes;
  let clear;
  try {
    aes = privateDecrypt({
      key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256",
      oaepLabel: Buffer.from(JSON.stringify([provider, origin])),
    }, Buffer.from(envelope.wrappedKey, "base64"));
    const iv = Buffer.from(envelope.iv, "base64");
    const data = Buffer.from(envelope.ciphertext, "base64");
    if (iv.length !== 12 || data.length <= 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", aes, iv);
    decipher.setAuthTag(data.subarray(-16));
    clear = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
    if (!clear.length || clear.length > 4096 || clear.some(byte => byte < 33 || byte > 126)) throw new Error();
    return clear.toString("utf8");
  } catch {
    throw new Error("密钥未保存，请重新打开面板并输入密钥。");
  } finally {
    aes?.fill(0);
    clear?.fill(0);
  }
}
