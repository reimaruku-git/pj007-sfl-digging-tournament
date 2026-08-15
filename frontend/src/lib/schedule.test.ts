import { describe, expect, it } from "vitest";
import { formatCountdown, nextSyncAt, SYNC_HOURS_UTC } from "./schedule";

describe("nextSyncAt", () => {
  it("picks the next listed UTC hour the same day", () => {
    const now = new Date("2026-08-15T15:01:00.000Z");
    expect(nextSyncAt(now).toISOString()).toBe("2026-08-15T16:00:00.000Z");
  });

  it("jumps to 14:00 tomorrow after the 23:00 slot", () => {
    const now = new Date("2026-08-15T23:00:01.000Z");
    expect(nextSyncAt(now).toISOString()).toBe("2026-08-16T14:00:00.000Z");
  });

  it("covers every scheduled hour", () => {
    expect([...SYNC_HOURS_UTC]).toEqual([14, 16, 18, 20, 23]);
    const now = new Date("2026-08-15T13:59:59.000Z");
    expect(nextSyncAt(now).getUTCHours()).toBe(14);
  });
});

describe("formatCountdown", () => {
  it("shows hours when the wait is long", () => {
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000)).toBe("2h 05m");
  });

  it("shows minutes and seconds under an hour", () => {
    expect(formatCountdown(7 * 60_000 + 4_000)).toBe("7m 04s");
  });
});
