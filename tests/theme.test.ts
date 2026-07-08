import { describe, expect, it } from "vitest";

import { themeGroupItemSchema, themeStocksResponseSchema } from "../src/kiwoom/types.js";
import { formatThemeGroups, formatThemeStocks } from "../src/tools/theme.js";

const MODE = "실전투자";

// Fixtures are verbatim rows from the live REAL probe (2026-07-07, ka90001/ka90002).
const ka90001Groups = [
  {
    thema_grp_cd: "242",
    thema_nm: "자동차_블랙박스관련주",
    stk_num: "3",
    flu_sig: "2",
    flu_rt: "+0.52",
    rising_stk_num: "2",
    fall_stk_num: "1",
    dt_prft_rt: "+116.05",
    main_stk: "팅크웨어, DH오토웨어",
  },
  {
    thema_grp_cd: "280",
    thema_nm: "미디어_방송광고",
    stk_num: "7",
    flu_sig: "5",
    flu_rt: "-3.26",
    rising_stk_num: "1",
    fall_stk_num: "5",
    dt_prft_rt: "+35.29",
    main_stk: "제일기획, KNN",
  },
].map((g) => themeGroupItemSchema.parse(g));

const ka90002Response = themeStocksResponseSchema.parse({
  return_code: 0,
  return_msg: "정상적으로 처리되었습니다",
  flu_rt: "+0.52",
  dt_prft_rt: "+116.05",
  thema_comp_stk: [
    {
      stk_cd: "084730",
      stk_nm: "팅크웨어",
      cur_prc: "+6200",
      flu_sig: "2",
      pred_pre: "+140",
      flu_rt: "+2.31",
      acc_trde_qty: "19121",
      sel_bid: "+6200",
      sel_req: "103",
      buy_bid: "+6150",
      buy_req: "20",
      dt_prft_rt_n: "+1.64",
    },
    {
      stk_cd: "025440",
      stk_nm: "DH오토웨어",
      cur_prc: "+3315",
      flu_sig: "2",
      pred_pre: "+15",
      flu_rt: "+0.45",
      acc_trde_qty: "15243",
      sel_bid: "+3315",
      sel_req: "1",
      buy_bid: "-3295",
      buy_req: "17",
      dt_prft_rt_n: "-0.15",
    },
  ],
});

describe("formatThemeGroups", () => {
  it("renders a row per theme with parsed rates and 상승/하락 counts", () => {
    const text = formatThemeGroups(ka90001Groups, MODE, { limit: 30 });
    expect(text).toContain("등락률 상위 2개");
    expect(text).toContain("| 자동차_블랙박스관련주 | 242 | 3 | +0.52% | 2/1 | +116.05% | 팅크웨어, DH오토웨어 |");
    expect(text).toContain("| 미디어_방송광고 | 280 | 7 | -3.26% | 1/5 | +35.29% | 제일기획, KNN |");
  });

  it("uses a stock-scoped heading and shows all rows when a stock code is given", () => {
    const text = formatThemeGroups(ka90001Groups, MODE, { stockCode: "005930", limit: 30 });
    expect(text).toContain("종목 005930 편입 테마 (2개)");
  });

  it("caps the all-themes view at limit and notes the truncation", () => {
    const text = formatThemeGroups(ka90001Groups, MODE, { limit: 1 });
    expect(text).toContain("자동차_블랙박스관련주");
    expect(text).not.toContain("미디어_방송광고");
    expect(text).toContain("상위 1개만 표시");
  });

  it("reports empty results (with and without a stock code)", () => {
    expect(formatThemeGroups([], MODE, { limit: 30 })).toContain("찾을 수 없습니다");
    expect(formatThemeGroups([], MODE, { stockCode: "005930", limit: 30 })).toContain(
      "편입된 테마가 없습니다",
    );
  });
});

describe("formatThemeStocks", () => {
  it("renders member stocks with the theme aggregate header", () => {
    const text = formatThemeStocks(ka90002Response, "242", MODE);
    expect(text).toContain("테마 구성종목 (코드 242, 2종목)");
    expect(text).toContain("테마 등락률 +0.52% · 기간수익률 +116.05%");
    expect(text).toContain("| 팅크웨어 (084730) | 6,200원 | +140원 | +2.31% | 19,121주 | +1.64% |");
    expect(text).toContain("| DH오토웨어 (025440) | 3,315원 | +15원 | +0.45% | 15,243주 | -0.15% |");
  });

  it("reports an empty theme", () => {
    const empty = themeStocksResponseSchema.parse({ return_code: 0 });
    expect(formatThemeStocks(empty, "999", MODE)).toContain("구성종목이 없습니다");
  });
});
