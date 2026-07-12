#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadDotEnv } from "./config.js";
import { chooseTransport, startHttpServer } from "./http.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  // Load .env before reading MCP_* transport vars (credential validation stays
  // lazy in getConfig). Real environment variables win over the file.
  loadDotEnv();
  const choice = chooseTransport(process.argv.slice(2), process.env);

  if (choice.mode === "http") {
    await startHttpServer(choice.options);
    return;
  }

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
