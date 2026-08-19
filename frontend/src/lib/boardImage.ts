import type { LeaderboardEntry } from "../api/public";
import { formatDateRangeUtc, formatScore } from "./format";

export const BOARD_IMAGE_LIMIT = 10;
export const BOARD_IMAGE_WIDTH = 1200;

const PAD = 44;
const HEADER = 168;
const COL_HEAD = 34;
const ROW_H = 70;
const FOOTER = 54;

const BG = "#1a1815";
const PANEL = "#23201c";
const GOLD = "#b89a56";
const CREAM = "#e4dfd5";
const MUTE = "#9b9488";
const SAND = "#b4a890";
const LINE = "rgba(196, 184, 164, 0.16)";
const RANK = ["#b89a56", "#b4b8bf", "#b8885c"] as const;

export type BoardImageRow = {
  rank: string;
  name: string;
  farm_id: string;
  total: string;
  avg: string;
  today: string;
  pebbles: number;
  place: number | null;
};

export type BoardImageModel = {
  brand: string;
  title: string;
  subtitle: string;
  caption: string;
  filename: string;
  rows: BoardImageRow[];
};

export type BoardImageInput = {
  name: string;
  start_at: string | null;
  end_at: string | null;
  duration_days?: number | null;
  prize_amount?: string | null;
  entries: LeaderboardEntry[];
  total_count?: number;
};

