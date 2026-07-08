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
