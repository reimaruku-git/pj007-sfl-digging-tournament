import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageCropModal } from "./ImageCropModal";

let root: Root;
let container: HTMLDivElement;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;

function stubImage(width: number, height: number) {
  class FakeImage {
    width = width;
    height = height;
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    _src = "";
    get src() {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  stubImage(4000, 3000);
  URL.createObjectURL = () => "blob:crop-test";
  URL.revokeObjectURL = () => undefined;
  HTMLCanvasElement.prototype.getContext = () =>
    ({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
    }) as unknown as CanvasRenderingContext2D;
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(new Blob(["jpeg-bytes"], { type: type || "image/jpeg" }));
  };
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  vi.unstubAllGlobals();
});

describe("ImageCropModal", () => {
  it("crops the chosen region to the Image 2 frame", async () => {
    const onApply = vi.fn();
    const file = new File(["photo"], "wide.png", { type: "image/png" });
    await act(async () => {
      root.render(
        <ImageCropModal
          job={{ slot: "image_2", file }}
          onApply={onApply}
          onCancel={() => undefined}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector('[data-testid="image-crop-modal"]')).not.toBeNull();
    expect(container.textContent).toMatch(/Image 2/);
    expect(container.textContent).toMatch(/1600×560/);
    await act(async () => {
      const apply = [...container.querySelectorAll("button")].find((node) =>
        node.textContent?.includes("Use this crop"),
      );
      apply?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(onApply).toHaveBeenCalledTimes(1);
    const cropped = onApply.mock.calls[0][0] as File;
    expect(cropped.type).toBe("image/jpeg");
    expect(cropped.name).toBe("image_2.jpg");
  });
});
