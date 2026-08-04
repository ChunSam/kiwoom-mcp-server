import { describe, expect, it } from "vitest";

import { intradayForeignResponseSchema } from "../src/kiwoom/types.js";
import { formatForeignIntraday, type ForeignIntradayOptions } from "../src/tools/foreign-intraday.js";

const MODE = "실전투자";

/**
 * ka10063 실측 (REAL 2026-08-04 09:50 KST 정규장, mrkt_tp=000 / invsr=6(외국인) /
 * frgn_all=0 / smtm_netprps_tp=0 / stex_tp=3). 전체 1,420행 = 2페이지에서 고른 5행.
 *
 * 살려둔 특이값:
 *  - **이중부호**: `netprps_amt: "--21796"`, `sell_qty: "--471000"`. 키움이 음수에 부호를
 *    두 번 붙여 보내는 실제 사례로, parseKiwoomNumber가 앞 부호 런을 접는 근거다.
 *  - **수량이 전부 1,000의 배수**: 장중 값은 1,000주 단위로 반올림된 잠정치다. 같은 종목의
 *    완료 세션값(ka10059 dt=20260803 005930 = 12,731,078주)은 주 단위로 정확하다.
 *  - **KR모터스**: `buy_amt: "0"`에 `netprps_amt: "--1"` — 백만원 미만이 반올림돼 매수가
 *    0으로 보이는 행이다. 0과 결측을 구분하는지 본다.
 *  - `netprps_amt`(백만원)는 `netprps_qty`(주) × 당일 평균단가와 맞는다: 삼성전기
 *    −35,000주 / −41,690백만원 = 1,191,143원(당시 현재가 1,124,000).
 *  - `*_irds`·`prev_*` 등 미선언 필드가 함께 오지만 looseObject가 그냥 통과시킨다.
 */
const { opmr_invsr_trde: rows } = intradayForeignResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  opmr_invsr_trde: [
    {
      stk_cd: "005930_AL", stk_nm: "삼성전자", cur_prc: "-232500", pre_sig: "5",
      pred_pre: "-7000", flu_rt: "-2.92", acc_trde_qty: "16391648", netprps_amt: "--21796",
      prev_netprps_amt: "0", buy_amt: "+90773", netprps_amt_irds: "--21796",
      buy_amt_irds: "+90773", sell_amt: "--112569", sell_amt_irds: "+112569",
      netprps_qty: "--90000", prev_pot_netprps_qty: "0", netprps_irds: "--90000",
      buy_qty: "+381000", buy_qty_irds: "+381000", sell_qty: "--471000", sell_qty_irds: "+471000",
    },
    {
      stk_cd: "000040_AL", stk_nm: "KR모터스", cur_prc: "-1227", pre_sig: "5",
      pred_pre: "-13", flu_rt: "-1.05", acc_trde_qty: "7285", netprps_amt: "--1",
      prev_netprps_amt: "0", buy_amt: "0", netprps_amt_irds: "--1", buy_amt_irds: "0",
      sell_amt: "--1", sell_amt_irds: "+1", netprps_qty: "--1000", prev_pot_netprps_qty: "0",
      netprps_irds: "--1000", buy_qty: "0", buy_qty_irds: "0", sell_qty: "--1000",
      sell_qty_irds: "+1000",
    },
    {
      stk_cd: "196170_AL", stk_nm: "알테오젠", cur_prc: "+341000", pre_sig: "2",
      pred_pre: "+23500", flu_rt: "+7.40", acc_trde_qty: "367088", netprps_amt: "+5775",
      prev_netprps_amt: "0", buy_amt: "+9180", netprps_amt_irds: "+5775", buy_amt_irds: "+9180",
      sell_amt: "--3405", sell_amt_irds: "+3405", netprps_qty: "+17000",
      prev_pot_netprps_qty: "0", netprps_irds: "+17000", buy_qty: "+27000",
      buy_qty_irds: "+27000", sell_qty: "--10000", sell_qty_irds: "+10000",
    },
    {
      stk_cd: "012450_AL", stk_nm: "한화에어로스페이스", cur_prc: "+940000", pre_sig: "2",
      pred_pre: "+21000", flu_rt: "+2.29", acc_trde_qty: "48260", netprps_amt: "+4746",
      prev_netprps_amt: "0", buy_amt: "+5694", netprps_amt_irds: "+4746", buy_amt_irds: "+5694",
      sell_amt: "--948", sell_amt_irds: "+948", netprps_qty: "+5000",
      prev_pot_netprps_qty: "0", netprps_irds: "+5000", buy_qty: "+6000",
      buy_qty_irds: "+6000", sell_qty: "--1000", sell_qty_irds: "+1000",
    },
    {
      stk_cd: "009150_AL", stk_nm: "삼성전기", cur_prc: "-1124000", pre_sig: "5",
      pred_pre: "-57000", flu_rt: "-4.83", acc_trde_qty: "819676", netprps_amt: "--41690",
      prev_netprps_amt: "0", buy_amt: "+35400", netprps_amt_irds: "--41690",
      buy_amt_irds: "+35400", sell_amt: "--77090", sell_amt_irds: "+77090",
      netprps_qty: "--35000", prev_pot_netprps_qty: "0", netprps_irds: "--35000",
      buy_qty: "+30000", buy_qty_irds: "+30000", sell_qty: "--65000", sell_qty_irds: "+65000",
    },
  ],
});

