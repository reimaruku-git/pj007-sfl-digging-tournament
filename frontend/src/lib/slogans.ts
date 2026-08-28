import type { Slogan } from "../api/public";

/** Seed list — same order the API returns when nothing has been stored yet. */
export const SEED_SLOGANS: Slogan[] = [
  { text: "Slap my pets", icon: "hand" },
  { text: "Grow my banana", icon: "banana" },
  { text: "Squeeze my orange", icon: "orange" },
  { text: "Clean my poop", icon: "poop" },
  { text: "Want some weed?", icon: "smiley" },
  { text: "Erect my monument", icon: "statue" },
];

const ICON_GLYPHS: Record<string, string> = {
  hand: "✋",
  banana: "🍌",
  orange: "🍊",
  poop: "💩",
  smiley: "😊",
  statue: "🗿",
};

const MS_PER_DAY = 86_400_000;

/** Whole UTC days since 1970-01-01. The cycle index is this number modulo list length. */
export function utcDayNumber(at: Date): number {
  return Math.floor(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) / MS_PER_DAY,
  );
}

/**
 * Walk the ordered list one UTC day at a time. After the last item the cycle
 * restarts at the first. Empty input returns null.
 */
export function pickDailySlogan(slogans: Slogan[], at: Date = new Date()): Slogan | null {
  if (!slogans.length) return null;
  return slogans[utcDayNumber(at) % slogans.length] ?? null;
}

export function sloganGlyph(icon: string): string {
  const key = icon.trim().toLowerCase();
  if (!key) return "";
  return ICON_GLYPHS[key] ?? icon;
}
