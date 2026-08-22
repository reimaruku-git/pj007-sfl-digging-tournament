export type CanvasTone =
  | "hero"
  | "thumb"
  | "podium-1"
  | "podium-2"
  | "podium-3"
  | "farm"
  | "avatar"
  | "sand"
  | "dusk"
  | "lantern";

const FARM_TONES: CanvasTone[] = ["farm", "lantern", "dusk", "sand"];

export function farmCanvasTone(farmId: string): CanvasTone {
  let n = 0;
  for (let i = 0; i < farmId.length; i += 1) {
    n = (n + farmId.charCodeAt(i) * (i + 1)) % FARM_TONES.length;
  }
  return FARM_TONES[n] ?? "farm";
}

export function ColorCanvas({
  tone,
  className = "",
}: {
  tone: CanvasTone;
  className?: string;
}) {
  return (
    <div
      className={["color-canvas", `tone-${tone}`, className].filter(Boolean).join(" ")}
      data-testid="color-canvas"
      data-tone={tone}
      role="presentation"
      aria-hidden="true"
    />
  );
}
