import { describe, expect, it } from "vitest";
import {
  catalogStatusLabel,
  formatDateRangeUtc,
  formatDateUtc,
  formatDetailDateRangeUtc,
  formatDurationDays,
  formatRelative,
  formatScore,
  formatTopPrize,
  formatWhenUtc,
  formatWindowRange,
  inclusiveCalendarDays,
  inclusiveFinalDayIso,
  isoToDateInput,
  isZeroFlowerAmount,
  opensLabel,
  remainingLabel,
  utcCalendarDaysUntil,
  windowStatusLabel,
} from "./format";

describe("catalogStatusLabel", () => {
  it("labels live events Ongoing and scheduled events Upcoming", () => {
    expect(catalogStatusLabel("active")).toBe("Ongoing");
    expect(catalogStatusLabel("scheduled")).toBe("Upcoming");
    expect(catalogStatusLabel("ended")).toBe("Ended");
  });
});

describe("windowStatusLabel", () => {
  it("labels live windows Live for the public catalog", () => {
    expect(windowStatusLabel("active")).toBe("Live");
    expect(windowStatusLabel("scheduled")).toBe("Upcoming");
    expect(windowStatusLabel("ended")).toBe("Ended");
  });
});

describe("formatScore", () => {
  it("prints two decimal places", () => {
    expect(formatScore(3)).toBe("3.00");
    expect(formatScore(0.7)).toBe("0.70");
    expect(formatScore(null)).toBe("—");
  });
});

describe("formatDateUtc", () => {
  it("prints day and month only from a datetime that includes a clock", () => {
    const stamped = formatDateUtc("2026-08-13T14:44:00.000Z");
    expect(stamped).toBe("13 Aug");
    expect(stamped).not.toMatch(/\d{2}:\d{2}/);
    expect(stamped).not.toMatch(/UTC/);
    expect(formatDateUtc("2026-08-21T13:47:11+00:00")).toBe("21 Aug");
    expect(formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z", 8)).toBe(
      "13–21 Aug",
    );
    expect(formatDateRangeUtc("2026-08-21T00:00:00.000Z", "2026-09-03T00:00:00.000Z")).toBe(
      "21 Aug–3 Sep",
    );
    expect(formatDateRangeUtc("2026-12-28T00:00:00.000Z", "2027-01-04T00:00:00.000Z")).toBe(
      "28 Dec 2026–4 Jan 2027",
    );
    expect(
      formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z", 8),
    ).not.toMatch(/·/);
    expect(formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z")).not.toMatch(
      /\d{2}:\d{2}/,
    );
    expect(formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z")).not.toMatch(
      /UTC/,
    );
  });
});

describe("formatDetailDateRangeUtc", () => {
  it("prints full month names with year only on the end when UTC years match", () => {
    expect(formatDetailDateRangeUtc("2026-08-26T00:00:00.000Z", "2026-08-26T00:00:00.000Z")).toBe(
      "August 26, - August 26, 2026",
    );
    expect(formatDetailDateRangeUtc("2026-08-23T00:00:00.000Z", "2026-08-30T00:00:00.000Z")).toBe(
      "August 23, - August 30, 2026",
    );
    expect(formatDetailDateRangeUtc("2026-08-21T00:00:00.000Z", "2026-09-03T00:00:00.000Z")).toBe(
      "August 21, - September 3, 2026",
    );
  });

  it("prints the year on both sides when UTC years differ", () => {
    expect(formatDetailDateRangeUtc("2026-12-30T00:00:00.000Z", "2027-01-05T00:00:00.000Z")).toBe(
      "December 30, 2026 - January 5, 2027",
    );
  });
});

describe("isZeroFlowerAmount", () => {
  it("treats 0 and 0.0 as zero and leaves non-zero amounts", () => {
    expect(isZeroFlowerAmount("0")).toBe(true);
    expect(isZeroFlowerAmount("0.0")).toBe(true);
    expect(isZeroFlowerAmount(" 0.00 ")).toBe(true);
    expect(isZeroFlowerAmount("30")).toBe(false);
    expect(isZeroFlowerAmount("0.1")).toBe(false);
    expect(isZeroFlowerAmount("")).toBe(false);
  });
});

describe("isoToDateInput", () => {
  it("keeps the UTC calendar date", () => {
    expect(isoToDateInput("2026-08-13T14:44:00.000Z")).toBe("2026-08-13");
  });
});

