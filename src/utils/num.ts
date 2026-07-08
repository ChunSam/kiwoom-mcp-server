/**
 * Kiwoom REST API returns every numeric value as a string, often zero-padded
 * and/or sign-prefixed (e.g. "000000061300", "+61300", "-00013000").
 * Some TRs double the sign ("--23722054", live-observed on ka10061) — the
 * leading sign run collapses to its first character. A few fields arrive
 * comma-grouped ("20,190", kt00015 trde_unit). An empty string means
 * "no value".
 */
export function parseKiwoomNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replaceAll(",", "").replace(/^([+-])[+-]+/, "$1");
  if (trimmed === "" || trimmed === "+" || trimmed === "-") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * For price fields (cur_prc, open_pric, ...) Kiwoom encodes the direction
 * versus yesterday as a +/- sign on the price itself. The actual price is the
 * absolute value; direction should be read from pre_sig / pred_pre instead.
 */
export function parseKiwoomPrice(raw: string | null | undefined): number | null {
  const value = parseKiwoomNumber(raw);
  return value === null ? null : Math.abs(value);
}

export function formatKRW(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
}

export function formatSignedKRW(value: number | null): string {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}원`;
}

export function formatQuantity(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("ko-KR")}주`;
}

export function formatPercent(value: number | null): string {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Non-directional ratio as a percent (no forced + sign): 46.58 → "46.58%". */
export function formatRatioPercent(value: number | null): string {
  if (value === null) return "-";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}

/** Plain locale-formatted number without a unit (indices, ratios, counts). */
export function formatNumber(value: number | null, maxFractionDigits = 2): string {
  if (value === null) return "-";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: maxFractionDigits });
}

/** Signed locale-formatted number without a unit (investor flows etc.). */
export function formatSigned(value: number | null, maxFractionDigits = 2): string {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: maxFractionDigits })}`;
}
