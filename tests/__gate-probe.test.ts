import { describe, expect, it } from "vitest";

// 일부러 실패하는 테스트 — `ci` 집계 job이 matrix 실패를 실제로 빨갛게 만드는지
// 확인하려고 만든 임시 파일이다. 머지하지 않고 브랜치째 지운다.
describe("gate probe", () => {
  it("의도적으로 실패한다", () => {
    expect(1).toBe(2);
  });
});
