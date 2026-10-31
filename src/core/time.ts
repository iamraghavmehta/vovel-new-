/** Timezone-aware date helpers. Timestamps are stored in UTC; local dates are derived. */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" for the instant `date` as seen in timezone `tz`. Falls back to UTC if tz is invalid. */
export function localDateKey(date: Date, tz: string): string {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Shift a "YYYY-MM-DD" key by whole days (calendar arithmetic, DST-safe). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** The `n` local date keys ending at (and including) today, oldest first. */
export function lastNDateKeys(now: Date, tz: string, n: number): string[] {
  const today = localDateKey(now, tz);
  return Array.from({ length: n }, (_, i) => shiftDateKey(today, i - (n - 1)));
}

export function addMs(iso: string | Date, ms: number): string {
  const base = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new Date(base + ms).toISOString();
}

export function isDue(nextReviewAt: string | null, now: Date): boolean {
  return nextReviewAt !== null && new Date(nextReviewAt).getTime() <= now.getTime();
}
