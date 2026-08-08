import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * 거래량·거래대금 계열 수치가 KRX 단독이 아니라 통합(KRX + 넥스트레이드) 기준임을 밝히는
 * 각주. v0.31.0에서 서버가 모든 시세·랭킹 TR을 통합으로 부르기 시작하면서 필요해졌다 —
 * NXT 거래가능 종목은 KRX 기준으로 보면 거래량이 40~45% 적게 나오므로(삼성전자 실측
 * 19.2M vs 34.7M), 사용자가 KRX만 보여주는 화면과 대조하면 반드시 어긋난다.
 *
 * **거래원 계열도 v0.47.0부터 이 각주를 쓴다.** 그전까지는 `KRX_ONLY_NOTE`라는 별도 각주로
 * "키움이 통합을 제공하지 않는다"고 밝혔는데 **사실이 아니었다** — ka10002·ka10038·ka10053
 * 모두 `stex_tp`는 무시하지만 `_AL` 접미사는 듣고, 거래원별로 `KRX + NXT = _AL`이 정확히
 * 맞는다(ka10038 32/32, ka10002 3/3, REAL 실측 2026-08-08).
 *
 * 이 자리에 2026-08-03자로 "ka10002는 `_AL`을 무시한다"는 상반된 실측 기록이 있었다.
 * 어느 쪽이 오측인지, 그 사이 키움이 바뀐 것인지는 **가릴 수 없다** — 그래서 지운 게 아니라
 * 여기 남긴다. 거래소 기준을 다시 의심할 일이 생기면 두 날짜를 모두 놓고 재측정할 것.
 */
export const UNIFIED_EXCHANGE_NOTE =
  "※ 수치는 KRX와 넥스트레이드(NXT) 체결을 합산한 **통합 기준**입니다 — " +
  "KRX만 표시하는 HTS·포털 화면과는 거래량·거래대금이 다를 수 있습니다.";

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