describe("inclusive calendar days", () => {
  it("counts August 23 through August 30 as 8 days", () => {
    expect(inclusiveCalendarDays("2026-08-23", "2026-08-30")).toBe(8);
    expect(isoToDateInput(inclusiveFinalDayIso("2026-08-23T00:00:00.000Z", 8))).toBe("2026-08-30");
  });
});

describe("formatWhenUtc", () => {
  it("prints a stable UTC stamp", () => {
    expect(formatWhenUtc("2026-08-15T14:00:00.000Z")).toBe("15 Aug 14:00 UTC");
  });
});

describe("window calendar copy", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("prints a spaced range with year", () => {
    expect(formatWindowRange("2026-08-22T00:00:00.000Z", "2026-08-28T00:00:00.000Z")).toBe(
      "August 22, 2026 to August 28, 2026",
    );
    expect(formatWindowRange("2026-08-22T00:00:00.000Z", "2026-09-03T00:00:00.000Z")).toBe(
      "August 22, 2026 to September 3, 2026",
    );
    expect(formatDurationDays(7)).toBe("7 days");
    expect(formatDurationDays(1)).toBe("1 day");
  });

  it("prints inclusive last playable day, not exclusive end_at", () => {
    const start = "2026-08-17T00:00:00.000Z";
    const last = inclusiveFinalDayIso(start, 7);
    expect(isoToDateInput(last)).toBe("2026-08-23");
    expect(formatWindowRange(start, last)).toBe("August 17, 2026 to August 23, 2026");
    expect(formatWindowRange(start, last)).not.toMatch(/August 24/);
    expect(formatWindowRange(start, "2026-08-24T00:00:00.000Z")).toBe(
      "August 17, 2026 to August 24, 2026",
    );
  });

  it("counts remaining and opening days from UTC dates", () => {
    expect(utcCalendarDaysUntil("2026-08-28T00:00:00.000Z", now)).toBe(6);
    expect(remainingLabel("2026-08-28T00:00:00.000Z", now)).toBe("6 days remaining");
    expect(opensLabel("2026-09-01T00:00:00.000Z", now)).toBe("Opens in 10 days");
    expect(remainingLabel("2026-08-22T00:00:00.000Z", now)).toBe("Ends today");
  });

  it("says ended after the last playable day or when status is ended", () => {
    const start = "2026-08-17T00:00:00.000Z";
    const last = inclusiveFinalDayIso(start, 7);
    expect(remainingLabel(last, new Date("2026-08-23T12:00:00.000Z"))).toBe("Ends today");
    expect(remainingLabel(last, new Date("2026-08-22T12:00:00.000Z"))).toBe("1 day remaining");
    expect(remainingLabel(last, new Date("2026-08-17T12:00:00.000Z"))).toBe("6 days remaining");
    expect(remainingLabel(last, new Date("2026-08-24T00:00:00.000Z"))).toBe("Ended");
    expect(remainingLabel(last, new Date("2026-08-25T12:00:00.000Z"))).toBe("Ended");
    expect(remainingLabel(last, new Date("2026-08-17T12:00:00.000Z"), "ended")).toBe("Ended");
    expect(remainingLabel(last, new Date("2026-08-23T12:00:00.000Z"), "ended")).not.toBe(
      "Ends today",
    );
  });
});

describe("formatTopPrize", () => {
  it("renders 1st-place Flower, NFT, or both and omits a zero Flower amount", () => {
    expect(formatTopPrize("100")).toBe("100 $Flower");
    expect(formatTopPrize("30", [{ place: 1, amount: "30" }])).toBe("30 $Flower");
    expect(formatTopPrize("0", [{ place: 1, amount: "0", nft_name: "Rare Key" }])).toBe("Rare Key");
    expect(formatTopPrize("50", [{ place: 1, amount: "50", nft_name: "Rare Key" }])).toBe(
      "50 $Flower · Rare Key",
    );
    expect(
      formatTopPrize("70", [
        { place: 2, amount: "20" },
        { place: 1, amount: "50", nft_name: "Golden Shovel" },
      ]),
    ).toBe("50 $Flower · Golden Shovel");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-15T16:00:00.000Z");

  it("uses just now / minutes / hours", () => {
    expect(formatRelative("2026-08-15T15:59:40.000Z", now)).toBe("just now");
    expect(formatRelative("2026-08-15T15:40:00.000Z", now)).toBe("20m ago");
    expect(formatRelative("2026-08-15T13:00:00.000Z", now)).toBe("3h ago");
  });
});
