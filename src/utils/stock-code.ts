/**
 * Shared validation pattern for the `stock_code` tool input.
 *
 * Korean stock codes are 6 characters but are NOT digit-only — KRX issues real
 * alphanumeric codes, observed verbatim in ka10098 rows (0156T0, 33626K,
 * 38380K, 0197X0). A digit-only validator rejects those before the request ever
 * reaches Kiwoom, so the pattern lives here rather than being retyped per tool.
 *
 * Inputs are matched case-insensitively; handlers uppercase before use because
 * Kiwoom and the ka10099 master list both return uppercase codes, and several
 * tools compare against `normalizeStockCode(row.stk_cd)` with `===`.
 *
 * Deliberately NOT used for the HHmmss time strings that some formatters match
 * with their own /^\d{6}$/ (pending-orders, sector) — those are clock values.
 */
export const STOCK_CODE_PATTERN = /^[0-9A-Z]{6}$/i;

/**
 * 거래소 접미사. 키움은 코드 뒤에 거래소를 붙여 KRX / 넥스트레이드(NXT) / 통합(SOR)을
 * 가른다 — `005930`(KRX), `005930_NX`(NXT), `005930_AL`(통합). 업종 코드도 같은 규칙을
 * 따른다 (`001_AL`).
 */
const EXCHANGE_SUFFIX_PATTERN = /_(AL|NX)$/;

/** 통합(SOR) 접미사 — KRX + NXT 체결을 합산한 값을 받으려면 이걸 붙여 요청한다. */
const UNIFIED_SUFFIX = "_AL";

/**
 * 응답에 실려 오는 `005930_AL` / `001_NX`를 서버가 노출하는 순수 코드로 되돌린다.
 * 접미사가 없으면 그대로 통과하므로 KRX 응답에도 무해하다.
 *
 * tool 출력의 코드는 다른 tool의 입력으로 그대로 쓰이는데
 * `STOCK_CODE_PATTERN`은 6자리만 받는다 — 접미사를 남기면 그 연결이 끊긴다.
 */
export function stripExchangeSuffix(code: string): string {
  return code.replace(EXCHANGE_SUFFIX_PATTERN, "");
}

/**
 * 종목 단위 TR에 통합(KRX+NXT) 수치를 요청하기 위해 접미사를 붙인다.
 *
 * 실측 2026-08-03 (REAL·VIRTUAL 동일): 붙이면 삼성전자 거래량이 19,419,307(KRX) →
 * 34,987,952(통합)로 바뀐다. 이미 접미사가 있으면 중복해서 붙이지 않는다.
 *
 * **ka10087 시간외단일가에는 쓰지 말 것** — 이 TR만 접미사를 받으면 값이 빈 껍데기로
 * 온다(실측). 애초에 NXT 종목을 통째로 누락하는 TR이라 통합 개념이 성립하지 않는다.
 */
export function toUnifiedCode(code: string): string {
  return EXCHANGE_SUFFIX_PATTERN.test(code) ? code : `${code}${UNIFIED_SUFFIX}`;
}
