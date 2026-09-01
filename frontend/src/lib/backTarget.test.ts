import { describe, expect, it } from "vitest";
import { farmBackTarget, profileBackTarget, tournamentBackTarget } from "./backTarget";

describe("farmBackTarget", () => {
  it("returns to the tournament when the farm was opened from that event", () => {
    expect(farmBackTarget("20260817T000000Z_7d")).toEqual({
      to: "/tournaments/20260817T000000Z_7d",
      label: "Back to tournament",
    });
  });

  it("returns home when the farm was opened from the home board", () => {
    expect(farmBackTarget(undefined)).toEqual({ to: "/", label: "Back to home" });
    expect(farmBackTarget("")).toEqual({ to: "/", label: "Back to home" });
  });
});

describe("tournamentBackTarget", () => {
  it("returns to the catalog when opened from All tournaments", () => {
    expect(tournamentBackTarget("tournaments")).toEqual({
      to: "/tournaments",
      label: "Back to tournaments",
    });
  });

  it("returns home when opened from the home board or with no origin", () => {
    expect(tournamentBackTarget("home")).toEqual({ to: "/", label: "Back to home" });
    expect(tournamentBackTarget(undefined)).toEqual({ to: "/", label: "Back to home" });
  });
});

describe("profileBackTarget", () => {
  it("returns Back to the tournament when opened from an event page", () => {
    expect(profileBackTarget("/tournaments/sprint")).toEqual({
      to: "/tournaments/sprint",
      label: "Back",
    });
    expect(profileBackTarget("/tournaments/sprint/farm/1")).toEqual({
      to: "/tournaments/sprint",
      label: "Back",
    });
  });

  it("returns Back home from the live board or with no origin", () => {
    expect(profileBackTarget("/")).toEqual({ to: "/", label: "Back" });
    expect(profileBackTarget(undefined)).toEqual({ to: "/", label: "Back" });
  });
});
