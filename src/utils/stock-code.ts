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
