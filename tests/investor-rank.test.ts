import { describe, expect, it } from "vitest";

import { investorRankDailyItemSchema, investorStreakItemSchema } from "../src/kiwoom/types.js";
import { formatInvestorRankDaily, formatInvestorStreak } from "../src/tools/investor-rank.js";

const MODE = "모의투자";

// Fixtures mirror mockapi ka90009/ka10131 responses captured 2026-07-21
// (verbatim rows incl. the undocumented pipe1~3 separators and the
// ka10061-style doubled sign "--234680").

const dailyItems = [
  {
    for_netslmt_stk_cd: "000660", for_netslmt_stk_nm: "SK하이닉스", for_netslmt_amt: "-18444", for_netslmt_qty: "-101",
    pipe1: "",
    for_netprps_stk_cd: "005930", for_netprps_stk_nm: "삼성전자", for_netprps_amt: "66821", for_netprps_qty: "2580",
    pipe2: "",
    orgn_netslmt_stk_cd: "069500", orgn_netslmt_stk_nm: "KODEX 200", orgn_netslmt_amt: "-9148", orgn_netslmt_qty: "-853",
    pipe3: "",
    orgn_netprps_stk_cd: "000660", orgn_netprps_stk_nm: "SK하이닉스", orgn_netprps_amt: "68211", orgn_netprps_qty: "367",
  },
  {
    for_netslmt_stk_cd: "009150", for_netslmt_stk_nm: "삼성전기", for_netslmt_amt: "-6734", for_netslmt_qty: "-52",
    pipe1: "",
    for_netprps_stk_cd: "069500", for_netprps_stk_nm: "KODEX 200", for_netprps_amt: "8814", for_netprps_qty: "816",
    pipe2: "",
    orgn_netslmt_stk_cd: "0197X0", orgn_netslmt_stk_nm: "SOL SK하이닉스선물단일종목인버스2X", orgn_netslmt_amt: "-5887", orgn_netslmt_qty: "-4703",
    pipe3: "",
    orgn_netprps_stk_cd: "005930", orgn_netprps_stk_nm: "삼성전자", orgn_netprps_amt: "46883", orgn_netprps_qty: "1824",
  },
].map((i) => investorRankDailyItemSchema.parse(i));

const streakItems = [
  {
    rank: "1", stk_cd: "000660", stk_nm: "SK하이닉스", prid_stkpc_flu_rt: "-0.49",
    orgn_nettrde_amt: "+434409", orgn_nettrde_qty: "+173929", orgn_cont_netprps_dys: "+1",
    orgn_cont_netprps_qty: "+366154", orgn_cont_netprps_amt: "+682104",
    frgnr_nettrde_qty: "+624814", frgnr_nettrde_amt: "+1291749", frgnr_cont_netprps_dys: "-1",
    frgnr_cont_netprps_qty: "--234680", frgnr_cont_netprps_amt: "--433996",
    nettrde_qty: "+798743", nettrde_amt: "+1726158",
    tot_cont_netprps_dys: "+1", tot_cont_nettrde_qty: "+131474", tot_cont_netprps_amt: "+248108",
  },
  {
    rank: "2", stk_cd: "005930", stk_nm: "삼성전자", prid_stkpc_flu_rt: "+1.77",
    orgn_nettrde_amt: "+204764", orgn_nettrde_qty: "+699540", orgn_cont_netprps_dys: "+1",
    orgn_cont_netprps_qty: "+1823763", orgn_cont_netprps_amt: "+468826",
    frgnr_nettrde_qty: "+2961594", frgnr_nettrde_amt: "+791285", frgnr_cont_netprps_dys: "+2",
    frgnr_cont_netprps_qty: "+3095188", frgnr_cont_netprps_amt: "+790302",
    nettrde_qty: "+3661134", nettrde_amt: "+996049",
    tot_cont_netprps_dys: "+1", tot_cont_nettrde_qty: "+3784834", tot_cont_netprps_amt: "+973966",
  },
].map((i) => investorStreakItemSchema.parse(i));

