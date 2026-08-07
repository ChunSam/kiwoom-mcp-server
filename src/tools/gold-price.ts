import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import {
  fetchGoldContracts,
  fetchGoldDaily,
  GOLD_INSTRUMENTS,
  type GoldInstrument,
} from "../kiwoom/api.js";
import type { GoldContractItem, GoldDailyItem } from "../kiwoom/types.js";
import { formatDateDashed, todayInKst } from "../utils/date.js";
import {
  formatKRW,
  formatNumber,
  formatPercent,
  formatSigned,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const DEFAULT_ROWS = 20;
const MAX_ROWS = 30;
const DEFAULT_INSTRUMENT: GoldInstrument = "1kg";

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;

function formatTime(raw: string): string {
  return raw.length === 6 ? `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}` : raw;
}

/**
 * 체결량 `cntr_trde_qty`에는 `+463`·`-2`처럼 **체결 방향** 부호가 붙는다(실측 2026-08-04).
 * 수량 자체는 절대값이므로 부호는 매수/매도 표시로만 쓰고 크기는 절대값으로 읽는다.
 */
function contractSide(raw: string): string {
  if (raw.startsWith("+")) return "매수";
  if (raw.startsWith("-")) return "매도";
  return "-";
}

export function formatGoldTicks(
  items: GoldContractItem[],
  instrument: GoldInstrument,
  rows: number,
  modeLabel: string,
): string {
  const { label } = GOLD_INSTRUMENTS[instrument];
  const [latest] = items;
  if (!latest) {
    return (
      `[${modeLabel}] KRX 금현물 체결 — ${label}: 체결 내역이 없습니다.\n` +
      "※ 금시장 정규장은 09:00~15:30입니다 — 개장 전이면 당일 체결이 아직 없습니다."
    );
  }

  const shown = items.slice(0, rows);
  const price = parseKiwoomPrice(latest.cntr_pric);
  const lines = [
    `[${modeLabel}] KRX 금현물 체결 — ${label}`,
    "",
    // `pred_pre`(전일대비)는 부호가 곧 값의 부호다 — 가격 필드가 아니므로 `parseKiwoomPrice`
    // (절대값)를 쓰면 안 된다. 하락일에 전일대비만 `+`로 뒤집혀 등락률과 모순됐다.
    `현재가 **${formatKRW(price)}/g** (${formatSigned(parseKiwoomNumber(latest.pred_pre))}, ` +
      `${formatPercent(parseKiwoomNumber(latest.flu_rt))}) · ` +
      `누적 거래량 ${formatNumber(parseKiwoomNumber(latest.trde_qty))}g · ` +
      `누적 거래대금 ${formatKRW(parseKiwoomNumber(latest.acc_trde_prica))} · ` +
      `체결강도 ${formatNumber(parseKiwoomNumber(latest.cntr_str))}`,
    "",
    "| 시각 | 체결가 | 체결량(g) | 구분 | 최우선 매도 | 최우선 매수 |",
    "|---|---:|---:|---|---:|---:|",
  ];
  shown.forEach((item) => {
    const qty = parseKiwoomNumber(item.cntr_trde_qty);
    lines.push(
      row([
        formatTime(item.tm),
        formatKRW(parseKiwoomPrice(item.cntr_pric)),
        formatNumber(qty === null ? null : Math.abs(qty)),
        contractSide(item.cntr_trde_qty),
        formatKRW(parseKiwoomPrice(item.pri_sel_bid_unit)),
        formatKRW(parseKiwoomPrice(item.pri_buy_bid_unit)),
      ]),
    );
  });
  lines.push(
    "",
    `※ 최신 체결이 위입니다 (${shown.length}건). 가격은 **g당 원**이고 거래량 단위는 g입니다. ` +
      "체결량의 매수/매도는 체결 방향이며 수량은 절대값입니다.",
    "※ 금시장은 KRX 단독이라 통합(NXT) 기준이 적용되지 않습니다 — 주식 tool의 거래량과 기준이 다릅니다.",
  );
  return lines.join("\n");
}

export function formatGoldDaily(
  items: GoldDailyItem[],
  instrument: GoldInstrument,
  rows: number,
  modeLabel: string,
): string {
  const { label } = GOLD_INSTRUMENTS[instrument];
  const [latest] = items;
  if (!latest) {
    return (
      `[${modeLabel}] KRX 금현물 일별추이 — ${label}: 데이터가 없습니다.\n` +
      "※ 기준일이 휴장일이면 빈 결과가 옵니다 — 직전 거래일로 다시 조회해 보세요."
    );
  }

  const shown = items.slice(0, rows);
  const lines = [
    `[${modeLabel}] KRX 금현물 일별추이 — ${label}`,
    "",
    `최근 종가 **${formatKRW(parseKiwoomPrice(latest.cur_prc))}/g** ` +
      // 전일대비는 부호가 값의 부호 — 위 formatGoldTicks와 같은 이유로 parseKiwoomNumber.
      `(${formatSigned(parseKiwoomNumber(latest.pred_pre))}, ${formatPercent(parseKiwoomNumber(latest.flu_rt))}) ` +
      `· ${formatDateDashed(latest.dt)}`,
    "",
    "| 일자 | 종가 | 등락률 | 시가 | 고가 | 저가 | 거래량(g) | 거래대금(백만) | 기관 | 개인 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  shown.forEach((item) => {
    lines.push(
      row([
        formatDateDashed(item.dt),
        formatKRW(parseKiwoomPrice(item.cur_prc)),
        formatPercent(parseKiwoomNumber(item.flu_rt)),
        formatKRW(parseKiwoomPrice(item.open_pric)),
        formatKRW(parseKiwoomPrice(item.high_pric)),
        formatKRW(parseKiwoomPrice(item.low_pric)),
        formatNumber(parseKiwoomNumber(item.trde_qty)),
        formatNumber(parseKiwoomNumber(item.acc_trde_prica)),
        formatSigned(parseKiwoomNumber(item.orgn_netprps)),
        formatSigned(parseKiwoomNumber(item.ind_netprps)),
      ]),
    );
  });
  lines.push(
    "",
    `※ 최신 일자가 위입니다 (${shown.length}일). 가격은 **g당 원**, 거래대금은 **백만원**입니다 ` +
      "(ticks 모드의 누적 거래대금은 원 단위라 자릿수가 다릅니다).",
    "※ 순매수는 기관·개인만 표시합니다 — 외국인(`for_netprps`) 컬럼은 실측 전 구간이 0이라 " +
      "값이 없는 것인지 미제공인지 확정하지 못했습니다.",
    "※ 금시장은 KRX 단독이라 통합(NXT) 기준이 적용되지 않습니다.",
  );
  return lines.join("\n");
}

