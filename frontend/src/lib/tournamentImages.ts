import { presignTournamentImage } from "../api/admin";

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

export async function uploadTournamentImage(
  tournamentId: string,
  slot: TournamentImageSlot,
  file: File,
): Promise<string> {
  const issue = validateTournamentImageFile(file);
  if (issue) throw new Error(issue);
  const presigned = await presignTournamentImage(tournamentId, slot, file.type);
  const response = await fetch(presigned.upload_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!response.ok) {
    throw new Error(`failed to upload ${slot}`);
  }
  return presigned.public_url;
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
