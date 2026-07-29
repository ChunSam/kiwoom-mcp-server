import { describe, expect, it } from "vitest";

import { executionStrengthItemSchema } from "../src/kiwoom/types.js";
import { formatExecutionStrength } from "../src/tools/execution-strength.js";

const MODE = "모의투자";

// Fixtures captured verbatim from mockapi 2026-07-29 (ka10046/ka10047, 005930/002990).
// Note the ka10047 rows carry `trde_qty: ""` — that blank is real, not a trimming
// artifact, and is exactly what the daily view has to work around.
const intradayRows = [
  {
    cntr_tm: "155900", cur_prc: "-208500", pred_pre: "-11500", pred_pre_sig: "5",
    flu_rt: "-5.23", trde_qty: "53", acc_trde_prica: "12931102", acc_trde_qty: "61720290",
    cntr_str: "106.92", cntr_str_5min: "106.92", cntr_str_20min: "106.91",
    cntr_str_60min: "104.30", stex_tp: "KRX",
  },
  {
    cntr_tm: "155800", cur_prc: "-208500", pred_pre: "-11500", pred_pre_sig: "5",
    flu_rt: "-5.23", trde_qty: "5", acc_trde_prica: "12931091", acc_trde_qty: "61720237",
    cntr_str: "106.92", cntr_str_5min: "106.92", cntr_str_20min: "106.86",
    cntr_str_60min: "104.19", stex_tp: "KRX",
  },
].map((r) => executionStrengthItemSchema.parse(r));

const dailyRows = [
  {
    dt: "20260729", cur_prc: "-208500", pred_pre: "-11500", pred_pre_sig: "5",
    flu_rt: "-5.23", trde_qty: "", acc_trde_prica: "13726155", acc_trde_qty: "65555523",
    cntr_str: "106.92", cntr_str_5min: "95.21", cntr_str_20min: "96.66", cntr_str_60min: "103.20",
  },
  {
    dt: "20260728", cur_prc: "-220000", pred_pre: "-34000", pred_pre_sig: "5",
    flu_rt: "-13.39", trde_qty: "", acc_trde_prica: "9401021", acc_trde_qty: "41639623",
    cntr_str: "91.05", cntr_str_5min: "90.36", cntr_str_20min: "97.64", cntr_str_60min: "103.75",
  },
  {
    dt: "20260727", cur_prc: "+254000", pred_pre: "+4500", pred_pre_sig: "2",
    flu_rt: "+1.80", trde_qty: "", acc_trde_prica: "5855537", acc_trde_qty: "23296044",
    cntr_str: "103.96", cntr_str_5min: "98.67", cntr_str_20min: "98.11", cntr_str_60min: "103.60",
  },
].map((r) => executionStrengthItemSchema.parse(r));

const strengthRow = (cntrStr: string) =>
  executionStrengthItemSchema.parse({ dt: "20260729", cur_prc: "-7300", cntr_str: cntrStr });

describe("formatExecutionStrength — 일별", () => {
  it("renders the daily table with 일/일/일 moving-average headers", () => {
    const out = formatExecutionStrength(dailyRows, "005930", "daily", 30, MODE);

    expect(out).toContain("[모의투자] 체결강도 일별 추이 — 종목 005930 (3행)");
    expect(out).toContain("| 일자 | 현재가 | 등락률 | 거래량 | 체결강도 | 5일 | 20일 | 60일 |");
    expect(out).toContain("| 2026-07-29 |");
    expect(out).not.toContain("5분");
  });

  // ka10047은 trde_qty가 전 행 공백이고 그날 거래량은 acc_trde_qty에 온다 (mock 실측;
  // 005930 07-29의 65,555,523이 ka10001 당일 거래량과 정확히 일치). 이 폴백이 없으면
  // 거래량 열이 통째로 0으로 렌더된다.
  it("uses acc_trde_qty for volume because the daily TR leaves trde_qty blank", () => {
    const out = formatExecutionStrength(dailyRows, "005930", "daily", 30, MODE);

    expect(out).toContain("65,555,523주");
    expect(out).toContain("41,639,623주");
    // 공백을 그대로 통과시켜 0주로 찍히면 안 된다.
    expect(out).not.toContain("| 0주 |");
  });

  it("shows absolute prices and keeps the direction in 등락률", () => {
    const out = formatExecutionStrength(dailyRows, "005930", "daily", 30, MODE);

    expect(out).toContain("208,500원");
    expect(out).toContain("-5.23%");
    expect(out).toContain("+1.80%");
    expect(out).not.toContain("-208,500원");
  });
});

describe("formatExecutionStrength — 시간별", () => {
  it("renders clock labels and 분-based moving-average headers", () => {
    const out = formatExecutionStrength(intradayRows, "005930", "intraday", 30, MODE);

    expect(out).toContain("체결강도 시간별 추이");
    expect(out).toContain("| 시각 | 현재가 | 등락률 | 거래량 | 체결강도 | 5분 | 20분 | 60분 |");
    expect(out).toContain("| 15:59 |");
    expect(out).not.toContain("5일");
  });

  it("uses the per-minute trde_qty rather than the cumulative figure", () => {
    const out = formatExecutionStrength(intradayRows, "005930", "intraday", 30, MODE);

    expect(out).toContain("53주");
    expect(out).not.toContain("61,720,290주");
  });
});

describe("formatExecutionStrength — 공통", () => {
  it("returns a plain notice when the TR returns no rows (unknown code)", () => {
    const out = formatExecutionStrength([], "999999", "daily", 30, MODE);

    expect(out).toContain("체결강도 일별 추이가 없습니다");
    expect(out).toContain("999999");
    expect(out).not.toContain("|");
  });

  it("caps the table at count and says how many rows were held back", () => {
    const out = formatExecutionStrength(dailyRows, "005930", "daily", 2, MODE);

    expect(out).toContain("(2행)");
    expect(out).toContain("조회된 3행 중 최근 2행만 표시했습니다");
    expect(out).not.toContain("2026-07-27");
  });

  it("interprets the latest 체결강도 against the 100 balance point", () => {
    const band = (v: string) =>
      formatExecutionStrength([strengthRow(v)], "002990", "daily", 30, MODE).split("\n")[2];

    expect(band("130.00")).toContain("매수 체결이 크게 우세");
    expect(band("115.00")).toContain("매수 체결 우세");
    expect(band("100.00")).toContain("매수·매도 균형권");
    expect(band("85.00")).toContain("매도 체결 우세");
    expect(band("70.00")).toContain("매도 체결이 크게 우세");
  });

  it("always explains that 100 is the balance point", () => {
    const out = formatExecutionStrength(dailyRows, "005930", "daily", 30, MODE);

    expect(out).toContain("100이 균형");
  });
});
