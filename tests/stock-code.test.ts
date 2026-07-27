import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { createHttpServer } from "../src/http.js";
import { STOCK_CODE_PATTERN } from "../src/utils/stock-code.js";

/**
 * Real 6-character alphanumeric codes observed verbatim in ka10098 rows
 * (2026-07-26 mock + REAL probes). A digit-only validator rejects all four.
 */
const ALPHANUMERIC_CODES = ["0156T0", "33626K", "38380K", "0197X0"];

describe("STOCK_CODE_PATTERN", () => {
  it.each(ALPHANUMERIC_CODES)("accepts the real alphanumeric code %s", (code) => {
    expect(STOCK_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each(["005930", "000660", "069500", "247540"])("accepts the plain digit code %s", (code) => {
    expect(STOCK_CODE_PATTERN.test(code)).toBe(true);
  });

  it("accepts lowercase input (handlers uppercase before use)", () => {
    expect(STOCK_CODE_PATTERN.test("0156t0")).toBe(true);
    expect(STOCK_CODE_PATTERN.test("33626k")).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["00593", "five characters"],
    ["0059300", "seven characters"],
    ["00593O ", "trailing space"],
    ["005-93", "hyphen"],
    ["００５９３０", "full-width digits"],
    ["A005930", "Kiwoom asset-class prefix (7 chars)"],
  ])("rejects %j (%s)", (code) => {
    expect(STOCK_CODE_PATTERN.test(code)).toBe(false);
  });

  it("is stateless across repeated tests (no /g flag)", () => {
    // A /g regex carries lastIndex, so the same input would alternate true/false.
    expect(STOCK_CODE_PATTERN.global).toBe(false);
    for (let i = 0; i < 5; i++) {
      expect(STOCK_CODE_PATTERN.test("0156T0")).toBe(true);
    }
  });
});

/**
 * Drift guard: every registered `stock_code` input must advertise the shared
 * alphanumeric pattern. Before this was unified, 12 tools used a digit-only
 * `/^\d{6}$/` while 6 already accepted alphanumeric codes — the same code was
 * accepted by get_orderbook and rejected by get_short_selling. Reading the real
 * `tools/list` schema (rather than the source text) catches a new tool that
 * hand-rolls its own pattern. No Kiwoom API call, so the suite stays offline.
 */
describe("registered stock_code schemas", () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  async function toolsList(): Promise<any[]> {
    const server = createHttpServer({
      port: 0,
      host: "127.0.0.1",
      authToken: undefined,
      allowNoAuth: true,
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const address = server.address();
    if (typeof address !== "object" || !address) throw new Error("no bound address");
    const base = `http://127.0.0.1:${address.port}`;

    const rpc = async (body: unknown) => {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const data = text.split("\n").find((l) => l.startsWith("data: "));
      if (!data) throw new Error(`no SSE data line: ${text}`);
      return JSON.parse(data.slice("data: ".length));
    };

    await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "vitest", version: "0" },
      },
    });
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    return list.result.tools;
  }

  /** [toolName.propName, pattern] for every stock_code-ish input. */
  function stockCodeInputs(tools: any[]): Array<[string, string | undefined]> {
    const found: Array<[string, string | undefined]> = [];
    for (const tool of tools) {
      const props = tool.inputSchema?.properties ?? {};
      for (const [name, schema] of Object.entries<any>(props)) {
        if (!name.startsWith("stock_code")) continue;
        // `stock_codes` is an array — the pattern sits on the item schema.
        found.push([`${tool.name}.${name}`, schema.pattern ?? schema.items?.pattern]);
      }
    }
    return found;
  }

  it("every stock_code input uses the shared alphanumeric pattern", async () => {
    const inputs = stockCodeInputs(await toolsList());

    // Guards against the list silently shrinking to nothing.
    expect(inputs.length).toBeGreaterThanOrEqual(17);

    const offenders = inputs.filter(([, pattern]) => pattern !== "^[0-9A-Z]{6}$");
    expect(offenders).toEqual([]);
  });

  it("no stock_code input is digit-only", async () => {
    const inputs = stockCodeInputs(await toolsList());
    const digitOnly = inputs.filter(([, pattern]) => pattern === "^\\d{6}$");
    expect(digitOnly).toEqual([]);
  });

  it("the advertised pattern accepts every real alphanumeric code", async () => {
    const inputs = stockCodeInputs(await toolsList());
    for (const [label, pattern] of inputs) {
      const re = new RegExp(pattern!);
      for (const code of ALPHANUMERIC_CODES) {
        expect(re.test(code), `${label} rejected ${code}`).toBe(true);
      }
    }
  });
});
