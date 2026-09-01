import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import {
  IMAGE_FRAMES,
  centerOffset,
  clampOffset,
  coverScale,
  cropImageToFrame,
  loadImageFromFile,
  visibleSourceRect,
  type CropSlot,
  type ImageFrame,
} from "../lib/imageCrop";

type CropJob = {
  slot: CropSlot;
  file: File;
};

export function ImageCropModal({
  job,
  onApply,
  onCancel,
}: {
  job: CropJob;
  onApply: (file: File) => void;
  onCancel: () => void;
}) {
  const frame: ImageFrame = IMAGE_FRAMES[job.slot];
  const viewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    let loaded: HTMLImageElement | null = null;
    setImage(null);
    setError(null);
    loadImageFromFile(job.file)
      .then((next) => {
        loaded = next;
        if (cancelled) {
          URL.revokeObjectURL(next.src);
          return;
        }
        setImage(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      if (loaded?.src.startsWith("blob:")) URL.revokeObjectURL(loaded.src);
    };
  }, [job.file]);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return undefined;
    const sync = () => {
      const width = el.clientWidth || 640;
      const height = el.clientHeight || Math.round(width * (frame.height / frame.width));
      setView({ w: width, h: height });
    };
    sync();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [image, frame.width, frame.height]);

  const minScale =
    image && view.w > 0 && view.h > 0
      ? coverScale(image.naturalWidth || image.width, image.naturalHeight || image.height, view.w, view.h)
      : 1;
  const maxScale = minScale * 3;
  const imgW = image ? image.naturalWidth || image.width : 0;
  const imgH = image ? image.naturalHeight || image.height : 0;

  useEffect(() => {
    if (!image || view.w <= 0 || view.h <= 0) return;
    const nextScale = coverScale(imgW, imgH, view.w, view.h);
    setScale(nextScale);
    setOffset(centerOffset(imgW, imgH, view.w, view.h, nextScale));
  }, [image, view.w, view.h, imgW, imgH]);

  function setZoom(next: number) {
    const zoom = Math.min(maxScale, Math.max(minScale, next));
    setScale(zoom);
    setOffset((current) => clampOffset(imgW, imgH, view.w, view.h, zoom, current.x, current.y));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !image) return;
    setOffset(
      clampOffset(
        imgW,
        imgH,
        view.w,
        view.h,
        scale,
        drag.ox + (event.clientX - drag.x),
        drag.oy + (event.clientY - drag.y),
      ),
    );
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  async function apply() {
    if (!image) return;
    setBusy(true);
    setError(null);
    try {
      const source = visibleSourceRect(imgW, imgH, view.w, view.h, scale, offset.x, offset.y);
      const file = await cropImageToFrame(image, source, frame);
      onApply(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop image.");
      setBusy(false);
    }
  }

  const title = job.slot === "avatar" ? "Profile picture" : job.slot === "image_1" ? "Image 1" : "Image 2";

  return (
    <div className="image-crop-overlay" data-testid="image-crop-modal" role="dialog" aria-modal="true">
      <div className="image-crop-window">
        <h3>Choose what {title} shows</h3>
        <p className="meta">
          Drag to pick the part that fits the {frame.label} frame. Zoom if the photo is larger.
        </p>
        {error && <p className="flash err">{error}</p>}
        <div className="image-crop-stage">
          <div
            ref={viewRef}
            className="image-crop-viewport"
            data-testid="image-crop-viewport"
            style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {image && (
              <img
                alt=""
                draggable={false}
                src={image.src}
                className="image-crop-photo"
                data-testid="image-crop-photo"
                style={{
                  width: imgW * scale,
                  height: imgH * scale,
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                }}
              />
            )}
          </div>
        </div>
        <label className="image-crop-zoom">
          Zoom
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={minScale / 40 || 0.01}
            value={scale}
            disabled={!image}
            data-testid="image-crop-zoom"
            onChange={(event) => setZoom(Number(event.target.value))}
          />
        </label>
        <div className="toolbar">
          <button className="btn primary" type="button" onClick={() => void apply()} disabled={!image || busy}>
            {busy ? "Cropping…" : "Use this crop"}
          </button>
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
