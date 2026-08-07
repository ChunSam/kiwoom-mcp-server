import { describe, expect, it } from "vitest";

import { redactSecrets } from "../src/utils/redact.js";

/**
 * "시크릿 노출 금지"는 CLAUDE.md의 절대 규칙이고 `redactSecrets`가 그 유일한 집행
 * 지점인데, 그동안 이 함수에 직접 테스트가 하나도 없었다. 유일하게 존재하던
 * "시크릿 미유출" 단언(auth.test.ts)은 return_code≠0 분기를 찌르는데 그 분기는
 * redactSecrets를 아예 타지 않아 함수를 통째로 지워도 통과했다.
 */
describe("redactSecrets", () => {
  const APP_KEY = "live-app-key-0123456789abcdef";
  const APP_SECRET = "live-app-secret-fedcba9876543210";
  const TOKEN = "eyJhbGciOiJIUzI1NiJ9.token-body-value";

  it("replaces every occurrence of each secret", () => {
    const text = `key=${APP_KEY} secret=${APP_SECRET} again=${APP_KEY}`;
    const out = redactSecrets(text, [APP_KEY, APP_SECRET, TOKEN]);

    expect(out).not.toContain(APP_KEY);
    expect(out).not.toContain(APP_SECRET);
    expect(out).toBe("key=***REDACTED*** secret=***REDACTED*** again=***REDACTED***");
  });

  it("redacts a secret embedded in a JSON response snippet", () => {
    const body = JSON.stringify({ return_code: 3, return_msg: "invalid", appkey: APP_KEY });
    const out = redactSecrets(body, [APP_KEY, APP_SECRET, null]);

    expect(out).not.toContain(APP_KEY);
    expect(out).toContain("***REDACTED***");
    // 시크릿이 아닌 진단 정보는 남아야 한다 — 남기지 않으면 에러가 쓸모없어진다.
    expect(out).toContain("return_code");
    expect(out).toContain("invalid");
  });

  it("tolerates null/undefined secrets (token before first issue)", () => {
    expect(redactSecrets("plain text", [null, undefined])).toBe("plain text");
    expect(redactSecrets(`t=${TOKEN}`, [null, TOKEN])).toBe("t=***REDACTED***");
  });

  /**
   * 8자 미만은 일부러 건드리지 않는다 — "abc" 같은 짧은 값이 시크릿으로 들어오면
   * 본문 전체가 걸레가 되기 때문이다. 실제 앱키·토큰은 훨씬 길다.
   */
  it("leaves very short values alone to avoid over-redacting", () => {
    expect(redactSecrets("the cat sat", ["cat"])).toBe("the cat sat");
    expect(redactSecrets("1234567 x", ["1234567"])).toBe("1234567 x"); // 7자 — 경계 바로 아래
    expect(redactSecrets("12345678 x", ["12345678"])).toBe("***REDACTED*** x"); // 8자 — 경계
  });

  it("returns the text unchanged when there is nothing to redact", () => {
    expect(redactSecrets("no secrets here", [APP_KEY, APP_SECRET])).toBe("no secrets here");
    expect(redactSecrets("", [APP_KEY])).toBe("");
  });

  /**
   * 알려진 한계를 문서화한다 — 치환은 정확히 일치하는 문자열만 잡는다. 키가 URL 인코딩
   * 되거나 잘려서 오면 그대로 통과한다. 지금은 호출부가 원문 응답 본문만 넘기므로
   * 문제되지 않지만, 인코딩된 값을 넘기는 호출부가 생기면 여기부터 손봐야 한다.
   */
  it("only matches verbatim — URL-encoded or truncated forms slip through (known limit)", () => {
    const encoded = encodeURIComponent(APP_KEY).replaceAll("-", "%2D");
    expect(redactSecrets(`k=${encoded}`, [APP_KEY])).toContain(encoded);
    expect(redactSecrets(`k=${APP_KEY.slice(0, 12)}`, [APP_KEY])).toContain(APP_KEY.slice(0, 12));
  });
});
