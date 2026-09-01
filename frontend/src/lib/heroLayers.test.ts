import { describe, expect, it } from "vitest";
import {
  DEFAULT_HERO_LAYERS,
  heroLayerStyle,
  normalizeHeroLayers,
} from "./heroLayers";

describe("heroLayers", () => {
  it("defaults missing layers to the original dusk canvas", () => {
    expect(normalizeHeroLayers(null)).toEqual(DEFAULT_HERO_LAYERS);
    expect(normalizeHeroLayers(undefined)).toEqual(DEFAULT_HERO_LAYERS);
  });

  it("keeps an empty stack so the photo can show unfiltered", () => {
    expect(normalizeHeroLayers([])).toEqual([]);
  });

  it("styles a color wash with fill and opacity", () => {
    const style = heroLayerStyle({ kind: "color", color: "#1a1815", opacity: 0.25 });
    expect(style.background).toBe("#1a1815");
    expect(style.opacity).toBe(0.25);
    expect(heroLayerStyle({ kind: "dusk", opacity: 0.78 }).opacity).toBe(0.78);
  });
});
