import { createServer as createHttpServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./app.mjs";

// Trusted reverse proxies can rewrite Host to the loopback host. Preserving a
// public origin instead requires an explicit allowlist and an authenticated proxy.
export function createHttpEndpoint({publicOrigin = "", bearer = ""} = {}) {
  let trustedOrigin;
  if (publicOrigin) {
    const remote = new URL(publicOrigin);
    if (remote.protocol !== "https:" || remote.origin !== publicOrigin || !bearer) {
      throw new Error("公开转发需指定完整 HTTPS origin 和独立的转发凭据。");
    }
    trustedOrigin = remote;
  }
  const expected = Buffer.from("Bearer " + bearer);
  return createHttpServer(async (req, res) => {
    const port = req.socket.localPort;
    const local = ["127.0.0.1:"+port,"localhost:"+port];
    const host = req.headers.host;
    const remoteHost = trustedOrigin && host === trustedOrigin.host;
    const origin = req.headers.origin;
    if ((!local.includes(host) && !remoteHost) ||
        (origin && !local.some(h=>origin==="http://"+h) && origin !== trustedOrigin?.origin)) {
      res.writeHead(403).end(); return;
    }
    if (bearer) {
      const actual = Buffer.from(req.headers.authorization || "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(401).end(); return;
      }
    }
    if (req.url !== "/mcp") {res.writeHead(404).end(); return;}
    if (req.method !== "POST") {res.writeHead(405,{Allow:"POST"}).end(); return;}
    const app = createServer();
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.once("close",()=>{ void app.close(); });
    try {
      await app.connect(transport);
      await transport.handleRequest(req,res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.CODEX_COMMUNICATION_PORT || "48638");
  if (!Number.isInteger(port)||port<1||port>65535) throw new Error("端口无效。");
  const http=createHttpEndpoint({publicOrigin:process.env.CODEX_COMMUNICATION_PUBLIC_ORIGIN,bearer:process.env.CODEX_COMMUNICATION_HTTP_TOKEN});
  http.listen(port,"127.0.0.1",()=>console.error(`MCP HTTP listening on http://127.0.0.1:${port}/mcp`));
}
