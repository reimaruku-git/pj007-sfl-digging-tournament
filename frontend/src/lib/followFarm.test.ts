import { afterEach, describe, expect, it } from "vitest";
import {
  addRequestedTournamentId,
  clearFarmIdentity,
  clearRequestedTournamentId,
  hasRequestedTournament,
  readFarmIdentity,
  readFollowedFarm,
  readRequestedTournamentIds,
  writeFarmIdentity,
  writeFollowedFarm,
} from "./followFarm";

afterEach(() => {
  localStorage.clear();
});

describe("followFarm", () => {
  it("stores farm id with the resolved name and clears on disconnect", () => {
    writeFarmIdentity({ farm_id: "  3666918801844311 ", name: " rmr " });
    expect(readFarmIdentity()).toEqual({ farm_id: "3666918801844311", name: "rmr" });
    expect(readFollowedFarm()).toBe("3666918801844311");
    clearFarmIdentity();
    expect(readFarmIdentity()).toBeNull();
    expect(readFollowedFarm()).toBe("");
  });

  it("does not treat a farm id without a resolved name as a login", () => {
    writeFollowedFarm("3666918801844311");
    expect(readFarmIdentity()).toBeNull();
    expect(readFollowedFarm()).toBe("");
    localStorage.setItem("pj007.followFarmId", "3666918801844311");
    expect(readFarmIdentity()).toBeNull();
  });

  it("remembers requested tournament ids per farm across reloads", () => {
    expect(hasRequestedTournament("3666918801844311", "next")).toBe(false);
    addRequestedTournamentId("3666918801844311", "next");
    addRequestedTournamentId(" 3666918801844311 ", "next");
    expect(readRequestedTournamentIds("3666918801844311")).toEqual(["next"]);
    expect(hasRequestedTournament("3666918801844311", "next")).toBe(true);
    expect(hasRequestedTournament("99", "next")).toBe(false);
    addRequestedTournamentId("99", "other");
    expect(readRequestedTournamentIds("3666918801844311")).toEqual(["next"]);
    expect(hasRequestedTournament("99", "other")).toBe(true);
    clearRequestedTournamentId("3666918801844311", "next");
    expect(hasRequestedTournament("3666918801844311", "next")).toBe(false);
    expect(hasRequestedTournament("99", "other")).toBe(true);
  });
});
