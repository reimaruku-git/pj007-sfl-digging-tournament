import { afterEach, describe, expect, it } from "vitest";
import {
  clearFarmIdentity,
  readFarmIdentity,
  readFollowedFarm,
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
});
