import { describe, expect, it } from "vitest";

import { accountReturnSummarySchema, dailyAssetItemSchema } from "../src/kiwoom/types.js";
import { formatAccountTrend } from "../src/tools/account-trend.js";

const MODE = "실전투자";
const RANGE = { fromDate: "20260626", toDate: "20260723" };

// Fixtures are SHAPE-true (12-char zero-padded unsigned values, sign-prefixed
// evltv_prft, calendar-day rows incl. a weekend — REAL-probed 2026-07-23) but
// VALUE-synthetic: real account balances never go into the repo. prft_rt is
// kept coherent with evltv_prft ÷ invt_bsamt × 100 (the live-verified relation).

const dailyRows = [
  { dt: "20260626", entr: "000000100000", repl_amt: "000000000000", prsm_dpst_aset_amt: "000000350000" },
  { dt: "20260627", entr: "000000100000", repl_amt: "000000000000", prsm_dpst_aset_amt: "000000350000" }, // 토요일 — 금요일 값 이월
  { dt: "20260628", entr: "000000100000", repl_amt: "000000000000", prsm_dpst_aset_amt: "000000350000" }, // 일요일
  { dt: "20260629", entr: "000000017534", repl_amt: "000000210000", prsm_dpst_aset_amt: "000000317534" },
].map((r) => dailyAssetItemSchema.parse(r));

const summary = accountReturnSummarySchema.parse({
  entr_fr: "000000100000",
  entr_to: "000000017534",
  scrt_evlt_amt_fr: "000000000000",
  scrt_evlt_amt_to: "000000300000",
  tot_amt_fr: "000000100000",
  tot_amt_to: "000000317534",
  invt_bsamt: "000000600000",
  evltv_prft: "-00000033360",
  prft_rt: "-5.56",
  tern_rt: "113.63",
  termin_tot_trns: "000000200000",
  termin_tot_pymn: "000000050000",
  termin_tot_inq: "000000000000",
  termin_tot_outq: "000000000000",
  return_code: 0,
  return_msg: "조회가 완료되었습니다.",
});

describe("formatAccountTrend", () => {
  it("renders the period summary block from kt00016", () => {
    const text = formatAccountTrend(dailyRows, summary, MODE, RANGE);
    expect(text).toContain("[실전투자] 계좌 자산 추이 (2026-06-26 ~ 2026-07-23)");
    expect(text).toContain("■ 기간 요약 (kt00016)");
    expect(text).toContain("- 순자산: 100,000원 → 317,534원");
    expect(text).toContain("- 예수금: 100,000원 → 17,534원 / 유가증권 평가: 0원 → 300,000원");
    expect(text).toContain("- 기간 수익률: -5.56% — 평가손익 -33,360원, 투자원금평잔 600,000원 기준");
    expect(text).toContain("- 회전율: 113.63%");
    expect(text).toContain("- 기간내 입금 200,000원 / 출금 50,000원 / 입고 0원 / 출고 0원");
  });

  it("renders one daily row per calendar day, oldest first", () => {
    const text = formatAccountTrend(dailyRows, summary, MODE, RANGE);
    expect(text).toContain("■ 일별 추정예탁자산 (kt00002, 4일)");
    expect(text).toContain("| 일자 | 예수금 | 대용금 | 추정예탁자산 |");
    expect(text).toContain("| 2026-06-26 | 100,000원 | 0원 | 350,000원 |");
    expect(text).toContain("| 2026-06-29 | 17,534원 | 210,000원 | 317,534원 |");
    // 주말 행도 그대로 표시된다 (이월 값)
    expect(text).toContain("| 2026-06-27 |");
    expect(text).toContain("주말·휴장일 행은 직전 거래일 값이 그대로 이어집니다");
  });

  it("drops only the summary block when kt00016 fails (best-effort)", () => {
    const text = formatAccountTrend(dailyRows, null, MODE, RANGE);
    expect(text).not.toContain("기간 요약");
    expect(text).not.toContain("kt00016");
    expect(text).toContain("■ 일별 추정예탁자산 (kt00002, 4일)");
    expect(text).toContain("| 2026-06-26 |");
  });

  it("reports an empty range without a table", () => {
    const text = formatAccountTrend([], summary, MODE, RANGE);
    expect(text).toContain("조회 기간의 일별 자산 내역이 없습니다");
    expect(text).not.toContain("| 일자 |");
    // 요약 블록은 있으면 그대로 나간다
    expect(text).toContain("■ 기간 요약 (kt00016)");
  });

  it("warns when pagination hit the cap", () => {
    const text = formatAccountTrend(dailyRows, summary, MODE, RANGE, true);
    expect(text).toContain("⚠️ 조회 상한에 도달했습니다");
  });
});
