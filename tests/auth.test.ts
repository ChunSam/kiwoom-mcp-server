import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { parseExpiresDt, TokenManager } from "../src/kiwoom/auth.js";
import { KiwoomAuthError } from "../src/kiwoom/errors.js";

const config: AppConfig = {
  appKey: "test-app-key-0123456789",
  appSecret: "test-app-secret-0123456789",
  mode: "VIRTUAL",
  modeLabel: "모의투자",
  isaType: "GENERAL",
  baseUrl: "https://mockapi.kiwoom.com",
};

function tokenBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    return_code: 0,
    return_msg: "정상적으로 처리되었습니다",
    token_type: "bearer",
    token: "test-token-abcdef",
    expires_dt: "20991231235959",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseExpiresDt", () => {
  it("interprets expires_dt as KST", () => {
    // 2025-01-01 09:00:00 KST == 2025-01-01 00:00:00 UTC
    expect(parseExpiresDt("20250101090000")).toBe(Date.UTC(2025, 0, 1, 0, 0, 0));
  });

  it("returns null for malformed input", () => {
    expect(parseExpiresDt("not-a-date")).toBeNull();
    expect(parseExpiresDt("2025-01-01")).toBeNull();
  });
});

describe("TokenManager", () => {
  it("issues a token once and caches it until expiry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenBody()));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(config);
    expect(await manager.getToken()).toBe("test-token-abcdef");
    expect(await manager.getToken()).toBe("test-token-abcdef");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mockapi.kiwoom.com/oauth2/token");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "client_credentials",
      appkey: config.appKey,
      secretkey: config.appSecret,
    });
  });

  it("re-issues after invalidate()", async () => {
    // A Response body is single-read — build a fresh one per call.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(tokenBody())));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(config);
    await manager.getToken();
    manager.invalidate();
    await manager.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight issuance across concurrent callers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenBody()));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(config);
    await Promise.all([manager.getToken(), manager.getToken(), manager.getToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a readable error on auth failure without leaking secrets", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(tokenBody({ return_code: 3, return_msg: "앱키 오류", token: undefined }), 200));
    vi.stubGlobal("fetch", fetchMock);

    const manager = new TokenManager(config);
    const error = await manager.getToken().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KiwoomAuthError);
    const message = (error as Error).message;
    expect(message).toContain("앱키 오류");
    expect(message).not.toContain(config.appSecret);
  });
});
