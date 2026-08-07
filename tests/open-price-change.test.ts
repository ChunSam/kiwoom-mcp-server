import { describe, expect, it } from "vitest";

import { openPriceChangeItemSchema } from "../src/kiwoom/types.js";
import { formatRanking } from "../src/tools/ranking.js";

const MODE = "실전투자";

/**
 * ka10028 실측 (REAL 2026-08-04 15:2x KST 정규장, mrkt_tp=001 코스피 /
 * trde_qty_cnd=0100(10만주) / stex_tp=3). 1페이지 100행에서 시가대비 상·하위를 고른 5행.
 *
 * 살려둔 것:
 *  - **삼화콘덴서**가 이 tool의 존재 이유다 — `flu_rt` +4.16%(전일 대비 상승)인데
 *    `open_pric_pre` −2.27%(시가 대비 하락)다. 갭 상승 후 밀린 종목은 두 지표의 부호가
 *    갈리고, 기존 rise/fall 순위로는 이 구분이 안 보인다.
 *  - 원본은 **종목코드 순**이고 `sort_tp`가 무효라, 정렬은 포맷터가 한다. 여기 배열도
 *    일부러 코드순(000210 → 005090)으로 넣어 정렬이 실제로 도는지 본다.
 *  - `low_pric`이 `-45500`처럼 부호를 달고 온다(값이 아니라 전일대비 방향) — 시가·저가는
 *    parseKiwoomPrice로 읽어야 한다.
 *  - `cntr_str`는 체결강도로 76.66~181.59가 실측 범위다.
 */
const items = [
  {
    stk_cd: "000210_AL", stk_nm: "DL", cur_prc: "+51800", pred_pre_sig: "2", pred_pre: "+5850",
    flu_rt: "+12.73", open_pric: "+47050", high_pric: "+52300", low_pric: "-45500",
    open_pric_pre: "+10.10", now_trde_qty: "313642", cntr_str: "181.59",
  },
  {
    stk_cd: "001820_AL", stk_nm: "삼화콘덴서", cur_prc: "+77600", pred_pre_sig: "2",
    pred_pre: "+3100", flu_rt: "+4.16", open_pric: "+79400", high_pric: "+79400",
    low_pric: "-74000", open_pric_pre: "-2.27", now_trde_qty: "328064", cntr_str: "98.03",
  },
  {
    stk_cd: "002700_AL", stk_nm: "신일전자", cur_prc: "-1101", pred_pre_sig: "5", pred_pre: "-3",
    flu_rt: "-0.27", open_pric: "+1139", high_pric: "+1144", low_pric: "-1086",
    open_pric_pre: "-3.34", now_trde_qty: "2502841", cntr_str: "76.66",
  },
  {
    stk_cd: "004060_AL", stk_nm: "SG세계물산", cur_prc: "+2595", pred_pre_sig: "2",
    pred_pre: "+290", flu_rt: "+12.58", open_pric: "+2360", high_pric: "+2750",
    low_pric: "+2355", open_pric_pre: "+9.96", now_trde_qty: "472886", cntr_str: "97.64",
  },
  {
    stk_cd: "005090_AL", stk_nm: "SGC에너지", cur_prc: "+50800", pred_pre_sig: "2",
    pred_pre: "+6600", flu_rt: "+14.93", open_pric: "+45100", high_pric: "+53500",
    low_pric: "+44250", open_pric_pre: "+12.64", now_trde_qty: "521554", cntr_str: "112.30",
  },
].map((i) => openPriceChangeItemSchema.parse(i));

describe("formatRanking — open_rise / open_fall (ka10028)", () => {
  it("시가대비 등락률 내림차순으로 정렬한다 (코드순 응답을 서버가 다시 세운다)", () => {
    const text = formatRanking("open_rise", "kospi", items, 20, MODE, { minVolume: "0100" });

    expect(text).toContain("코스피 시가대비 상승률 상위, 거래량 10만주 이상 (상위 5종목)");
    expect(text).toContain("| 1 | SGC에너지 | 005090 | 50,800 | +14.93% | 45,100 | +12.64% | 521,554 | 112.3 |");
    expect(text.indexOf("SGC에너지")).toBeLessThan(text.indexOf("| 2 | DL |"));
    expect(text.indexOf("| 2 | DL |")).toBeLessThan(text.indexOf("SG세계물산"));
  });

  it("open_fall은 같은 데이터를 오름차순으로 뒤집는다", () => {
    const text = formatRanking("open_fall", "kospi", items, 20, MODE, { minVolume: "0100" });

    expect(text).toContain("코스피 시가대비 하락률 상위");
    expect(text).toContain("| 1 | 신일전자 | 002700 |"); // -3.34%
    expect(text.indexOf("신일전자")).toBeLessThan(text.indexOf("삼화콘덴서")); // -3.34% < -2.27%
  });

  it("전일 대비와 시가 대비의 부호가 갈리는 종목을 그대로 드러낸다", () => {
    // 삼화콘덴서: 전일 대비 +4.16%인데 시가 대비 -2.27% — 갭 상승 후 밀린 종목
    const text = formatRanking("open_fall", "kospi", items, 20, MODE);

    expect(text).toContain("| 2 | 삼화콘덴서 | 001820 | 77,600 | +4.16% | 79,400 | -2.27% | 328,064 | 98.03 |");
    expect(text).toContain("갭 상승 후 밀린 종목은 등락률이 +인데 시가대비는 −입니다");
  });

  it("체결강도 각주와 인접 tool을 함께 안내한다", () => {
    const text = formatRanking("open_rise", "kosdaq", items, 3, MODE);

    expect(text).toContain("체결강도 = 매수 체결량 ÷ 매도 체결량 × 100");
    expect(text).toContain("get_execution_strength");
    expect(text).toContain("거래량 1만주 이상"); // minVolume 미지정 시 기본값 라벨
  });

  // ka10028은 종목코드 순 전량 스냅샷이고 정렬은 포맷터가 한다 — 상한에 걸리면 표의 꼬리가
  // 아니라 정렬 모수가 빠지므로, "뒤가 잘렸다"로 읽히면 상위권이 틀렸다는 사실이 가려진다.
  it("페이지 상한에 걸리면 뒤가 잘린 게 아니라 일부 종목이 빠졌다고 알린다", () => {
    const text = formatRanking("open_rise", "kospi", items, 20, MODE, { truncated: true });

    expect(text).toContain("일부 종목이 빠졌습니다");
    expect(text).toContain("종목코드 순으로 오기 때문에");
    expect(text).toContain("min_volume");
    expect(text).not.toContain("결과가 잘렸을 수 있습니다");
  });

  it("빈 결과는 에러가 아니라 안내로 답한다", () => {
    const text = formatRanking("open_rise", "kospi", [], 20, MODE, { minVolume: "0500" });

    expect(text).toContain("거래량 50만주 이상 데이터가 없습니다");
  });
});
