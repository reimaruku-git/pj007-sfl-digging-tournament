import type { Slogan, SloganList } from "../api/public";

/** Seed list — same order the API returns when nothing has been stored yet. */
export const SEED_SLOGANS: Slogan[] = [
  { text: "Slap my pets" },
  { text: "Grow my banana" },
  { text: "Squeeze my orange" },
  { text: "Clean my poop" },
  { text: "Want some weed?" },
  { text: "Erect my monument" },
];

export type TodayPick = {
  text: string;
  day: string;
};

const MS_PER_DAY = 86_400_000;

/** Whole UTC days since 1970-01-01. The cycle index is this number modulo list length. */
export function utcDayNumber(at: Date): number {
  return Math.floor(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / MS_PER_DAY,
  );
}

export function utcDayKey(at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayPickFrom(list: SloganList | null | undefined): TodayPick | null {
  const text = list?.today_text?.trim();
  const day = list?.today_day?.trim();
  if (!text || !day) return null;
  return { text, day };
}

/**
 * Walk the ordered list one UTC day at a time. After the last item the cycle
 * restarts at the first. A today pick wins only on that UTC day.
 */
export function pickDailySlogan(
  slogans: Slogan[],
  at: Date = new Date(),
  todayPick: TodayPick | null = null,
): Slogan | null {
  if (!slogans.length) return null;
  if (todayPick?.text && todayPick.day === utcDayKey(at)) {
    const pinned = slogans.find((row) => row.text === todayPick.text);
    if (pinned) return pinned;
  }
  return slogans[utcDayNumber(at) % slogans.length] ?? null;
}
