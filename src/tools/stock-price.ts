import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getKiwoomContext } from "../context.js";
import { fetchStockInfo } from "../kiwoom/api.js";
import { loadMasterList, masterItemWarnings } from "../kiwoom/master-list.js";
import type { StockInfoResponse, StockListItem } from "../kiwoom/types.js";
import { formatDateDashed } from "../utils/date.js";
import {
  formatKRW,
  formatPercent,
  parseKiwoomNumber,
  parseKiwoomPrice,
} from "../utils/num.js";
import { runTool, textResult } from "./helpers.js";

const PRE_SIG_LABELS: Record<string, string> = {
  "1": "상한",
  "2": "상승",
  "3": "보합",
  "4": "하한",
  "5": "하락",
};

export function formatStockInfo(
  info: StockInfoResponse,
  modeLabel: string,
  master?: StockListItem,
): string {
  const cur = parseKiwoomPrice(info.cur_prc);
  const change = parseKiwoomNumber(info.pred_pre);
  const fluRt = parseKiwoomNumber(info.flu_rt);
  const volume = parseKiwoomNumber(info.trde_qty);
  const sigLabel = PRE_SIG_LABELS[info.pre_sig] ?? "";

  const changeText =
    change === null
      ? "-"
      : `${sigLabel ? `${sigLabel} ` : ""}${formatKRW(Math.abs(change))} (${formatPercent(fluRt)})`.trim();

  const lines = [
    `[${modeLabel}] ${info.stk_nm} (${info.stk_cd}) 시세`,
    "",
    `- 현재가: ${formatKRW(cur)}`,
    `- 전일대비: ${changeText}`,
    `- 기준가(전일종가): ${formatKRW(parseKiwoomPrice(info.base_pric))}`,
    `- 시가/고가/저가: ${formatKRW(parseKiwoomPrice(info.open_pric))} / ${formatKRW(parseKiwoomPrice(info.high_pric))} / ${formatKRW(parseKiwoomPrice(info.low_pric))}`,
    `- 거래량: ${volume === null ? "-" : `${volume.toLocaleString("ko-KR")}주`}`,
    `- 250일 최고/최저: ${formatKRW(parseKiwoomPrice(info["250hgst"]))} / ${formatKRW(parseKiwoomPrice(info["250lwst"]))}`,
  ];

  const per = parseKiwoomNumber(info.per);
  const eps = parseKiwoomNumber(info.eps);
  const pbr = parseKiwoomNumber(info.pbr);
  const mac = parseKiwoomNumber(info.mac);
  const fundamentals: string[] = [];
  if (per !== null) fundamentals.push(`PER ${per}`);
  if (eps !== null) fundamentals.push(`EPS ${formatKRW(eps)}`);
  if (pbr !== null) fundamentals.push(`PBR ${pbr}`);
  if (mac !== null) fundamentals.push(`시가총액 ${mac.toLocaleString("ko-KR")}억원`);
  if (fundamentals.length > 0) {
    lines.push(`- ${fundamentals.join(" / ")}`);
  }

  // ka10099 마스터 캐시에서 얻는 부가 정보 — 조회 실패 시 이 블록만 조용히 빠진다.
  if (master) {
    const marketParts = [master.marketName, master.upName].filter(Boolean).join(" · ");
    const sizeClass = [master.upSizeName, master.companyClassName].filter(Boolean).join(", ");
    if (marketParts) {
      lines.push(`- 시장/업종: ${marketParts}${sizeClass ? ` (${sizeClass})` : ""}`);
    }
    if (/^\d{8}$/.test(master.regDay)) {
      lines.push(`- 상장일: ${formatDateDashed(master.regDay)}`);
    }
    const warnings = masterItemWarnings(master);
    if (warnings.length > 0) {
      lines.push(`- ⚠️ 투자유의: ${warnings.join(" · ")}`);
    }
  }

  return lines.join("\n");
}

export function registerStockPriceTool(server: McpServer): void {
  server.registerTool(
    "get_stock_price",
    {
      title: "종목 현재가 조회",
      description:
        "6자리 종목코드로 국내 주식/ETF의 현재가, 등락률, 거래량, 기본 지표를 조회합니다 (키움 ka10001). " +
        "업종·상장일과 거래정지/관리종목/투자경고 같은 투자유의 상태도 함께 표시됩니다. " +
        "종목명만 알고 있다면 search_stock으로 먼저 코드를 찾으세요.",
      inputSchema: {
        stock_code: z
          .string()
          .regex(/^\d{6}$/, "6자리 숫자 종목코드여야 합니다 (예: 005930)")
          .describe("6자리 종목코드 (예: 삼성전자 005930, KODEX 200 069500)"),
      },
    },
    async ({ stock_code }) =>
      runTool(async () => {
        const { client, config } = getKiwoomContext();
        // 마스터 조회는 best-effort 부가정보 — 실패해도 시세 응답은 그대로 나간다.
        // 캐시가 따뜻하면 추가 API 콜 없음(12h TTL), 콜드면 ka10099 2콜이 병렬로 얹힌다.
        const [info, master] = await Promise.all([
          fetchStockInfo(client, stock_code),
          loadMasterList(client)
            .then((items) => items.find((i) => i.code === stock_code))
            .catch(() => undefined),
        ]);
        return textResult(formatStockInfo(info, config.modeLabel, master));
      }),
  );
}