describe("formatInvestorRankDaily", () => {
  it("converts 천만원 amounts to 억원 and shows 순매수/순매도 side by side", () => {
    const text = formatInvestorRankDaily(dailyItems, "kospi", "amount", undefined, 10, MODE);
    expect(text).toContain("[모의투자] 코스피 외국인·기관 순매매 상위 (최근 거래일) (상위 2종목)");
    expect(text).toContain("■ 외국인");
    expect(text).toContain("■ 기관");
    // 66821천만 → 6,682.1억; 순매도 -18444천만 → abs 1,844.4억
    expect(text).toContain("| 1 | 삼성전자 | 005930 | 6,682.1 | SK하이닉스 | 000660 | 1,844.4 |");
    expect(text).toContain("| 1 | SK하이닉스 | 000660 | 6,821.1 | KODEX 200 | 069500 | 914.8 |");
    expect(text).toContain("억원으로 환산");
  });

  it("shows raw 천주 quantities in quantity mode", () => {
    const text = formatInvestorRankDaily(dailyItems, "all", "quantity", undefined, 10, MODE);
    expect(text).toContain("수량(천주)");
    expect(text).toContain("| 1 | 삼성전자 | 005930 | 2,580 | SK하이닉스 | 000660 | 101 |");
    expect(text).toContain("※ 수량 단위는 천주입니다.");
  });

  it("labels an explicit query date", () => {
    const text = formatInvestorRankDaily(dailyItems, "kospi", "amount", "20260721", 10, MODE);
    expect(text).toContain("(2026-07-21)");
  });

  it("caps rows at limit", () => {
    const text = formatInvestorRankDaily(dailyItems, "kospi", "amount", undefined, 1, MODE);
    expect(text).toContain("(상위 1종목)");
    expect(text).not.toContain("삼성전기");
  });

  it("reports an empty day with a holiday hint", () => {
    const text = formatInvestorRankDaily([], "kospi", "amount", "20260720", 10, MODE);
    expect(text).toContain("데이터가 없습니다");
    expect(text).toContain("휴장일");
  });

  it("points to get_investor_trend for the per-stock drill-down", () => {
    const text = formatInvestorRankDaily(dailyItems, "kospi", "amount", undefined, 10, MODE);
    expect(text).toContain("get_investor_trend");
  });
});

describe("formatInvestorStreak", () => {
  it("renders net amounts, streak days, and the period return", () => {
    const text = formatInvestorStreak(streakItems, "kospi", "5", "amount", 10, MODE, false);
    expect(text).toContain("[모의투자] 코스피 기관·외국인 연속매매 현황 (최근 5일, 금액 기준 순매수 상위) (상위 2종목)");
    expect(text).toContain(
      "| 1 | SK하이닉스 | 000660 | -0.49% | +1,291,749 | -1일 | +434,409 | +1일 | +1일 |",
    );
    expect(text).toContain(
      "| 2 | 삼성전자 | 005930 | +1.77% | +791,285 | +2일 | +204,764 | +1일 | +1일 |",
    );
    expect(text).toContain("※ 연속일수 음수는 연속 순매도를 뜻합니다.");
  });

  it("notes the kospi fallback when market=all was requested", () => {
    const text = formatInvestorStreak(streakItems, "kospi", "5", "amount", 10, MODE, true);
    expect(text).toContain("코스피 기준으로 조회했습니다");
  });

  it("labels the single-day window as 최근일", () => {
    const text = formatInvestorStreak(streakItems, "kosdaq", "1", "quantity", 10, MODE, false);
    expect(text).toContain("코스닥 기관·외국인 연속매매 현황 (최근일, 수량 기준 순매수 상위)");
  });

  it("reports an empty result", () => {
    const text = formatInvestorStreak([], "kospi", "5", "amount", 10, MODE, false);
    expect(text).toContain("데이터가 없습니다");
  });
});
