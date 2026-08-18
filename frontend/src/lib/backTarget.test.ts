import { describe, expect, it } from "vitest";
import { farmBackTarget, tournamentBackTarget } from "./backTarget";

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
