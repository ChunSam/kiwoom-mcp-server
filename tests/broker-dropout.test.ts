import { describe, expect, it } from "vitest";

import { brokerCodeListResponseSchema, brokerDropoutResponseSchema } from "../src/kiwoom/types.js";
import { formatBrokerDropout } from "../src/tools/broker-activity.js";

const MODE = "실전투자";

/**
 * ka10053 실측 (REAL 2026-08-08, 005930 / 배열 `tdy_upper_scesn_ori` 8행 / cont-yn=N).
 * 마지막 행은 000660에서 딴 **한쪽만 채워진** 행이다 — 두 컬럼의 길이가 달라 실재한다.
 *
 * 살려둔 것:
 *  - **이름 앞의 `+`/`-`.** 외국계 표시이고 부호는 컬럼의 중복이다(10종목 62행 교차표에서
 *    매도 외국계 전부 `-`, 매수 외국계 전부 `+`, 국내 0건 — 예외 없음). 떼지 않으면 이름이
 *    ka10102와 안 맞아 🌐 판정이 통째로 실패한다.
 *  - **이름의 이중 공백**("한  화")은 ka10002·ka10102와 같은 원문 표기다.
 *  - **좌우가 짝이 아니다** — 3행은 매도 13:05:35 / 매수 09:30:28로 순서가 뒤집혀 있다.
 */
const { tdy_upper_scesn_ori: rows } = brokerDropoutResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  tdy_upper_scesn_ori: [
    {
      sel_scesn_tm: "152031", sell_qty: "1379948", sel_upper_scesn_ori: "-골드만삭스",
      buy_scesn_tm: "132308", buy_qty: "891599", buy_upper_scesn_ori: "+JP모간서울",
      qry_dt: "045", qry_tm: "033",
    },
    {
      sel_scesn_tm: "131542", sell_qty: "869555", sel_upper_scesn_ori: "-메릴린치",
      buy_scesn_tm: "112344", buy_qty: "669277", buy_upper_scesn_ori: "키움증권",
      qry_dt: "044", qry_tm: "050",
    },
    {
      sel_scesn_tm: "130535", sell_qty: "822845", sel_upper_scesn_ori: "한  화",
      buy_scesn_tm: "093028", buy_qty: "334320", buy_upper_scesn_ori: "+골드만삭스",
      qry_dt: "021", qry_tm: "045",
    },
    {
      sel_scesn_tm: "", sell_qty: "", sel_upper_scesn_ori: "",
      buy_scesn_tm: "092026", buy_qty: "33754", buy_upper_scesn_ori: "+유비에스증권",
      qry_dt: "", qry_tm: "043",
    },
  ],
});

/** ka10102에서 이 테스트가 쓰는 행만. 이름 표기는 원문 그대로다. */
const { list: brokerCodes } = brokerCodeListResponseSchema.parse({
  return_code: 0,
  return_msg: "정상",
  list: [
    { code: "021", name: "한  화", gb: "0" },
    { code: "033", name: "JP모간서울", gb: "1" },
    { code: "043", name: "유비에스증권", gb: "1" },
    { code: "044", name: "메릴린치", gb: "1" },
    { code: "045", name: "골드만삭스", gb: "1" },
    { code: "050", name: "키움증권", gb: "0" },
  ],
});

describe("formatBrokerDropout (ka10053)", () => {
  const out = formatBrokerDropout(rows, "005930", MODE, brokerCodes);

  /**
   * **행 수 ≠ 건수.** 좌우가 독립 목록이라 4행에 매도 3건 + 매수 4건이 들어 있다
   * (마지막 행은 매수만 있다). 행 수를 "4건"으로 내면 매수 이탈 하나가 사라진 것처럼 읽힌다.
   */
  it("헤더에 매도·매수 이탈 건수를 따로 낸다 (행 수가 아니라)", () => {
    expect(out).toContain("[실전투자] 005930 당일 상위 거래원 이탈 — 매도 3건 · 매수 4건");
  });

  /**
   * 접두사를 그대로 두면 "-골드만삭스"가 ka10102의 "골드만삭스"와 안 맞아 🌐가 안 붙는다.
   * 표에 부호가 그대로 나가면 수량이 음수라는 오해도 생긴다.
   */
  it("이름 앞의 +/- 를 떼고 외국계에 🌐를 붙인다", () => {
    expect(out).toContain("| 골드만삭스 🌐 |");
    expect(out).toContain("JP모간서울 🌐");
    expect(out).not.toContain("-골드만삭스");
    expect(out).not.toContain("+JP모간서울");
  });

  it("국내 창구에는 🌐를 붙이지 않고 이중 공백을 보존한다", () => {
    expect(out).toContain("| 한  화 |");
    expect(out).not.toContain("한  화 🌐");
    expect(out).not.toContain("키움증권 🌐");
  });

  it("HHMMSS를 시:분:초로 편다", () => {
    expect(out).toContain("15:20:31");
    expect(out).toContain("09:30:28");
  });

  // 두 컬럼의 길이가 달라 한쪽만 채워진 행이 실재한다 — 빈 쪽을 0이 아니라 "-"로 낸다.
  it("한쪽만 있는 행의 빈 쪽을 '-'로 낸다", () => {
    expect(out).toContain("| - | - | - | 유비에스증권 🌐 | 09:20:26 | 33,754 |");
  });

  /** 좌우를 짝지어 읽으면 "골드만삭스가 팔고 JP모간이 샀다"는 없는 이야기가 만들어진다. */
  it("좌우가 별개 목록이라고 각주로 못박는다", () => {
    expect(out).toContain("좌우 두 칸은 서로 다른 사건입니다");
    expect(out).toContain("짝지어 읽으면 안 됩니다");
  });

  it("거래원 코드표를 못 불러오면 이름만 그대로 낸다", () => {
    const bare = formatBrokerDropout(rows, "005930", MODE, undefined);
    expect(bare).toContain("골드만삭스");
    expect(bare).not.toContain("🌐");
    // 접두사 제거는 코드표와 무관하게 항상 해야 한다.
    expect(bare).not.toContain("-골드만삭스");
  });

  it("빈 결과는 에러가 아니라 원인 힌트를 준다", () => {
    const empty = formatBrokerDropout([], "005930", MODE, brokerCodes);
    expect(empty).toContain("당일 거래원 이탈 내역이 없습니다");
    expect(empty).toContain("상위 거래원이 바뀌지 않았거나");
    expect(empty).not.toContain("|");
  });
});
