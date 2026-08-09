import { describe, expect, it } from "vitest";

import type { TaxType } from "../src/isa/classify.js";
import { computeIsaTaxStatus, ISA_LIMITS } from "../src/isa/tax.js";
import { formatTaxReport } from "../src/tools/isa-tax-status.js";

/**
 * `formatTaxReport`는 export된 포맷터 67개 중 **유일하게 테스트가 없던** 자리였다.
 * 계산(`computeIsaTaxStatus`)은 isa.test.ts가 덮고 있었지만, 렌더는 **부호로 문장이
 * 통째로 갈리는 분기**를 셋이나 갖고 있다 — 확정 순손실 / 국내주식형 순손실 통산 /
 * 미실현 국내주식형 순손실. v0.44.1에서 실제로 터진 버그(시나리오 손실 이중 차감)와
 * v0.47.2 리뷰의 교훈(부호가 갈리는 축은 음수 방향 fixture를 같이 넣는다)이 전부
 * 이 파일이 비어 있던 탓에 늦게 잡혔다.
 *
 * `status`는 손으로 채우지 않고 `computeIsaTaxStatus`로 만든다 — 프로덕션에서 그
 * 함수의 출력이 그대로 들어오므로, 숫자를 직접 박으면 계산과 렌더가 따로 놀 수 있다.
 */

interface Entry {
  code: string;
  name: string;
  amount: number;
  taxType: TaxType;
  confident: boolean;
  reason: string;
  incomplete?: boolean;
}

const entry = (
  code: string,
  name: string,
  amount: number,
  taxType: TaxType,
  extra: { confident?: boolean; incomplete?: boolean } = {},
): Entry => ({
  code,
  name,
  amount,
  taxType,
  confident: extra.confident ?? true,
  reason: "테스트",
  ...(extra.incomplete === undefined ? {} : { incomplete: extra.incomplete }),
});

// ── 이익 방향: 한도를 넘긴 계좌 ──────────────────────────────────────────────
const gainRealized = [
  entry("360750", "TIGER 미국S&P500", 2_500_000, "TAXABLE"),
  entry("005930", "삼성전자", 300_000, "DOMESTIC_EQUITY"),
];
const gainUnrealized = [
  entry("439870", "KODEX 국고채30년액티브", -150_000, "TAXABLE"),
  entry("069500", "KODEX 200", 500_000, "DOMESTIC_EQUITY"),
];
const gainReport = {
  modeLabel: "실전투자",
  isaTypeLabel: "일반형",
  fromDate: "20250102",
  toDate: "20260809",
  status: computeIsaTaxStatus({
    limit: ISA_LIMITS.GENERAL,
    dividends: 120_000,
    realized: gainRealized,
    unrealized: gainUnrealized,
  }),
  realizedEntries: gainRealized,
  unrealizedEntries: gainUnrealized,
  dividendScan: {
    total: 100_000,
    rows: [{ date: "20260415", label: "배당금입금 분배금", amount: 100_000 }],
    otherNonTradeRows: 0,
  },
  manualDividends: 20_000,
  kiwoomRealizedTotal: 2_800_000,
  reconstructedTotal: 2_800_000,
  warnings: [],
};

// ── 손실 방향: 확정·국내주식형·미실현이 전부 음수인 계좌 ──────────────────────
const lossRealized = [
  entry("439870", "KODEX 국고채30년액티브", -800_000, "TAXABLE"),
  entry("005930", "삼성전자", -400_000, "DOMESTIC_EQUITY", { incomplete: true }),
];
const lossUnrealized = [
  entry("069500", "KODEX 200", -250_000, "DOMESTIC_EQUITY"),
  entry("999999", "KODEX 신재생에너지테마", -50_000, "TAXABLE", { confident: false }),
];
const lossReport = {
  modeLabel: "모의투자",
  isaTypeLabel: "서민형",
  fromDate: "20240301",
  toDate: "20260809",
  status: computeIsaTaxStatus({
    limit: ISA_LIMITS.SEOMIN,
    dividends: 0,
    realized: lossRealized,
    unrealized: lossUnrealized,
  }),
  realizedEntries: lossRealized,
  unrealizedEntries: lossUnrealized,
  dividendScan: { total: 0, rows: [], otherNonTradeRows: 0 },
  manualDividends: undefined,
  // 자체 재구성(−120만)과 키움 TR(−100만)이 20만 어긋난 상태 — 허용 오차(1%·최소 1,000원)를 넘긴다.
  kiwoomRealizedTotal: -1_000_000,
  reconstructedTotal: -1_200_000,
  warnings: ["거래내역이 조회 상한에 도달해 일부 오래된 거래가 누락되었을 수 있습니다"],
};

