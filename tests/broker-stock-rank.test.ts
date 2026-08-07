import { describe, expect, it } from "vitest";

import { brokerCodeListResponseSchema, brokerStockRankResponseSchema } from "../src/kiwoom/types.js";
import { formatBrokerStockRank } from "../src/tools/broker-activity.js";

const MODE = "실전투자";

/**
 * ka10038 실측 (REAL 2026-08-07 18:2x KST, 005930 / `qry_tp=3` 전체 / 배열 `stk_sec_rank`
 * 50행 / cont-yn=N). 50행 중 이 테스트가 쓰는 앞부분만 남겼다.
 *
 * 살려둔 것:
 *  - **`sell_qty`가 음수**로 온다(`-155993541`). 매도량인데 부호가 붙어 있어, 절대값으로
 *    바꾸면 순매매 = 매수 + 매도라는 관계가 깨진다.
 *  - **`acc_netprps_qty`의 이중부호** — 한화 행이 `--34274015`다(= -34,274,015).
 *    parseKiwoomNumber가 흡수하는 형태이고, 이게 깨지면 순매도가 양수로 렌더된다.
 *  - `mmcm_nm`의 **이중 공백**("한  화")은 ka10002·ka10102와 같은 원문 표기다.
 */
const { stk_sec_rank: rows } = brokerStockRankResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  rank_1: "+8928222154",
  rank_2: "-8930298714",
  rank_3: "+-2076560",
  prid_trde_qty: "8937714459",
  stk_sec_rank: [
    { rank: "1", mmcm_nm: "메리츠", buy_qty: "+187303751", sell_qty: "-155993541", acc_netprps_qty: "+31310210" },
    { rank: "2", mmcm_nm: "KB증권", buy_qty: "+717907379", sell_qty: "-687850356", acc_netprps_qty: "+30057023" },
    { rank: "3", mmcm_nm: "BNP파리바", buy_qty: "+45447210", sell_qty: "-30488385", acc_netprps_qty: "+14958825" },
    { rank: "4", mmcm_nm: "한  화", buy_qty: "+293810477", sell_qty: "-328084492", acc_netprps_qty: "--34274015" },
  ],
});

/** ka10102에서 이 테스트가 쓰는 행만. BNP파리바가 외국계(gb 1)다. */
const { list: brokerCodes } = brokerCodeListResponseSchema.parse({
  return_code: 0,
  return_msg: "정상",
  list: [
    { code: "008", name: "메리츠", gb: "0" },
    { code: "017", name: "KB증권", gb: "0" },
    { code: "036", name: "BNP파리바", gb: "1" },
    { code: "021", name: "한  화", gb: "0" },
  ],
});

describe("formatBrokerStockRank (ka10038)", () => {
  const out = formatBrokerStockRank(rows, "005930", "all", 20, MODE, brokerCodes);

  it("헤더에 종목·집합·개수를 낸다", () => {
    expect(out).toContain("[실전투자] 종목별 거래원 순위 — 종목 005930 (전체, 4/4개사)");
  });

  it("매도 수량의 음수 부호를 유지한다 (순매매 = 매수 + 매도라 절대값으로 바꾸면 관계가 깨진다)", () => {
    expect(out).toContain("| 메리츠 | 187,303,751 | -155,993,541 | +31,310,210 |");
  });

  // `--34274015`가 그대로 파싱되면 순매도가 +34,274,015로 렌더돼 방향이 뒤집힌다.
  it("이중부호 순매매를 음수로 읽는다", () => {
    expect(out).toContain("-34,274,015");
    expect(out).not.toContain("+34,274,015");
  });

  it("외국계 창구에 🌐를 붙이고 합계를 각주로 낸다", () => {
    expect(out).toContain("🌐 BNP파리바");
    expect(out).not.toContain("🌐 메리츠");
    // 외국계는 BNP파리바 한 곳뿐이라 합계가 그 행과 같다.
    expect(out).toContain("외국계 순매매 합은 +14,958,825주");
  });

  /**
   * `prid_trde_qty`(8,937,714,459)는 기간 정의를 확정하지 못해 스키마에 선언조차 하지 않았다.
   * 숫자가 표에 새어 나오면 사용자가 단위를 모르는 값을 읽게 된다.
   */
  it("기간 미확정 필드(prid_trde_qty)를 렌더하지 않고, 기간이 불명이라고 밝힌다", () => {
    expect(out).not.toContain("8,937,714,459");
    expect(out).not.toContain("8937714459");
    expect(out).toContain("**누적 기간**은 키움이 밝히지 않아");
  });

  it("top으로 자르면 몇 개사 중 몇 개인지 알린다", () => {
    const cut = formatBrokerStockRank(rows, "005930", "net_buy", 2, MODE, brokerCodes);
    expect(cut).toContain("(순매수, 2/4개사)");
    expect(cut).toContain("4개사 중 상위 2개만 표시했습니다");
    expect(cut).not.toContain("한  화");
  });

  it("거래원 코드표를 못 불러오면 이름만 그대로 낸다 (표는 그대로 나간다)", () => {
    const bare = formatBrokerStockRank(rows, "005930", "all", 20, MODE, undefined);
    expect(bare).toContain("BNP파리바");
    expect(bare).not.toContain("🌐");
    expect(bare).not.toContain("외국계 순매매 합");
  });

  it("빈 결과는 에러가 아니라 안내로 답한다", () => {
    const empty = formatBrokerStockRank([], "000000", "net_sell", 20, MODE, brokerCodes);
    expect(empty).toContain("거래원 순위가 없습니다");
    expect(empty).toContain("순매도");
    expect(empty).not.toContain("|");
  });
});
