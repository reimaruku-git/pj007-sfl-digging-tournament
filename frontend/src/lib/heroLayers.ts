import type { CSSProperties } from "react";
import type { HeroLayer } from "../api/public";

export const MAX_HERO_LAYERS = 6;
export const DEFAULT_DUSK_OPACITY = 0.78;
export const DEFAULT_HERO_LAYERS: HeroLayer[] = [{ kind: "dusk", opacity: DEFAULT_DUSK_OPACITY }];

function clampOpacity(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_DUSK_OPACITY;
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

export function normalizeHeroLayer(raw: HeroLayer | null | undefined): HeroLayer | null {
  const kind = raw?.kind === "color" ? "color" : raw?.kind === "dusk" ? "dusk" : null;
  if (!kind) return null;
  const opacity = clampOpacity(raw?.opacity);
  if (kind === "dusk") return { kind: "dusk", opacity };
  const color = String(raw?.color || "").trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) return null;
  return { kind: "color", color, opacity };
}

export function normalizeHeroLayers(raw?: HeroLayer[] | null): HeroLayer[] {
  if (raw == null) return DEFAULT_HERO_LAYERS.map((layer) => ({ ...layer }));
  if (!Array.isArray(raw)) return DEFAULT_HERO_LAYERS.map((layer) => ({ ...layer }));
  const next: HeroLayer[] = [];
  for (const item of raw) {
    const layer = normalizeHeroLayer(item);
    if (layer) next.push(layer);
    if (next.length >= MAX_HERO_LAYERS) break;
  }
  return next;
}

export function heroLayerStyle(layer: HeroLayer): CSSProperties {
  if (layer.kind === "color") {
    return { background: layer.color, opacity: layer.opacity };
  }
  return { opacity: layer.opacity };
}
