import { describe, expect, it } from "vitest";
import { pickDailySlogan, SEED_SLOGANS, sloganGlyph, utcDayNumber } from "./slogans";

const MS_PER_DAY = 86_400_000;

function utcDay(offset: number, origin = new Date(Date.UTC(2026, 0, 1))): Date {
  return new Date(origin.getTime() + offset * MS_PER_DAY);
}

describe("pickDailySlogan", () => {
  it("keeps the six seed slogans in the shipped order", () => {
    expect(SEED_SLOGANS.map((row) => `${row.text}|${row.icon}`)).toEqual([
      "Slap my pets|hand",
      "Grow my banana|banana",
      "Squeeze my orange|orange",
      "Clean my poop|poop",
      "Want some weed?|smiley",
      "Erect my monument|statue",
    ]);
  });

  it("returns the same slogan for any time on the same UTC day", () => {
    const morning = new Date(Date.UTC(2026, 7, 28, 0, 1, 0));
    const night = new Date(Date.UTC(2026, 7, 28, 23, 59, 59));
    expect(utcDayNumber(morning)).toBe(utcDayNumber(night));
    expect(pickDailySlogan(SEED_SLOGANS, morning)).toEqual(
      pickDailySlogan(SEED_SLOGANS, night),
    );
  });

  it("walks the ordered list until every item has been shown, then restarts", () => {
    const origin = utcDay(0);
    const seen = Array.from({ length: SEED_SLOGANS.length }, (_, offset) =>
      pickDailySlogan(SEED_SLOGANS, utcDay(offset, origin)),
    );
    const texts = seen.map((row) => row?.text);
    expect(new Set(texts).size).toBe(SEED_SLOGANS.length);
    expect(texts).toHaveLength(SEED_SLOGANS.length);

    for (let i = 0; i < SEED_SLOGANS.length; i += 1) {
      const current = SEED_SLOGANS.findIndex((row) => row.text === texts[i]);
      const next = SEED_SLOGANS.findIndex(
        (row) => row.text === texts[(i + 1) % SEED_SLOGANS.length],
      );
      expect((current + 1) % SEED_SLOGANS.length).toBe(next);
    }

    expect(pickDailySlogan(SEED_SLOGANS, utcDay(SEED_SLOGANS.length, origin))).toEqual(seen[0]);
  });

  it("uses the next unused item after an admin append, then wraps the longer list", () => {
    const longer = [...SEED_SLOGANS, { text: "Feed my chicken", icon: "hand" }];
    const origin = utcDay(0);
    const seen = Array.from({ length: longer.length }, (_, offset) =>
      pickDailySlogan(longer, utcDay(offset, origin)),
    );
    expect(new Set(seen.map((row) => row?.text)).size).toBe(longer.length);
    expect(pickDailySlogan(longer, utcDay(longer.length, origin))).toEqual(seen[0]);
  });

  it("returns null for an empty list", () => {
    expect(pickDailySlogan([], utcDay(0))).toBeNull();
  });

  it("maps seed icons to glyphs", () => {
    expect(sloganGlyph("hand")).toBe("✋");
    expect(sloganGlyph("banana")).toBe("🍌");
    expect(sloganGlyph("orange")).toBe("🍊");
    expect(sloganGlyph("poop")).toBe("💩");
    expect(sloganGlyph("smiley")).toBe("😊");
    expect(sloganGlyph("statue")).toBe("🗿");
    expect(sloganGlyph("🗿")).toBe("🗿");
  });
});