export function registerGoldPriceTool(server: McpServer): void {
  server.registerTool(
    "get_gold_price",
    {
      title: "KRX 금현물 시세 조회",
      description:
        "KRX 금시장(금현물) 시세를 조회합니다 (키움 ka50010/ka50012). " +
        "instrument: 1kg(금 99.99_1Kg, 기본)/100g(미니금 99.99_100g) — 상장 종목은 이 둘뿐입니다. " +
        "mode: daily(일별추이 + 기관·개인 순매수, 기본)/ticks(당일 틱 체결 + 체결강도·최우선호가). " +
        "금 실물 가격(g당 원)을 볼 때 쓰며, 금 ETF·ETN은 종목이므로 get_stock_price를 쓰세요. " +
        "종목코드는 입력하지 않습니다 — 금현물에는 종목 마스터가 없어 search_stock으로 찾을 수 없습니다.",
      inputSchema: {
        instrument: z
          .enum(["1kg", "100g"])
          .optional()
          .describe(`금현물 종목 (기본값 ${DEFAULT_INSTRUMENT})`),
        mode: z
          .enum(["daily", "ticks"])
          .optional()
          .describe("daily=일별추이(기본), ticks=당일 틱 체결"),
        base_date: z
          .string()
          .regex(/^\d{8}$/)
          .optional()
          .describe("일별추이 기준일 yyyyMMdd — daily 모드에서만 사용 (기본값: 오늘)"),
        rows: z
          .number()
          .int()
          .min(1)
          .max(MAX_ROWS)
          .optional()
          .describe(`표시할 행 수 (기본값 ${DEFAULT_ROWS}, 최대 ${MAX_ROWS})`),
      },
    },
    async ({ instrument, mode, base_date, rows }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        const target: GoldInstrument = instrument ?? DEFAULT_INSTRUMENT;
        const count = rows ?? DEFAULT_ROWS;

        if (mode === "ticks") {
          const items = await fetchGoldContracts(client, target);
          return textResult(formatGoldTicks(items, target, count, config.modeLabel));
        }

        const items = await fetchGoldDaily(client, target, base_date ?? todayInKst());
        return textResult(formatGoldDaily(items, target, count, config.modeLabel));
      }),
  );
}