describe("formatTaxReport — 이익 방향", () => {
  const out = formatTaxReport(gainReport);

  it("모드·유형·한도·집계 기간을 머리에 밝힌다", () => {
    expect(out.startsWith("[실전투자] ISA 비과세 한도 현황 — 일반형 (한도 2,000,000원)")).toBe(true);
    expect(out).toContain("집계 기간: 2025-01-02 ~ 2026-08-09");
  });

  it("국내주식형 이익은 통산에서 빠진다고 못박는다", () => {
    expect(out).toContain("- 국내주식형 실현손익: +300,000원 → 이익은 비과세라 통산 제외 (차감 0원)");
    expect(out).not.toContain("통산 차감");
  });

  it("배당은 자동 감지 건수와 수동 입력을 나눠 적고 내역을 편다", () => {
    expect(out).toContain("- 배당·분배금·이자: 120,000원 (자동 감지 1건 + 수동 입력 20,000원)");
    expect(out).toContain("  · 2026-04-15 배당금입금 분배금: 100,000원");
  });

  it("한도를 넘기면 사용률·잔여·9.9% 예상 세금을 낸다", () => {
    expect(out).toContain("= 통산 순이익(확정): +2,620,000원");
    expect(out).toContain("- 사용: 2,620,000원 / 2,000,000원 (131.0%)");
    expect(out).toContain("- 잔여: 0원");
    expect(out).toContain("- 한도 초과분 예상 세금(9.9%): 61,380원");
    expect(out).not.toContain("순손실 상태");
  });

  it("미실현은 과세대상만 시나리오에 태우고 국내주식형 이익은 미반영이라 적는다", () => {
    expect(out).toContain("- 과세대상 미실현: -150,000원");
    expect(out).toContain("- 국내주식형 미실현: +500,000원 (이익은 비과세 — 미반영)");
    expect(out).toContain("= 시나리오 통산 순이익: +2,470,000원");
    expect(out).toContain("- 시나리오 잔여 한도: 0원 / 예상 세금: 46,530원");
  });

  it("종목별 금액에 부호를 붙이고, 분류가 확실하면 꼬리표를 안 단다", () => {
    expect(out).toContain("  · TIGER 미국S&P500 (360750): +2,500,000원");
    expect(out).toContain("  · KODEX 국고채30년액티브 (439870): -150,000원");
    expect(out).not.toContain("※분류 추정");
    expect(out).not.toContain("⚠️이력 불완전");
  });

  it("재구성 합계가 키움 TR과 맞으면 정상 범위로 적는다", () => {
    expect(out).toContain("차이 0원 — 정상 범위");
    expect(out).not.toContain("허용 오차 초과");
  });
});

describe("formatTaxReport — 손실 방향", () => {
  const out = formatTaxReport(lossReport);

  /**
   * 여기가 부호로 문장이 갈리는 자리다. 이익 fixture만 있으면 아래 세 줄은
   * **한 번도 렌더되지 않은 채** 초록으로 통과한다.
   */
  it("확정이 순손실이면 사용률 대신 '한도 전액 잔여'를 낸다", () => {
    expect(out).toContain("= 통산 순이익(확정): -1,200,000원");
    expect(out).toContain(
      "- 현재 순손실 상태 — 한도 4,000,000원 전액 잔여. 손실 1,200,000원은 만기까지 발생하는 이익과 상계됩니다.",
    );
    expect(out).not.toContain("- 사용:");
    expect(out).not.toContain("한도 초과분 예상 세금");
  });

  it("국내주식형이 순손실이면 그 금액만큼 통산 차감이라고 적는다", () => {
    expect(out).toContain("- 국내주식형 실현손익: -400,000원 → 순손실 400,000원 통산 차감");
    expect(out).toContain("- 국내주식형 미실현: -250,000원 (순손실만 차감 반영)");
    expect(out).not.toContain("이익은 비과세");
  });

  /** 국내주식형 클래스 합산 −65만이 한 번만 차감돼야 한다 (실현·미실현 따로 걸면 이중 차감). */
  it("시나리오는 국내주식형 클래스를 합산해 한 번만 차감한다", () => {
    expect(out).toContain("= 시나리오 통산 순이익: -1,500,000원");
    expect(out).toContain("- 시나리오 잔여 한도: 4,000,000원 / 예상 세금: 0원");
  });

  it("이력 불완전·분류 추정 꼬리표를 해당 종목에만 붙인다", () => {
    expect(out).toContain("  · 삼성전자 (005930): -400,000원 ⚠️이력 불완전");
    expect(out).toContain("  · KODEX 신재생에너지테마 (999999): -50,000원 ※분류 추정");
    expect(out).toContain("  · KODEX 국고채30년액티브 (439870): -800,000원");
  });

  it("배당이 없으면 자동 감지 0건만 적고 수동 입력 문구는 빼다", () => {
    expect(out).toContain("- 배당·분배금·이자: 0원 (자동 감지 0건)");
    expect(out).not.toContain("수동 입력");
  });

  it("재구성 합계가 키움 TR과 허용 오차를 넘게 벌어지면 경고한다", () => {
    expect(out).toContain(
      "※ 검증: 자체 재구성 실현손익 합계 -1,200,000원 vs 키움 실현손익 TR 합계 -1,000,000원 " +
        "(차이 -200,000원 — ⚠️ 허용 오차 초과, 결과 신뢰도 주의)",
    );
  });

  it("경고를 ⚠️와 함께 뒤에 붙인다", () => {
    expect(out).toContain("⚠️ 거래내역이 조회 상한에 도달해");
  });
});

describe("formatTaxReport — 검증 각주", () => {
  /** 키움 실현손익 TR이 실패하면 `null`이 온다 — 대조할 것이 없으니 각주 자체를 빼야 한다. */
  it("키움 실현손익 합계가 없으면 검증 각주를 아예 안 낸다", () => {
    const out = formatTaxReport({ ...gainReport, kiwoomRealizedTotal: null });
    expect(out).not.toContain("※ 검증:");
    expect(out).toContain("= 통산 순이익(확정): +2,620,000원");
  });

  /** 허용 오차는 max(1,000원, |키움값|의 1%) — 소액 계좌에서 1%가 0에 수렴하는 것을 막는다. */
  it("차이가 허용 오차 안이면 정상 범위로 적는다", () => {
    const out = formatTaxReport({
      ...gainReport,
      kiwoomRealizedTotal: 2_800_000,
      reconstructedTotal: 2_805_000,
    });
    expect(out).toContain("(차이 +5,000원 — 정상 범위)");
  });
});
