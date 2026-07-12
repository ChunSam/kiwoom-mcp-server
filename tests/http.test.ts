import type http from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { chooseTransport, createHttpServer, isAuthorized } from "../src/http.js";

const TOKEN = "test-secret-token";

describe("chooseTransport", () => {
  it("defaults to stdio with no args and no env", () => {
    expect(chooseTransport([], {})).toEqual({ mode: "stdio" });
  });

  it("ignores MCP_HTTP_* vars while in stdio mode", () => {
    expect(chooseTransport([], { MCP_HTTP_PORT: "9000" })).toEqual({ mode: "stdio" });
  });

  it("--http with MCP_AUTH_TOKEN enables HTTP with defaults", () => {
    expect(chooseTransport(["--http"], { MCP_AUTH_TOKEN: TOKEN })).toEqual({
      mode: "http",
      options: { port: 8000, host: "127.0.0.1", authToken: TOKEN, allowNoAuth: false },
    });
  });

  it("--http without a token refuses to start", () => {
    expect(() => chooseTransport(["--http"], {})).toThrow(/MCP_AUTH_TOKEN/);
  });

  it("--http --no-auth starts without a token (explicit opt-out)", () => {
    const choice = chooseTransport(["--http", "--no-auth"], {});
    expect(choice).toMatchObject({
      mode: "http",
      options: { authToken: undefined, allowNoAuth: true },
    });
  });

  it("MCP_TRANSPORT=http works like --http", () => {
    expect(
      chooseTransport([], { MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: TOKEN }),
    ).toMatchObject({ mode: "http" });
  });

  it("--stdio overrides MCP_TRANSPORT=http", () => {
    expect(chooseTransport(["--stdio"], { MCP_TRANSPORT: "http" })).toEqual({ mode: "stdio" });
  });

  it("rejects an unknown MCP_TRANSPORT value", () => {
    expect(() => chooseTransport([], { MCP_TRANSPORT: "websocket" })).toThrow(/MCP_TRANSPORT/);
  });

  it("--port and --host override env and defaults", () => {
    expect(
      chooseTransport(["--http", "--port", "9123", "--host", "0.0.0.0"], {
        MCP_AUTH_TOKEN: TOKEN,
        MCP_HTTP_PORT: "7000",
      }),
    ).toMatchObject({ options: { port: 9123, host: "0.0.0.0" } });
  });

  it("MCP_HTTP_PORT env applies without --port", () => {
    expect(
      chooseTransport(["--http"], { MCP_AUTH_TOKEN: TOKEN, MCP_HTTP_PORT: "7000" }),
    ).toMatchObject({ options: { port: 7000 } });
  });

  it("rejects a non-integer port", () => {
    expect(() => chooseTransport(["--http", "--port", "abc"], { MCP_AUTH_TOKEN: TOKEN })).toThrow(
      /포트/,
    );
  });

  it("rejects --port without a value", () => {
    expect(() => chooseTransport(["--http", "--port"], { MCP_AUTH_TOKEN: TOKEN })).toThrow(
      /--port/,
    );
  });

  it("rejects unknown options", () => {
    expect(() => chooseTransport(["--verbose"], {})).toThrow(/--verbose/);
  });

  it("treats a blank MCP_AUTH_TOKEN as unset", () => {
    expect(() => chooseTransport(["--http"], { MCP_AUTH_TOKEN: "  " })).toThrow(/MCP_AUTH_TOKEN/);
  });
});

describe("isAuthorized", () => {
  it("accepts the exact bearer token", () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("accepts a lowercase scheme", () => {
    expect(isAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects a wrong token, even with matching length", () => {
    expect(isAuthorized(`Bearer ${"x".repeat(TOKEN.length)}`, TOKEN)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
  });

  it("rejects a non-bearer scheme", () => {
    expect(isAuthorized(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });
});

/**
 * In-process round-trip over the real HTTP transport. Uses only the `ping`
 * tool and `tools/list` — no Kiwoom API call, so the suite stays offline.
 */
describe("HTTP transport round-trip", () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  async function listen(authToken: string | undefined): Promise<string> {
    const server = createHttpServer({
      port: 0,
      host: "127.0.0.1",
      authToken,
      allowNoAuth: !authToken,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("no bound address");
    return `http://127.0.0.1:${address.port}`;
  }

  function rpc(base: string, body: unknown, token?: string): Promise<Response> {
    return fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  /** The transport answers in SSE format — pull the first `data:` payload. */
  async function firstMessage(res: Response): Promise<any> {
    const text = await res.text();
    const data = text.split("\n").find((line) => line.startsWith("data: "));
    if (!data) throw new Error(`no SSE data line in response: ${text}`);
    return JSON.parse(data.slice("data: ".length));
  }

  const initializeBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    },
  };

  it("serves /healthz without auth", async () => {
    const base = await listen(TOKEN);
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("rejects /mcp without a bearer token", async () => {
    const base = await listen(TOKEN);
    const res = await rpc(base, initializeBody);
    expect(res.status).toBe(401);
  });

  it("rejects /mcp with a wrong token", async () => {
    const base = await listen(TOKEN);
    const res = await rpc(base, initializeBody, "wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 404 off the MCP path", async () => {
    const base = await listen(TOKEN);
    const res = await fetch(`${base}/other`);
    expect(res.status).toBe(404);
  });

  it("initializes over Streamable HTTP with auth", async () => {
    const base = await listen(TOKEN);
    const res = await rpc(base, initializeBody, TOKEN);
    expect(res.status).toBe(200);
    const message = await firstMessage(res);
    expect(message.result.serverInfo.name).toBe("kiwoom-mcp-server");
    expect(message.result.protocolVersion).toBe("2025-06-18");
  });

  it("lists tools and answers ping without credentials", async () => {
    const base = await listen(TOKEN);

    const listRes = await rpc(base, { jsonrpc: "2.0", id: 2, method: "tools/list" }, TOKEN);
    const list = await firstMessage(listRes);
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("ping");
    expect(names).toContain("get_stock_price");
    expect(names.length).toBeGreaterThanOrEqual(28);

    const pingRes = await rpc(
      base,
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: {} } },
      TOKEN,
    );
    const ping = await firstMessage(pingRes);
    expect(ping.result.content[0].text).toContain("pong");
  });

  it("works without auth when explicitly opted out", async () => {
    const base = await listen(undefined);
    const res = await rpc(base, initializeBody);
    expect(res.status).toBe(200);
    const message = await firstMessage(res);
    expect(message.result.serverInfo.name).toBe("kiwoom-mcp-server");
  });
});
