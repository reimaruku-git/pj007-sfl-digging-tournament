import { ColorCanvas, type CanvasTone } from "./ColorCanvas";
import { avatarSrc, type AvatarFields } from "../lib/avatars";

export function FarmAvatar({
  fields,
  className = "",
  fallbackTone = "avatar",
  alt = "",
}: {
  fields?: AvatarFields | null;
  className?: string;
  fallbackTone?: CanvasTone;
  alt?: string;
}) {
  const src = avatarSrc(fields);
  if (!src) {
    return <ColorCanvas tone={fallbackTone} className={className} />;
  }
  const kind = fields?.avatar_kind === "upload" ? "upload" : "preset";
  return (
    <span
      className={["farm-avatar", `is-${kind}`, className].filter(Boolean).join(" ")}
      data-testid="farm-avatar"
    >
      <img src={src} alt={alt} />
    </span>
  );
}
