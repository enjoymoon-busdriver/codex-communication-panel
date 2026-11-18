import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./app.mjs";

await createServer().connect(new StdioServerTransport());