const base: ForeignIntradayOptions = { market: "all", unit: "amount", direction: "buy" };

const rowsOf = (text: string): string[] =>
  text.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 순위") && !l.startsWith("|---"));

describe("formatForeignIntraday", () => {
  it("순매수 금액 내림차순으로 정렬한다", () => {
    const text = formatForeignIntraday(rows, base, 20, false, MODE);
    expect(rowsOf(text).map((l) => l.split(" | ")[1])).toEqual([
      "알테오젠",
      "한화에어로스페이스",
      "KR모터스",
      "삼성전자",
      "삼성전기",
    ]);
  });

  it("이중부호(--21796)를 음수로 읽는다", () => {
    const text = formatForeignIntraday(rows, base, 20, false, MODE);
    expect(text).toContain("-21,796");
    expect(text).not.toContain("--21,796");
    expect(text).not.toContain("21796");
  });

  it("direction=sell은 순매도 상위를 준다", () => {
    const text = formatForeignIntraday(rows, { ...base, direction: "sell" }, 20, false, MODE);
    const names = rowsOf(text).map((l) => l.split(" | ")[1]);
    expect(names[0]).toBe("삼성전기");
    expect(names[1]).toBe("삼성전자");
    expect(text).toContain("외국인 순매도 상위");
  });

  it("unit=quantity면 수량으로 정렬하고 표기한다", () => {
    const text = formatForeignIntraday(rows, { ...base, unit: "quantity" }, 20, false, MODE);
    // 수량 기준: 알테오젠 17,000 > 한화에어로 5,000 > KR모터스 −1,000 > 삼성전기 −35,000 > 삼성전자 −90,000
    expect(rowsOf(text).map((l) => l.split(" | ")[1])).toEqual([
      "알테오젠",
      "한화에어로스페이스",
      "KR모터스",
      "삼성전기",
      "삼성전자",
    ]);
    expect(text).toContain("단위 주");
    expect(text).toContain("순매수(주)");
  });

  it("금액 0과 결측을 구분한다", () => {
    const text = formatForeignIntraday(rows, base, 20, false, MODE);
    const kr = rowsOf(text).find((l) => l.includes("KR모터스"));
    // buy_amt "0" → "0"이지 "-"가 아니다 (백만원 미만이 반올림된 값).
    expect(kr?.split(" | ")[6]).toBe("0");
  });

  it("외국인 한정·1,000주 단위 잠정치임을 각주로 밝힌다", () => {
    const text = formatForeignIntraday(rows, base, 20, false, MODE);
    expect(text).toContain("외국인만");
    expect(text).toContain("1,000주 단위로 반올림");
    expect(text).toContain("get_net_buy_rank");
  });

  it("장 밖의 빈 결과는 오류가 아니라 안내다", () => {
    const text = formatForeignIntraday([], base, 20, false, MODE);
    expect(text).toContain("정규장(09:00~15:30)에만 산출");
    expect(text).toContain("get_net_buy_rank");
    expect(text).toContain(`[${MODE}]`);
  });
});
