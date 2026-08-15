import { describe, expect, it } from "vitest";
import { formatRelative, formatWhenUtc } from "./format";

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
