import type { TournamentImageSlot } from "./tournamentImages";

export type CropSlot = TournamentImageSlot | "avatar";

export type ImageFrame = {
  slot: CropSlot;
  width: number;
  height: number;
  label: string;
};

/** Fixed home frames. Image 1 is the 64×64 card; Image 2 is the 560px-tall hero. */
export const IMAGE_FRAMES: Record<CropSlot, ImageFrame> = {
  image_1: { slot: "image_1", width: 512, height: 512, label: "small card (1:1)" },
  image_2: { slot: "image_2", width: 1600, height: 560, label: "wide hero (1600×560)" },
  avatar: { slot: "avatar", width: 512, height: 512, label: "profile picture (1:1)" },
};

export function frameAspect(frame: ImageFrame): number {
  return frame.width / frame.height;
}

export function coverScale(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
): number {
  if (imageWidth <= 0 || imageHeight <= 0 || viewWidth <= 0 || viewHeight <= 0) return 1;
  return Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
}

export function centerOffset(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: (viewWidth - imageWidth * scale) / 2,
    y: (viewHeight - imageHeight * scale) / 2,
  };
}

export function clampOffset(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): { x: number; y: number } {
  const drawnW = imageWidth * scale;
  const drawnH = imageHeight * scale;
  const minX = Math.min(0, viewWidth - drawnW);
  const minY = Math.min(0, viewHeight - drawnH);
  return {
    x: Math.min(0, Math.max(minX, offsetX)),
    y: Math.min(0, Math.max(minY, offsetY)),
  };
}

export function visibleSourceRect(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
  scale: number,
  offsetX: number,
  offsetY: number,
): { sx: number; sy: number; sw: number; sh: number } {
  if (scale <= 0) {
    return { sx: 0, sy: 0, sw: imageWidth, sh: imageHeight };
  }
  const sx = Math.max(0, Math.min(imageWidth, -offsetX / scale));
  const sy = Math.max(0, Math.min(imageHeight, -offsetY / scale));
  const sw = Math.max(1, Math.min(imageWidth - sx, viewWidth / scale));
  const sh = Math.max(1, Math.min(imageHeight - sy, viewHeight / scale));
  return { sx, sy, sw, sh };
}

export function imageFitsFrame(
  imageWidth: number,
  imageHeight: number,
  frame: ImageFrame,
  epsilon = 0.02,
): boolean {
  if (imageWidth <= 0 || imageHeight <= 0) return false;
  const aspect = imageWidth / imageHeight;
  const target = frameAspect(frame);
  if (Math.abs(aspect - target) > epsilon) return false;
  return imageWidth <= frame.width + 1 && imageHeight <= frame.height + 1;
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    image.src = url;
  });
}

export async function cropImageToFrame(
  image: CanvasImageSource & { width: number; height: number },
  source: { sx: number; sy: number; sw: number; sh: number },
  frame: ImageFrame,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop image.");
  ctx.fillStyle = "#1a1815";
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, 0, 0, frame.width, frame.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (next) => (next ? resolve(next) : reject(new Error("Could not crop image."))),
      "image/jpeg",
      0.9,
    );
  });
  return new File([blob], `${frame.slot}.jpg`, { type: "image/jpeg" });
}
