import { describe, expect, it } from "vitest";
import { validateTournamentImageFile, validateTournamentImageSource } from "./tournamentImages";

describe("validateTournamentImageFile", () => {
  it("accepts small webp/png uploads", () => {
    expect(
      validateTournamentImageFile(new File(["x"], "a.webp", { type: "image/webp" })),
    ).toBeNull();
    expect(
      validateTournamentImageFile(new File(["x"], "a.png", { type: "image/png" })),
    ).toBeNull();
  });

  it("rejects unsupported types and oversized files", () => {
    expect(
      validateTournamentImageFile(new File(["x"], "a.txt", { type: "text/plain" })),
    ).toMatch(/JPEG|PNG|WebP|GIF/i);
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.webp", {
      type: "image/webp",
    });
    expect(validateTournamentImageFile(big)).toMatch(/2 MB/i);
  });

  it("lets a larger source photo through so it can be cropped", () => {
    const large = new File([new Uint8Array(3 * 1024 * 1024)], "big.webp", {
      type: "image/webp",
    });
    expect(validateTournamentImageFile(large)).toMatch(/2 MB/i);
    expect(validateTournamentImageSource(large)).toBeNull();
  });
});
