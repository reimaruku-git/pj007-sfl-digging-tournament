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

/** Idle stills of named SFL NPCs, shipped in `frontend/public/avatars`. */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "jafar", name: "Jafar", file: "jafar.webp" },
  { id: "betty", name: "Betty", file: "betty.webp" },
  { id: "blacksmith", name: "Blacksmith", file: "blacksmith.webp" },
  { id: "corale", name: "Corale", file: "corale.webp" },
  { id: "tango", name: "Tango", file: "tango.webp" },
  { id: "old_salty", name: "Old Salty", file: "old_salty.webp" },
  { id: "victoria", name: "Victoria", file: "victoria.webp" },
  { id: "jester", name: "Jester", file: "jester.webp" },
  { id: "tywin", name: "Tywin", file: "tywin.webp" },
  { id: "timmy", name: "Timmy", file: "timmy.webp" },
  { id: "pumpkin_pete", name: "Pumpkin' Pete", file: "pumpkin_pete.webp" },
  { id: "bert", name: "Bert", file: "bert.webp" },
  { id: "finley", name: "Finley", file: "finley.webp" },
  { id: "pharaoh", name: "Pharaoh", file: "pharaoh.webp" },
  { id: "cornwell", name: "Cornwell", file: "cornwell.webp" },
  { id: "miranda", name: "Miranda", file: "miranda.webp" },
  { id: "raven", name: "Raven", file: "raven.webp" },
  { id: "finn", name: "Finn", file: "finn.webp" },
  { id: "gambit", name: "Gambit", file: "gambit.webp" },
  { id: "gordo", name: "Gordo", file: "gordo.webp" },
  { id: "grimbly", name: "Grimbly", file: "grimbly.webp" },
  { id: "grimtooth", name: "Grimtooth", file: "grimtooth.webp" },
  { id: "grubnuk", name: "Grubnuk", file: "grubnuk.webp" },
  { id: "guria", name: "Guria", file: "guria.webp" },
  { id: "hammerin_harry", name: "Hammerin' Harry", file: "hammerin_harry.webp" },
  { id: "mayor", name: "Mayor", file: "mayor.webp" },
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
