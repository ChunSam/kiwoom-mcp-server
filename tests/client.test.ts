import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/sleep.js", () => ({
  sleep: vi.fn(() => Promise.resolve()),
}));

import type { AppConfig } from "../src/config.js";
import type { TokenManager } from "../src/kiwoom/auth.js";
import { KiwoomClient } from "../src/kiwoom/client.js";
import { KiwoomApiError } from "../src/kiwoom/errors.js";

const config: AppConfig = {
  appKey: "test-app-key-0123456789",
  appSecret: "test-app-secret-0123456789",
  mode: "VIRTUAL",
  modeLabel: "모의투자",
  isaType: "GENERAL",
  baseUrl: "https://mockapi.kiwoom.com",
};

function fakeTokens(): TokenManager {
  return {
    getToken: vi.fn().mockResolvedValue("test-token-abcdef"),
    invalidate: vi.fn(),
  } as unknown as TokenManager;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const okBody = { return_code: 0, return_msg: "OK", cur_prc: "+61300" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KiwoomClient.call", () => {
  it("sends bearer token and api-id headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    const res = await client.call({ path: "/api/dostk/stkinfo", apiId: "ka10001", body: { stk_cd: "005930" } });

    expect(res.json).toMatchObject({ cur_prc: "+61300" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mockapi.kiwoom.com/api/dostk/stkinfo");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer test-token-abcdef");
    expect(headers["api-id"]).toBe("ka10001");
  });

  it("retries once with a fresh token on 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);

    const tokens = fakeTokens();
    const client = new KiwoomClient(config, tokens);
    const res = await client.call({ path: "/api/dostk/acnt", apiId: "kt00018", body: {} });

    expect(res.json).toMatchObject({ return_code: 0 });
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    const res = await client.call({ path: "/api/dostk/acnt", apiId: "kt00018", body: {} });
    expect(res.json).toMatchObject({ return_code: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated 429 with a rate-limit message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    const error = await client
      .call({ path: "/api/dostk/acnt", apiId: "kt00018", body: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KiwoomApiError);
    expect((error as Error).message).toContain("요청 한도");
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("translates non-zero return_code into a readable error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ return_code: 2, return_msg: "필수입력 파라미터=qry_tp" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    const error = await client
      .call({ path: "/api/dostk/acnt", apiId: "kt00001", body: {} })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(KiwoomApiError);
    expect((error as Error).message).toContain("필수입력 파라미터=qry_tp");
    expect((error as KiwoomApiError).details.returnCode).toBe(2);
  });

  it("exposes cont-yn/next-key continuation headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(okBody, 200, { "cont-yn": "Y", "next-key": "NEXT123" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    const res = await client.call({ path: "/api/dostk/acnt", apiId: "kt00018", body: {} });
    expect(res.hasNext).toBe(true);
    expect(res.nextKey).toBe("NEXT123");
  });

  it("sends cont-yn/next-key request headers when continuing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);

    const client = new KiwoomClient(config, fakeTokens());
    await client.call({ path: "/api/dostk/acnt", apiId: "kt00018", body: {}, contYn: "Y", nextKey: "NEXT123" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["cont-yn"]).toBe("Y");
    expect(headers["next-key"]).toBe("NEXT123");
  });
});
