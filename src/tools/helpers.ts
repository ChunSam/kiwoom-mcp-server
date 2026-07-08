import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Wraps a tool body so every failure returns a readable MCP error result
 * (isError: true) instead of a raw protocol exception.
 */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text", text: `⚠️ ${message}` }],
    };
  }
}
