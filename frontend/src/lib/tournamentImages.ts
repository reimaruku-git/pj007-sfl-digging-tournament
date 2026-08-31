import { uploadAdminTournamentImage } from "../api/admin";

export type TournamentImageSlot = "image_1" | "image_2";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 2 * 1024 * 1024;

export function validateTournamentImageFile(file: File): string | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "Use a JPEG, PNG, WebP, or GIF image.";
  }
  if (file.size > MAX_BYTES) {
    return "Image must be 2 MB or smaller.";
  }
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const comma = text.indexOf(",");
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error("failed to read image"));
    reader.readAsDataURL(file);
  });
}

export async function uploadTournamentImage(
  tournamentId: string,
  slot: TournamentImageSlot,
  file: File,
): Promise<string> {
  const issue = validateTournamentImageFile(file);
  if (issue) throw new Error(issue);
  const data = await fileToBase64(file);
  const uploaded = await uploadAdminTournamentImage(tournamentId, slot, file.type, data);
  return uploaded.public_url;
}

export async function uploadPendingTournamentImages(
  tournamentId: string,
  pending: Partial<Record<TournamentImageSlot, File | null>>,
): Promise<Partial<Record<`${TournamentImageSlot}_url`, string>>> {
  const patch: Partial<Record<`${TournamentImageSlot}_url`, string>> = {};
  for (const slot of ["image_1", "image_2"] as const) {
    const file = pending[slot];
    if (!file) continue;
    patch[`${slot}_url`] = await uploadTournamentImage(tournamentId, slot, file);
  }
  return patch;
}
