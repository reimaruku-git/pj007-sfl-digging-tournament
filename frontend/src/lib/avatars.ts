export type AvatarKind = "preset" | "upload";

export type AvatarFields = {
  avatar_kind?: AvatarKind | null;
  avatar_preset?: string | null;
  avatar_url?: string | null;
};

export type AvatarPreset = {
  id: string;
  name: string;
  file: string;
};

/** NPC stills copied from sunflower-land/sunflower-land `src/assets/npcs`. */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "genie", name: "Genie", file: "genie.png" },
  { id: "hammerin_harry", name: "Hammerin' Harry", file: "hammerin_harry.webp" },
  { id: "hoot", name: "Hoot", file: "hoot.png" },
  { id: "island_boat_pirate", name: "Pirate", file: "island_boat_pirate.png" },
  { id: "maximus", name: "Maximus", file: "maximus.png" },
  { id: "nightshade_bumpkin", name: "Nightshade", file: "nightshade_bumpkin.png" },
  { id: "obie", name: "Obie", file: "obie.png" },
  { id: "snorkel_bumpkin", name: "Snorkel", file: "snorkel_bumpkin.png" },
  { id: "workbenchman", name: "Workbench", file: "workbenchman.png" },
];

export const AVATAR_PRESET_IDS = new Set(AVATAR_PRESETS.map((row) => row.id));

export function presetSrc(presetId: string): string | null {
  const match = AVATAR_PRESETS.find((row) => row.id === presetId);
  return match ? `/avatars/${match.file}` : null;
}

export function avatarSrc(fields: AvatarFields | null | undefined): string | null {
  if (!fields) return null;
  if (fields.avatar_kind === "preset" && fields.avatar_preset) {
    return presetSrc(fields.avatar_preset);
  }
  if (fields.avatar_kind === "upload" && fields.avatar_url) {
    return fields.avatar_url;
  }
  return null;
}
