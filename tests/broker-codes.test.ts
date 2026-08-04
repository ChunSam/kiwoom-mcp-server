import { describe, expect, it } from "vitest";

import { brokerIndexByName, isForeignBroker } from "../src/kiwoom/broker-list.js";
import { brokerActivityResponseSchema, brokerCodeListResponseSchema } from "../src/kiwoom/types.js";
import { formatBrokerActivity } from "../src/tools/broker-activity.js";

const MODE = "실전투자";

/**
 * ka10102 실측 (REAL 2026-08-04, 파라미터 없음 / 배열 `list` 73행 / cont-yn=N).
 * VIRTUAL도 완전히 같은 표를 준다. 73행 중 이 테스트가 쓰는 행만 남겼다.
 *
 * 살려둔 것:
 *  - **이름의 이중 공백** — "삼  성"·"H S B C"가 원문 그대로다. ka10002도 같은 표기로
 *    주기 때문에 그대로 둬야 이름 결합이 성립한다(정규화하면 오히려 깨진다).
 *  - **"미래에셋" 중복** — 005(gb 0, 현행)와 049(gb 2, 옛 거래원)가 둘 다 있다. 표에서
 *    049가 005보다 뒤에 오므로, 나중 행이 이기는 순진한 Map 구성은 폐지 코드를 남긴다.
 *  - 800번대(802 BTI증권 등)는 전부 gb 2다.
 */
const { list: brokerCodes } = brokerCodeListResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  list: [
    { code: "003", name: "한국투자증권", gb: "0" },
    { code: "005", name: "미래에셋", gb: "0" },
    { code: "017", name: "KB증권", gb: "0" },
    { code: "030", name: "삼  성", gb: "0" },
    { code: "033", name: "JP모간서울", gb: "1" },
    { code: "040", name: "H S B C", gb: "1" },
    { code: "045", name: "골드만삭스", gb: "1" },
    { code: "049", name: "미래에셋", gb: "2" },
    { code: "050", name: "키움증권", gb: "0" },
    { code: "086", name: "BNK증권", gb: "0" },
    { code: "802", name: "BTI증권", gb: "2" },
  ],
});

describe("brokerIndexByName", () => {
  it("이름으로 코드표 행을 찾는다 (공백이 낀 이름 그대로)", () => {
    const index = brokerIndexByName(brokerCodes);

    expect(index.get("삼  성")?.code).toBe("030");
    expect(index.get("H S B C")?.code).toBe("040");
    expect(index.size).toBe(10); // 11행 − 중복 "미래에셋" 1
  });

  it("이름이 겹치면 옛 거래원(gb=2)이 아니라 현행 코드를 남긴다", () => {
    // 표에서 049(gb 2)가 005(gb 0)보다 뒤에 온다 — 나중 행이 이기면 폐지 코드가 남는다
    const index = brokerIndexByName(brokerCodes);

    expect(index.get("미래에셋")?.code).toBe("005");
    expect(index.get("미래에셋")?.gb).toBe("0");
  });

  it("gb=1만 외국계로 본다 — 모르는 이름은 외국계가 아니다", () => {
    const index = brokerIndexByName(brokerCodes);

    expect(isForeignBroker(index, "골드만삭스")).toBe(true);
    expect(isForeignBroker(index, "JP모간서울")).toBe(true);
    expect(isForeignBroker(index, "키움증권")).toBe(false);
    expect(isForeignBroker(index, "BTI증권")).toBe(false); // gb=2
    expect(isForeignBroker(index, "듣도보도못한증권")).toBe(false);
  });
});

/** ka10002 실측 fixture (mock 2026-07-10) — JP모간서울이 매수3·매도5에 들어 있다. */
const activity = brokerActivityResponseSchema.parse({
  stk_cd: "005930",
  stk_nm: "삼성전자",
  cur_prc: "+296000",
  flu_rt: "+6.47",
  sel_trde_ori_nm_1: "삼  성",
  sel_trde_qty_1: "-1725746",
  buy_trde_ori_nm_1: "KB증권",
  buy_trde_qty_1: "+1323258",
  sel_trde_ori_nm_2: "키움증권",
  sel_trde_qty_2: "-1317620",
  buy_trde_ori_nm_2: "BNK증권",
  buy_trde_qty_2: "+1278441",
  sel_trde_ori_nm_3: "BNK증권",
  sel_trde_qty_3: "-1219839",
  buy_trde_ori_nm_3: "JP모간서울",
  buy_trde_qty_3: "+1139224",
  sel_trde_ori_nm_4: "KB증권",
  sel_trde_qty_4: "-1105920",
  buy_trde_ori_nm_4: "삼  성",
  buy_trde_qty_4: "+925386",
  sel_trde_ori_nm_5: "JP모간서울",
  sel_trde_qty_5: "-915820",
  buy_trde_ori_nm_5: "한국투자증권",
  buy_trde_qty_5: "+919016",
});

describe("formatBrokerActivity — 외국계 표시", () => {
  it("외국계 창구에만 표시를 붙인다", () => {
    const text = formatBrokerActivity(activity, "005930", MODE, brokerCodes);

    expect(text).toContain("| 3 | JP모간서울 🌐 | 1,139,224 | BNK증권 | 1,219,839 |");
    expect(text).toContain("| 1 | KB증권 | 1,323,258 | 삼  성 | 1,725,746 |");
    expect(text).not.toContain("KB증권 🌐");
  });

  it("표 안의 외국계 물량만 합산하고, 순매수로 읽지 말라고 못을 박는다", () => {
    const text = formatBrokerActivity(activity, "005930", MODE, brokerCodes);

    expect(text).toContain("매수 1,139,224주 / 매도 915,820주"); // JP모간서울 한 곳씩
    expect(text).toContain("외국인 순매수로 읽지 마세요");
    expect(text).toContain("get_foreign_intraday");
  });

  it("코드표를 못 불러오면 표시 없이 기존 출력 그대로 낸다", () => {
    // loadBrokerCodes 실패는 조용히 삼키고 거래원 표는 나가야 한다
    const text = formatBrokerActivity(activity, "005930", MODE);

    expect(text).toContain("| 3 | JP모간서울 | 1,139,224 | BNK증권 | 1,219,839 |");
    expect(text).not.toContain("🌐");
    expect(text).toContain("KRX 기준");
  });

  it("거래원이 없으면 코드표가 있어도 안내만 낸다", () => {
    const empty = brokerActivityResponseSchema.parse({ stk_cd: "999999" });
    const text = formatBrokerActivity(empty, "999999", MODE, brokerCodes);

    expect(text).toContain("거래원 정보가 없습니다");
    expect(text).not.toContain("🌐");
  });
});
