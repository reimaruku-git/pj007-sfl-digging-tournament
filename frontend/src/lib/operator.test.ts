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

  it("shortens the donation wallet to first 3 and last 3", () => {
    expect(truncatedDonationWallet(DONATION_WALLET)).toBe("0xa...f2c");
    expect(truncatedDonationWallet(DONATION_WALLET)).not.toBe(DONATION_WALLET);
    expect(truncatedDonationWallet(DONATION_WALLET).startsWith(DONATION_WALLET.slice(0, 3))).toBe(
      true,
    );
    expect(truncatedDonationWallet(DONATION_WALLET).endsWith(DONATION_WALLET.slice(-3))).toBe(true);
  });

  it("copies the full wallet address in one click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText(DONATION_WALLET)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith(DONATION_WALLET);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});
