import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPanel } from "./sidebar.mjs";
import { z } from "zod";
import { communicate } from "./communicate.mjs";

export function createServer() {
  const server = new McpServer({ name: "forge-communication", version: "0.1.0" });
  server.registerTool("compose_reply", {
    description: "为主会话拟一条面向用户的工作回复。只使用与答复有关的问题、已核实事实和待确认点。",
    inputSchema: {
      question: z.string().min(1).describe("用户原问题的必要部分，去除无关私人信息"),
      facts: z.array(z.string()).describe("已经核实、需要传达的事实"),
      uncertainties: z.array(z.string()).describe("未核实、需保留的条件和待确认点，可空"),
      thread_id: z.string().optional().describe("当前 Codex 主聊天的真实 UUID（可从 CODEX_THREAD_ID 取得），不可自行生成。"),
    },
  }, async (args, extra) => {
    try {
      return { content: [{ type: "text", text: await communicate(args, extra._meta) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.code === "ENOENT" ? "沟通层缺少本地凭据。" : error.message }] };
    }
  });
  registerPanel(server);
  return server;
}
