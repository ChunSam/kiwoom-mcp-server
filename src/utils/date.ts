/** Date helpers pinned to KST — the timezone of every Kiwoom API date field. */

/** Today's date in KST as yyyyMMdd (sv-SE locale gives ISO ordering). */
export function todayInKst(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replaceAll("-", "");
}

/** KST date `days` days before today, yyyyMMdd. */
export function kstDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000)
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
    .replaceAll("-", "");
}

/** yyyyMMdd → yyyy-MM-dd for display. */
export function formatDateDashed(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Sanity-check a date range (both yyyyMMdd, so string order == date order).
 * Kiwoom returns confusing empty results for an inverted range — fail early
 * with a readable Korean error instead.
 */
export function assertDateRange(fromDate: string, toDate: string): void {
  if (fromDate > toDate) {
    throw new Error(
      `조회 기간이 잘못되었습니다: 시작일(${formatDateDashed(fromDate)})이 ` +
        `종료일(${formatDateDashed(toDate)})보다 늦습니다. from_date/to_date를 확인해 주세요.`,
    );
  }
}
