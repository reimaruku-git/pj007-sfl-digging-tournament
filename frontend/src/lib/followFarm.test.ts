import { afterEach, describe, expect, it } from "vitest";
import { readFollowedFarm, writeFollowedFarm } from "./followFarm";

afterEach(() => {
  localStorage.clear();
});

describe("followFarm", () => {
  it("remembers and clears a farm id", () => {
    writeFollowedFarm("  3666918801844311 ");
    expect(readFollowedFarm()).toBe("3666918801844311");
    writeFollowedFarm("");
    expect(readFollowedFarm()).toBe("");
  });
});
