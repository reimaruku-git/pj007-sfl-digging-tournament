import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyText,
  DONATION_WALLET,
  OPERATOR_FARM_ID,
  OPERATOR_FARM_URL,
  OPERATOR_X_URL,
  truncatedDonationWallet,
} from "./operator";

describe("operator chrome helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points the farm visit link at sunflower-land play, not sfl.world", () => {
    expect(OPERATOR_FARM_URL).toBe(
      `https://sunflower-land.com/play/#/visit/${OPERATOR_FARM_ID}`,
    );
    expect(OPERATOR_FARM_URL).not.toMatch(/sfl\.world/);
    expect(OPERATOR_X_URL).toBe("https://x.com/reimaruku");
  });

  it("shortens the donation wallet to 0xad89dD...12f2c", () => {
    expect(truncatedDonationWallet(DONATION_WALLET)).toBe("0xad89dD...12f2c");
    expect(truncatedDonationWallet(DONATION_WALLET)).not.toBe(DONATION_WALLET);
  });

  it("copies the full wallet address in one click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText(DONATION_WALLET)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(DONATION_WALLET);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
