#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP protocol frames — every log must go to stderr,
  // or Claude Desktop/Code will fail to parse the stream.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((error: unknown) => {
  console.error("Fatal error while starting kiwoom-mcp-server:", error);
  process.exit(1);
});
