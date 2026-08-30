export function statusLabel(status: string): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "invalidated":
      return "Invalidated";
    case "scheduled":
      return "Scheduled";
    case "active":
      return "Active";
    case "ended":
      return "Ended";
    default:
      return status;
  }
}

export function catalogStatusLabel(status: string): string {
  if (status === "active") return "Ongoing";
  if (status === "scheduled") return "Upcoming";
  return statusLabel(status);
}

export function windowStatusLabel(status: string): string {
  if (status === "active") return "Live";
  if (status === "scheduled") return "Upcoming";
  return statusLabel(status);
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function isoToDateInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function inclusiveCalendarDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function inclusiveFinalDayIso(
  startAt: string | null | undefined,
  durationDays: number | null | undefined,
): string {
  if (!startAt) return "";
  const date = new Date(startAt);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.max(Number(durationDays) || 1, 1);
  date.setUTCDate(date.getUTCDate() + days - 1);
  return date.toISOString();
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function utcDayMonth(value: string): { year: number; month: string; day: number } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: SHORT_MONTHS[date.getUTCMonth()] ?? "",
    day: date.getUTCDate(),
  };
}

export function formatDateUtc(value: string | null | undefined): string {
  if (!value) return "—";
  const parts = utcDayMonth(value);
  if (!parts) return value;
  return `${parts.day} ${parts.month}`;
}

export function formatDateRangeUtc(
  start: string | null | undefined,
  end: string | null | undefined,
  _days?: number | null,
): string {
  const from = start ? utcDayMonth(start) : null;
  const to = end ? utcDayMonth(end) : null;
  if (!from && !to) return "—";
  if (!from) return formatDateUtc(end);
  if (!to) return formatDateUtc(start);
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}–${to.day} ${from.month}`;
  }
  if (from.year === to.year) {
    return `${from.day} ${from.month}–${to.day} ${to.month}`;
  }
  return `${from.day} ${from.month} ${from.year}–${to.day} ${to.month} ${to.year}`;
}

function utcLongDay(value: string): { year: number; month: string; day: number } | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: LONG_MONTHS[date.getUTCMonth()] ?? "",
    day: date.getUTCDate(),
  };
}

function longMonthDay(
  parts: { month: string; day: number },
  withYear: boolean,
  year: number,
): string {
  return withYear ? `${parts.month} ${parts.day}, ${year}` : `${parts.month} ${parts.day},`;
}

/** Details-page range: full month names, year on the end (or both when years differ). */
export function formatDetailDateRangeUtc(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = start ? utcLongDay(start) : null;
  const to = end ? utcLongDay(end) : null;
  if (!from && !to) return "—";
  if (!from && to) return longMonthDay(to, true, to.year);
  if (from && !to) return longMonthDay(from, true, from.year);
  if (!from || !to) return "—";
  if (from.year === to.year) {
    return `${longMonthDay(from, false, from.year)} - ${longMonthDay(to, true, to.year)}`;
  }
  return `${longMonthDay(from, true, from.year)} - ${longMonthDay(to, true, to.year)}`;
}

/** True when a prize string is a finite number (Flower), not a label. */
export function isNumericPrizeAmount(amount: string | null | undefined): boolean {
  const raw = (amount ?? "").trim();
  if (!raw) return false;
  return Number.isFinite(Number(raw));
}

/** True when a prize Flower amount is numeric zero ("0", "0.0", …). */
export function isZeroFlowerAmount(amount: string | null | undefined): boolean {
  const raw = (amount ?? "").trim();
  if (!raw || !isNumericPrizeAmount(raw)) return false;
  return Number(raw) === 0;
}

export type PrizeAmountUnit = "flower" | "$flower";

/**
 * Numeric pool/place → `{n} $Flower` (or `Flower`). Non-numeric text is shown
 * as-is, with no Flower suffix. Zero Flower is omitted unless `omitZero` is false.
 */
export function formatPrizeAmount(
  amount: string | null | undefined,
  options?: { unit?: PrizeAmountUnit; omitZero?: boolean },
): string | null {
  const raw = (amount ?? "").trim();
  if (!raw) return null;
  if (!isNumericPrizeAmount(raw)) return raw;
  if ((options?.omitZero ?? true) && Number(raw) === 0) return null;
  return (options?.unit ?? "$flower") === "flower" ? `${raw} Flower` : `${raw} $Flower`;
}

export function formatWhenUtc(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${hours}:${minutes} UTC`;
}

export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = now.getTime() - date.getTime();
  if (delta < 0) return formatWhenUtc(value);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(Number(score))) return "—";
  return Number(score).toFixed(2);
}

export function formatUtcClock(now: Date = new Date()): string {
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function longDate(parts: { year: number; month: string; day: number }): string {
  return `${parts.month} ${parts.day}, ${parts.year}`;
}

export function formatWindowRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const from = start ? utcLongDay(start) : null;
  const to = end ? utcLongDay(end) : null;
  if (!from && !to) return "—";
  if (!from && to) return longDate(to);
  if (from && !to) return longDate(from);
  if (!from || !to) return "—";
  return `${longDate(from)} to ${longDate(to)}`;
}

export function formatDurationDays(days: number | null | undefined): string {
  if (days == null || Number.isNaN(Number(days))) return "";
  return Number(days) === 1 ? "1 day" : `${Number(days)} days`;
}

export function utcCalendarDaysUntil(
  iso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const startOfNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfTarget = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.round((startOfTarget - startOfNow) / 86_400_000);
}

export function remainingLabel(
  lastPlayableAt: string | null | undefined,
  now: Date = new Date(),
  status?: string | null,
): string {
  if (status === "ended") return "Ended";
  const days = utcCalendarDaysUntil(lastPlayableAt, now);
  if (days == null) return "";
  if (days < 0) return "Ended";
  if (days === 0) return "Ends today";
  if (days === 1) return "1 day remaining";
  return `${days} days remaining`;
}

export function formatTopPrize(
  prizeAmount: string | null | undefined,
  prizePlaces?: ReadonlyArray<{ place: number; amount: string; nft_name?: string }> | null,
): string {
  const places = [...(prizePlaces ?? [])].sort((a, b) => a.place - b.place);
  const first = places.find((row) => row.place === 1);
  const amount = (first?.amount ?? prizeAmount ?? "").trim();
  const nft = (first?.nft_name ?? "").trim();
  const flower = formatPrizeAmount(amount);
  return [flower, nft || null].filter(Boolean).join(" · ") || "—";
}

export function opensLabel(startAt: string | null | undefined, now: Date = new Date()): string {
  const days = utcCalendarDaysUntil(startAt, now);
  if (days == null) return "";
  if (days <= 0) return "Opens today";
  if (days === 1) return "Opens in 1 day";
  return `Opens in ${days} days`;
}

/** Joined count, or `joined / max` when a participant cap is set. */
export function joinedCountLabel(
  enrolled: number | null | undefined,
  max: number | null | undefined,
  fallback = 0,
  compact = false,
): string {
  const joined = enrolled ?? fallback;
  if (max == null) return String(joined);
  return compact ? `${joined}/${max}` : `${joined} / ${max}`;
}
