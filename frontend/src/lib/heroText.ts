import type { CSSProperties } from "react";
import type { HeroText } from "../api/public";

export type HeroTextPresetId = "light" | "mid" | "dark";

export const HERO_TEXT_PRESETS: Record<
  HeroTextPresetId,
  { label: string; hint: string; color: string; outline: string }
> = {
  light: {
    label: "Light",
    hint: "Cream letters with a dusk outline. Best on dark photos.",
    color: "#e4dfd5",
    outline: "#1a1815",
  },
  mid: {
    label: "Gold",
    hint: "Gold letters with a dusk outline. Matches the site.",
    color: "#b89a56",
    outline: "#1a1815",
  },
  dark: {
    label: "Dark",
    hint: "Dusk letters with a cream outline. Best on bright photos.",
    color: "#1a1815",
    outline: "#e4dfd5",
  },
};

export const DEFAULT_HERO_TEXT: HeroText = {
  color: HERO_TEXT_PRESETS.light.color,
  outline: HERO_TEXT_PRESETS.light.outline,
};

export function normalizeHeroText(raw?: HeroText | null): HeroText {
  const color = String(raw?.color || "").trim().toLowerCase();
  const outline = String(raw?.outline ?? DEFAULT_HERO_TEXT.outline).trim().toLowerCase();
  return {
    color: /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_HERO_TEXT.color,
    outline: outline === "" || /^#[0-9a-f]{6}$/.test(outline) ? outline : DEFAULT_HERO_TEXT.outline,
  };
}

export function matchingHeroPreset(raw?: HeroText | null): HeroTextPresetId | null {
  const next = normalizeHeroText(raw);
  for (const id of Object.keys(HERO_TEXT_PRESETS) as HeroTextPresetId[]) {
    const preset = HERO_TEXT_PRESETS[id];
    if (preset.color === next.color && preset.outline === next.outline) return id;
  }
  return null;
}

export function heroTextStyle(raw?: HeroText | null): CSSProperties {
  const next = normalizeHeroText(raw);
  const style: CSSProperties = { color: next.color };
  if (next.outline) {
    style.textShadow = [
      `-1px -1px 0 ${next.outline}`,
      `1px -1px 0 ${next.outline}`,
      `-1px 1px 0 ${next.outline}`,
      `1px 1px 0 ${next.outline}`,
      `0 0 10px ${next.outline}`,
    ].join(", ");
  }
  return style;
}