export function boardImageFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "tournament"}-top-10.png`;
}

export function boardImageSize(rowCount: number): { width: number; height: number } {
  const n = Math.max(rowCount, 1);
  return {
    width: BOARD_IMAGE_WIDTH,
    height: PAD + HEADER + COL_HEAD + ROW_H * n + FOOTER + PAD,
  };
}

export function buildBoardImageModel(input: BoardImageInput): BoardImageModel {
  const title = input.name.trim() || "Tournament";
  const window = formatDateRangeUtc(input.start_at, input.end_at, input.duration_days);
  const prize = input.prize_amount ? `${input.prize_amount} Flower` : "";
  const ranked = [...input.entries].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  const rows = ranked.slice(0, BOARD_IMAGE_LIMIT).map((row) => ({
    rank: row.rank == null ? "—" : String(row.rank),
    name: row.name?.trim() || "Unnamed farm",
    farm_id: row.farm_id,
    total: row.digs_to_third_op == null ? "—" : String(row.digs_to_third_op),
    avg: formatScore(row.score),
    today: row.score_today == null ? "—" : String(row.score_today),
    pebbles: Math.max(0, Math.min(3, row.otter_count ?? 0)),
    place: row.rank === 1 || row.rank === 2 || row.rank === 3 ? row.rank : null,
  }));
  const shown = rows.length;
  const total = input.total_count ?? input.entries.length;
  const caption =
    total > shown
      ? `Top ${shown} of ${total} farms · fewest digs to 3 Otter Pebbles`
      : `${shown} farm${shown === 1 ? "" : "s"} · fewest digs to 3 Otter Pebbles`;
  const bits = [window, prize].filter(Boolean);
  return {
    brand: "SFL Digging Tournament",
    title,
    subtitle: bits.join("  ·  "),
    caption,
    filename: boardImageFilename(title),
    rows,
  };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return (low > 0 ? text.slice(0, low) : text.slice(0, 1)) + ellipsis;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function paintBoardImage(
  ctx: CanvasRenderingContext2D,
  model: BoardImageModel,
  width: number,
  height: number,
): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(width / 2, 0, width / 2, 220);
  gradient.addColorStop(0, "rgba(184, 154, 86, 0.16)");
  gradient.addColorStop(1, "rgba(184, 154, 86, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, 240);

  roundedRect(ctx, 22, 22, width - 44, height - 44, 18);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  const innerLeft = PAD + 8;
  const innerRight = width - PAD - 8;
  let y = PAD + 18;

  ctx.fillStyle = GOLD;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(innerLeft + 8 + i * 14, y + (i === 1 ? 3 : 0), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = "700 12px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = GOLD;
  ctx.fillText(model.brand.toUpperCase(), innerLeft + 52, y);
  y += 42;

  ctx.font = "700 34px Fraunces, Georgia, serif";
  ctx.fillStyle = CREAM;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitText(ctx, model.title, innerRight - innerLeft), innerLeft, y);
  y += 28;

  ctx.font = "400 15px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.fillText(model.subtitle, innerLeft, y);
  y += 28;

  ctx.beginPath();
  ctx.moveTo(innerLeft, y);
  ctx.lineTo(innerRight, y);
  ctx.strokeStyle = LINE;
  ctx.stroke();
  y += 28;

  const colTotal = innerRight - 300;
  const colAvg = innerRight - 188;
  const colToday = innerRight - 92;
  const colPebbles = innerRight - 8;
  const farmMax = colTotal - 36 - (innerLeft + 56);

  ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.textAlign = "left";
  ctx.fillText("RANK", innerLeft, y);
  ctx.fillText("FARM", innerLeft + 56, y);
  ctx.textAlign = "right";
  ctx.fillText("TOTAL", colTotal, y);
  ctx.fillText("AVG / DAY", colAvg, y);
  ctx.fillText("TODAY", colToday, y);
  ctx.fillText("PEBBLES", colPebbles, y);
  y += 14;

  const rowTop = y;
  model.rows.forEach((row, index) => {
    const top = rowTop + index * ROW_H;
    const wash =
      row.place === 1
        ? "rgba(184, 154, 86, 0.10)"
        : row.place === 2
          ? "rgba(180, 184, 191, 0.07)"
          : row.place === 3
            ? "rgba(184, 136, 92, 0.08)"
            : index % 2 === 0
              ? "rgba(255, 255, 255, 0.015)"
              : "";
    if (wash) {
      ctx.fillStyle = wash;
      roundedRect(ctx, innerLeft - 8, top, innerRight - innerLeft + 16, ROW_H - 6, 10);
      ctx.fill();
    }

    const mid = top + (ROW_H - 6) / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "700 18px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = row.place ? RANK[row.place - 1] : CREAM;
    ctx.fillText(row.rank, innerLeft, mid);

    ctx.font = "700 16px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = CREAM;
    ctx.fillText(fitText(ctx, row.name, farmMax), innerLeft + 56, mid - 9);
    ctx.font = "400 12px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = SAND;
    ctx.fillText(fitText(ctx, row.farm_id, farmMax), innerLeft + 56, mid + 12);

    ctx.textAlign = "right";
    ctx.font = "600 16px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = CREAM;
    ctx.fillText(row.total, colTotal, mid);
    ctx.fillText(row.avg, colAvg, mid);
    ctx.fillText(row.today, colToday, mid);

    const pebbleRight = colPebbles;
    for (let i = 0; i < 3; i += 1) {
      const cx = pebbleRight - 44 + i * 16;
      ctx.beginPath();
      ctx.arc(cx, mid, 5, 0, Math.PI * 2);
      if (i < row.pebbles) {
        ctx.fillStyle = GOLD;
        ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(184, 154, 86, 0.4)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  });

  const footerY = rowTop + model.rows.length * ROW_H + 18;
  ctx.beginPath();
  ctx.moveTo(innerLeft, footerY);
  ctx.lineTo(innerRight, footerY);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "400 13px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(model.caption, innerLeft, footerY + 24);
}

async function waitForFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    /* draw with fallbacks */
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Could not render tournament image"));
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => (blob ? resolve(blob) : fail()), "image/png");
      return;
    }
    try {
      const data = canvas.toDataURL("image/png");
      const comma = data.indexOf(",");
      const raw = comma >= 0 ? data.slice(comma + 1) : "";
      const binary = atob(raw);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/png" }));
    } catch {
      fail();
    }
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function downloadTournamentBoardImage(input: BoardImageInput): Promise<void> {
  const model = buildBoardImageModel(input);
  if (model.rows.length === 0) {
    throw new Error("No standings to download yet");
  }
  await waitForFonts();
  const { width, height } = boardImageSize(model.rows.length);
  const dpr = typeof window !== "undefined" ? Math.max(2, window.devicePixelRatio || 1) : 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not render tournament image");
  ctx.scale(dpr, dpr);
  paintBoardImage(ctx, model, width, height);
  const blob = await canvasToBlob(canvas);
  triggerDownload(blob, model.filename);
}
