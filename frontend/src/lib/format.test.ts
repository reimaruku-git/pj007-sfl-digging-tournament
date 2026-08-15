import { describe, expect, it } from "vitest";
import {
  formatDateRangeUtc,
  formatDateUtc,
  formatRelative,
  formatScore,
  formatWhenUtc,
  isoToDateInput,
} from "./format";

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
      "13 Aug → 21 Aug · 8d",
    );
    expect(formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z")).not.toMatch(
      /\d{2}:\d{2}/,
    );
    expect(formatDateRangeUtc("2026-08-13T14:44:00.000Z", "2026-08-21T13:47:00.000Z")).not.toMatch(
      /UTC/,
    );
  });
});

describe("isoToDateInput", () => {
  it("keeps the UTC calendar date", () => {
    expect(isoToDateInput("2026-08-13T14:44:00.000Z")).toBe("2026-08-13");
  });
});

describe("formatWhenUtc", () => {
  it("prints a stable UTC stamp", () => {
    expect(formatWhenUtc("2026-08-15T14:00:00.000Z")).toBe("15 Aug 14:00 UTC");
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
