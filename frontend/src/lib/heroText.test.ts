import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_TEXT,
  HERO_TEXT_PRESETS,
  heroTextStyle,
  matchingHeroPreset,
  normalizeHeroText,
} from "./heroText";

describe("heroText", () => {
  it("defaults to the light cream-on-dusk preset", () => {
    expect(normalizeHeroText(null)).toEqual(DEFAULT_HERO_TEXT);
    expect(matchingHeroPreset(DEFAULT_HERO_TEXT)).toBe("light");
    expect(HERO_TEXT_PRESETS.dark.color).toBe("#1a1815");
    expect(HERO_TEXT_PRESETS.mid.color).toBe("#b89a56");
  });

  it("builds a tracing shadow from the outline color", () => {
    const style = heroTextStyle({ color: "#b89a56", outline: "#1a1815" });
    expect(style.color).toBe("#b89a56");
    expect(String(style.textShadow)).toMatch(/#1a1815/);
    expect(heroTextStyle({ color: "#e4dfd5", outline: "" }).textShadow).toBeUndefined();
  });
});
