import { describe, expect, it } from "vitest";

import {
  foreignHoldingItemSchema,
  shortSellingItemSchema,
  tradingJournalItemSchema,
  tradingJournalResponseSchema,
} from "../src/kiwoom/types.js";
import { formatForeignHolding } from "../src/tools/foreign-holding.js";
import { formatShortSelling } from "../src/tools/short-selling.js";
import { formatTradingJournal } from "../src/tools/trading-journal.js";

const MODE = "실전투자";

// ── ka10014 공매도추이 — verbatim from the live REAL probe (2026-07-07, 005930) ──
describe("formatShortSelling", () => {
  const rows = [
    {
      dt: "20260707",
      close_pric: "-296000",
      pred_pre_sig: "5",
      pred_pre: "-22000",
      flu_rt: "-6.92",
      trde_qty: "32421032",
      shrts_qty: "1388296",
      ovr_shrts_qty: "31227619",
      trde_wght: "+4.28",
      shrts_trde_prica: "409605540",
      shrts_avg_pric: "295042",
    },
  ].map((r) => shortSellingItemSchema.parse(r));
  const query = { stockCode: "005930", fromDate: "20260601", toDate: "20260707" };

  it("renders a daily short-selling row with abs price and non-directional 비중", () => {
    const text = formatShortSelling(rows, query, MODE);
    expect(text).toContain("종목 005930");
    expect(text).toContain("| 2026-07-07 | 296,000원 | -6.92% | 32,421,032주 | 1,388,296주 | 4.28% | 295,042원 |");
  });

  it("reports an empty range", () => {
    expect(formatShortSelling([], query, MODE)).toContain("공매도 추이가 없습니다");
  });
});

// ── ka10008 외국인 — verbatim from the live REAL probe (2026-07-07, 005930) ──
describe("formatForeignHolding", () => {
  const rows = [
    {
      dt: "20260707",
      close_pric: "-296000",
      pred_pre: "-22000",
      trde_qty: "32421032",
      chg_qty: "-6822050",
      poss_stkcnt: "2723095280",
      wght: "+46.58",
      gain_pos_stkcnt: "3123183328",
      frgnr_limit: "5846278608",
      frgnr_limit_irds: "0",
      limit_exh_rt: "+46.58",
    },
    {
      dt: "20260704",
      close_pric: "+318000",
      pred_pre: "+2000",
      trde_qty: "20000000",
      chg_qty: "+1234567",
      poss_stkcnt: "2729917330",
      wght: "+46.70",
      gain_pos_stkcnt: "3116361278",
      frgnr_limit: "5846278608",
      frgnr_limit_irds: "0",
      limit_exh_rt: "+46.70",
    },
  ].map((r) => foreignHoldingItemSchema.parse(r));

  it("renders foreign-holding rows with signed net change and non-directional 비중/소진률", () => {
    const text = formatForeignHolding(rows, "005930", MODE, 15);
    expect(text).toContain("종목 005930");
    expect(text).toContain("| 2026-07-07 | 296,000원 | 32,421,032주 | -6,822,050주 | 2,723,095,280주 | 46.58% | 46.58% |");
    // 46.70 → "46.7%" (locale formatting drops the trailing zero).
    expect(text).toContain("| 2026-07-04 | 318,000원 | 20,000,000주 | +1,234,567주 | 2,729,917,330주 | 46.7% | 46.7% |");
  });

  it("caps at limit and notes the truncation", () => {
    const text = formatForeignHolding(rows, "005930", MODE, 1);
    expect(text).toContain("2026-07-07");
    expect(text).not.toContain("2026-07-04");
    expect(text).toContain("최근 1일만 표시");
  });

  it("reports an empty result", () => {
    expect(formatForeignHolding([], "005930", MODE, 15)).toContain("외국인 보유 추이가 없습니다");
  });
});

// ── ka10170 당일매매일지 — item VALUES synthetic (live probe was blank), field names live ──
describe("formatTradingJournal", () => {
  const filled = tradingJournalResponseSchema.parse({
    return_code: 0,
    return_msg: "조회가 완료되었습니다.",
    tot_sell_amt: "1000000",
    tot_buy_amt: "950000",
    tot_cmsn_tax: "1500",
    tot_exct_amt: "998500",
    tot_pl_amt: "48500",
    tot_prft_rt: "5.10",
    tdy_trde_diary: [
      {
        stk_cd: "005930",
        stk_nm: "삼성전자",
        buy_avg_pric: "95000",
        buy_qty: "10",
        sel_avg_pric: "100000",
        sell_qty: "10",
        cmsn_alm_tax: "1500",
        pl_amt: "48500",
        sell_amt: "1000000",
        buy_amt: "950000",
        prft_rt: "5.10",
      },
    ],
  });

  it("renders totals and a per-stock realized-P&L row", () => {
    const text = formatTradingJournal(filled, "20260707", MODE);
    expect(text).toContain("당일매매일지 — 2026-07-07 (1종목)");
    expect(text).toContain("매도 1,000,000원 / 매수 950,000원 / 손익 +48,500원 (+5.10%)");
    expect(text).toContain("| 삼성전자 (005930) | 95,000원 | 10 | 100,000원 | 10 | +48,500원 | +5.10% |");
  });

  it("filters the all-blank placeholder row an empty day returns", () => {
    const emptyDay = tradingJournalResponseSchema.parse({
      return_code: 0,
      return_msg: " 조회가 완료되었습니다.",
      tot_prft_rt: "0.00",
      tdy_trde_diary: [tradingJournalItemSchema.parse({})],
    });
    expect(formatTradingJournal(emptyDay, "20260707", MODE)).toContain("당일 매매 내역이 없습니다");
  });

  it("surfaces the 2-month range notice from return_msg", () => {
    const tooOld = tradingJournalResponseSchema.parse({
      return_code: 0,
      return_msg: "조회기간은 최근 2개월 이전까지만 가능합니다.",
      tdy_trde_diary: [tradingJournalItemSchema.parse({})],
    });
    const text = formatTradingJournal(tooOld, "20260401", MODE);
    expect(text).toContain("최근 2개월");
  });
});
