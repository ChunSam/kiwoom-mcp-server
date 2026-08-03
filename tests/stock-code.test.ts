import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";

import { createHttpServer } from "../src/http.js";
import { STOCK_CODE_PATTERN, stripExchangeSuffix, toUnifiedCode } from "../src/utils/stock-code.js";

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
 * 거래소 접미사 — 통합(SOR) 조회로 바꾸면서 생긴 왕복 규칙.
 * 요청에는 `_AL`을 붙여 보내고(KRX+NXT 합산), 응답에 실려 온 접미사는 떼어
 * 서버 바깥에는 `STOCK_CODE_PATTERN`이 받는 6자리만 나가게 한다.
 */
describe("exchange suffix", () => {
  it.each([
    ["005930_AL", "005930", "통합(SOR)"],
    ["005930_NX", "005930", "NXT 단독"],
    ["001_AL", "001", "업종 코드 (ka10051 실측)"],
    ["0156T0_AL", "0156T0", "영숫자 종목코드"],
  ])("strips %s → %s (%s)", (raw, bare) => {
    expect(stripExchangeSuffix(raw)).toBe(bare);
  });

  it.each(["005930", "0156T0", "001", ""])("leaves the suffix-less code %j untouched", (code) => {
    expect(stripExchangeSuffix(code)).toBe(code);
  });

  it("only strips a trailing suffix, not one in the middle", () => {
    expect(stripExchangeSuffix("_ALPHA")).toBe("_ALPHA");
    expect(stripExchangeSuffix("005930_ALX")).toBe("005930_ALX");
  });

  it("round-trips: 요청에 붙인 접미사는 응답 파싱에서 그대로 떨어진다", () => {
    expect(stripExchangeSuffix(toUnifiedCode("005930"))).toBe("005930");
  });

  it("does not double-append when the code already carries a suffix", () => {
    expect(toUnifiedCode("005930_AL")).toBe("005930_AL");
    // NXT 단독으로 명시된 코드를 통합으로 덮어쓰지 않는다.
    expect(toUnifiedCode("005930_NX")).toBe("005930_NX");
  });

  it("appends _AL to a plain code", () => {
    expect(toUnifiedCode("005930")).toBe("005930_AL");
    expect(toUnifiedCode("0156T0")).toBe("0156T0_AL");
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
