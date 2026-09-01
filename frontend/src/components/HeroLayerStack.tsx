import { ColorCanvas } from "./ColorCanvas";
import { heroLayerStyle, normalizeHeroLayers } from "../lib/heroLayers";
import type { HeroLayer } from "../api/public";

export function HeroLayerStack({
  src,
  layers,
  className,
  imageClassName = "tournament-hero-image",
  imageTestId,
}: {
  src?: string | null;
  layers?: HeroLayer[] | null;
  className?: string;
  imageClassName?: string;
  imageTestId?: string;
}) {
  const stack = normalizeHeroLayers(layers);
  return (
    <div className={className}>
      {src ? (
        <img src={src} alt="" className={imageClassName} data-testid={imageTestId} />
      ) : (
        <ColorCanvas tone="hero" />
      )}
      {src
        ? stack.map((layer, index) => (
            <div
              key={`${layer.kind}-${index}`}
              className={layer.kind === "dusk" ? "hero-layer is-dusk" : "hero-layer is-color"}
              style={heroLayerStyle(layer)}
              data-testid="hero-layer"
              data-kind={layer.kind}
            >
              {layer.kind === "dusk" ? <ColorCanvas tone="hero" /> : null}
            </div>
          ))
        : null}
    </div>
  );
}
