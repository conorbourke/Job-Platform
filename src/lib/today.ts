/** Today's date (YYYY-MM-DD) in UK/Irish time, so deadlines flip at local midnight. */
export function todayLocal(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
