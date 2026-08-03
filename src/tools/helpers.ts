import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * 거래량·거래대금 계열 수치가 KRX 단독이 아니라 통합(KRX + 넥스트레이드) 기준임을 밝히는
 * 각주. v0.31.0에서 서버가 모든 시세·랭킹 TR을 통합으로 부르기 시작하면서 필요해졌다 —
 * NXT 거래가능 종목은 KRX 기준으로 보면 거래량이 40~45% 적게 나오므로(삼성전자 실측
 * 19.2M vs 34.7M), 사용자가 KRX만 보여주는 화면과 대조하면 반드시 어긋난다.
 *
 * 호가(ka10004)·거래원(ka10002)은 키움이 KRX 기준으로만 주므로 이 각주를 붙이지 않는다.
 */
export const UNIFIED_EXCHANGE_NOTE =
  "※ 수치는 KRX와 넥스트레이드(NXT) 체결을 합산한 **통합 기준**입니다 — " +
  "KRX만 표시하는 HTS·포털 화면과는 거래량·거래대금이 다를 수 있습니다.";

/**
 * 통합으로 조회할 수 없어 KRX 기준으로 남은 tool의 각주 — ka10004(호가)·ka10002(거래원).
 * 두 TR은 `_AL` 접미사를 무시하고 KRX 값만 준다(실측 2026-08-03).
 *
 * 이 각주가 없으면 같은 종목에 대해 get_stock_price는 통합 거래량을,
 * get_orderbook은 KRX 잔량을 보여주는 비대칭이 아무 설명 없이 노출된다 —
 * 사용자가 두 숫자를 합산하거나 비교하면 틀린 결론에 닿는다.
 */
export const KRX_ONLY_NOTE =
  "※ 호가·거래원은 키움이 통합 시세를 제공하지 않아 **KRX 기준**입니다 — " +
  "거래량·현재가를 통합으로 주는 get_stock_price와는 기준이 다릅니다.";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Wraps a tool body so every failure returns a readable MCP error result
 * (isError: true) instead of a raw protocol exception.
 */
export async function runTool(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      isError: true,
      content: [{ type: "text", text: `⚠️ ${message}` }],
    };
  }
}
