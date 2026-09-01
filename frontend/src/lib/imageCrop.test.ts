import { describe, expect, it } from "vitest";
import {
  IMAGE_FRAMES,
  centerOffset,
  clampOffset,
  coverScale,
  frameAspect,
  imageFitsFrame,
  visibleSourceRect,
} from "./imageCrop";

describe("imageCrop", () => {
  it("uses a 1:1 card, a 1600×560 hero frame, and a 1:1 profile crop", () => {
    expect(IMAGE_FRAMES.image_1).toMatchObject({ width: 512, height: 512 });
    expect(IMAGE_FRAMES.image_2).toMatchObject({ width: 1600, height: 560 });
    expect(IMAGE_FRAMES.avatar).toMatchObject({ width: 512, height: 512 });
    expect(frameAspect(IMAGE_FRAMES.image_1)).toBe(1);
    expect(frameAspect(IMAGE_FRAMES.avatar)).toBe(1);
    expect(frameAspect(IMAGE_FRAMES.image_2)).toBeCloseTo(1600 / 560);
  });

  it("scales to cover the viewport", () => {
    expect(coverScale(2000, 1000, 1600, 560)).toBeCloseTo(0.8);
    expect(coverScale(800, 800, 512, 512)).toBe(0.64);
  });

  it("keeps the photo covering the frame when panning", () => {
    const scale = coverScale(2000, 1000, 1600, 560);
    const center = centerOffset(2000, 1000, 1600, 560, scale);
    expect(center.x).toBe(0);
    expect(center.y).toBeLessThan(0);
    const tooFar = clampOffset(2000, 1000, 1600, 560, scale, 40, 200);
    expect(tooFar.x).toBe(0);
    expect(tooFar.y).toBe(0);
  });

  it("maps the visible window back to source pixels", () => {
    const scale = 0.5;
    const rect = visibleSourceRect(2000, 1000, 800, 280, scale, -100, -40);
    expect(rect.sx).toBe(200);
    expect(rect.sy).toBe(80);
    expect(rect.sw).toBe(1600);
    expect(rect.sh).toBe(560);
  });

  it("requires a crop when the photo is larger or the wrong shape", () => {
    expect(imageFitsFrame(1600, 560, IMAGE_FRAMES.image_2)).toBe(true);
    expect(imageFitsFrame(4000, 3000, IMAGE_FRAMES.image_2)).toBe(false);
    expect(imageFitsFrame(512, 512, IMAGE_FRAMES.image_1)).toBe(true);
    expect(imageFitsFrame(800, 400, IMAGE_FRAMES.image_1)).toBe(false);
  });
});
