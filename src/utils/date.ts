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

/**
 * yyyyMMdd의 **달력상 전날** (휴장일 판정은 하지 않는다).
 *
 * `kstDaysAgo(1)`과 다르다 — 저쪽은 기준이 늘 "오늘"이라 오늘이 아닌 날짜에서
 * 물러설 때 조용히 엉뚱한 날을 준다. 2026-08-15에 그 차이로 테스트가 깨졌다.
 * 날짜 산술은 UTC로 한다 — KST는 서머타임이 없지만 로컬 타임존에 기대면
 * 실행 환경마다 하루가 밀린다.
 */
export function previousDay(yyyymmdd: string): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day) - 86_400_000)
    .toISOString()
    .slice(0, 10)
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
