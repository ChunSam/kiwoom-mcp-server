import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPingTool(server: McpServer): void {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Health check for the Kiwoom MCP server. Takes no arguments and returns a fixed message. " +
        "Use this to verify the server is connected.",
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "pong — kiwoom-mcp-server 연결 정상 (이 tool은 키움 API를 호출하지 않아 앱키 없이도 동작합니다)",
        },
      ],
    }),
  );
}
