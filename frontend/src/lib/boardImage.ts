import type { LeaderboardEntry, PrizePlace } from "../api/public";
import { homeBoardRows } from "./board";
import {
  formatDetailDateRangeUtc,
  formatPrizeAmount,
  formatScore,
  inclusiveFinalDayIso,
  joinedCountLabel,
  statusLabel,
} from "./format";

export const BOARD_IMAGE_LIMIT = 5;
export const BOARD_IMAGE_WIDTH = 1200;

const ROW_H = 64;

const BG = "#1a1815";
const PANEL = "#23201c";
const GOLD = "#b89a56";
const CREAM = "#e4dfd5";
const MUTE = "#9b9488";
const SAND = "#b4a890";
const LINE = "rgba(196, 184, 164, 0.16)";
const RANK = ["#b89a56", "#b4b8bf", "#b8885c"] as const;
const PODIUM_WASH = [
  "rgba(184, 154, 86, 0.22)",
  "rgba(180, 184, 191, 0.14)",
  "rgba(184, 136, 92, 0.16)",
] as const;

export type BoardImageRow = {
  rank: string;
  name: string;
  farm_id: string;
  total: string;
  avg: string;
  today: string;
  pebbles: number;
  place: number | null;
  status: string;
  you: boolean;
};

export type BoardImagePrize = {
  place: string;
  label: string;
};

export type BoardImagePodium = {
  place: 1 | 2 | 3;
  name: string;
  avg: string;
};

export type BoardImageGates = {
  participants: string;
  island: string;
  streak: string;
  vip: string;
  approval: string;
};

export type BoardImageModel = {
  brand: string;
  title: string;
  window: string;
  prize_pool: string;
  prizes: BoardImagePrize[];
  gates: BoardImageGates;
  podium: BoardImagePodium[];
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
  prize_places?: PrizePlace[] | null;
  entries: LeaderboardEntry[];
  total_count?: number;
  connected_farm_id?: string | null;
  enrolled_count?: number | null;
  max_players?: number | null;
  min_bumpkin_island?: string | null;
  min_digging_streak?: number | null;
  vip_required?: boolean | null;
  join_mode?: string | null;
};

export type BoardImageLayout = {
  width: number;
  height: number;
  innerLeft: number;
  innerRight: number;
  brandY: number;
  titleY: number;
  windowY: number;
  metaX: number;
  metaY: number;
  metaW: number;
  metaH: number;
  prizesW: number;
  podiumY: number;
  podiumH: number;
  tableHeadY: number;
  rowTop: number;
  rowH: number;
  footerY: number;
  captionY: number;
};

export function boardImageStandings(
  entries: LeaderboardEntry[],
  connectedFarmId?: string | null,
): LeaderboardEntry[] {
  return homeBoardRows(entries, null, connectedFarmId, BOARD_IMAGE_LIMIT);
}

export function boardImageFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "tournament"}-board.png`;
}

function placeSuffix(place: number): string {
  if (place === 1) return "ST";
  if (place === 2) return "ND";
  if (place === 3) return "RD";
  return "TH";
}

function islandLabel(island: string | null | undefined): string {
  if (!island) return "None";
  if (island === "volcano+") return "Volcano+";
  return island.charAt(0).toUpperCase() + island.slice(1);
}

function prizeLabel(item: PrizePlace): string {
  const nft = item.nft_name?.trim() || "";
  const flower = formatPrizeAmount(item.amount, { unit: "flower" });
  return [flower, nft].filter(Boolean).join(" · ") || "—";
}

function prizesForImage(
  places: PrizePlace[] | null | undefined,
  prizeAmount: string | null | undefined,
): PrizePlace[] {
  const sorted = [...(places ?? [])].sort((a, b) => a.place - b.place);
  if (sorted.length > 0) return sorted.slice(0, 3);
  const amount = (prizeAmount ?? "").trim();
  return amount ? [{ place: 1, amount }] : [];
}

function imageWindow(input: BoardImageInput): string {
  const end = input.duration_days
    ? inclusiveFinalDayIso(input.start_at, input.duration_days)
    : input.end_at;
  return formatDetailDateRangeUtc(input.start_at, end);
}

export function boardImageLayout(model: BoardImageModel): BoardImageLayout {
  const width = BOARD_IMAGE_WIDTH;
  const innerLeft = 64;
  const innerRight = width - 64;
  let y = 56;

  const brandY = y;
  y += 30;
  const titleY = y;
  y += 46;
  const windowY = y;
  y += 38;

  const metaX = innerLeft - 8;
  const metaY = y;
  const metaW = innerRight - innerLeft + 16;
  const prizesW = Math.round(metaW * 0.56);
  const metaH = 252;
  y += metaH + 28;

  const hasPodium = model.podium.length > 0;
  const podiumY = y;
  const podiumH = hasPodium ? 248 : 0;
  if (hasPodium) y += podiumH + 28;

  const tableHeadY = y;
  y += 30;
  const rowTop = y;
  y += ROW_H * model.rows.length + 18;

  const footerY = y;
  const captionY = y + 24;
  const height = captionY + 40;

  return {
    width,
    height,
    innerLeft,
    innerRight,
    brandY,
    titleY,
    windowY,
    metaX,
    metaY,
    metaW,
    metaH,
    prizesW,
    podiumY,
    podiumH,
    tableHeadY,
    rowTop,
    rowH: ROW_H,
    footerY,
    captionY,
  };
}

export function boardImageSize(model: BoardImageModel): { width: number; height: number } {
  const layout = boardImageLayout(model);
  return { width: layout.width, height: layout.height };
}

export function buildBoardImageModel(input: BoardImageInput): BoardImageModel {
  const title = input.name.trim() || "Tournament";
  const window = imageWindow(input);
  const prizePool = formatPrizeAmount(input.prize_amount, { unit: "flower" }) || "";
  const picked = boardImageStandings(input.entries, input.connected_farm_id);
  const mine = (input.connected_farm_id || "").trim();
  const rows = picked.map((row) => ({
    rank: row.rank == null ? "—" : String(row.rank),
    name: row.name?.trim() || "Unnamed farm",
    farm_id: row.farm_id,
    total: row.digs_to_third_op == null ? "—" : String(row.digs_to_third_op),
    avg: formatScore(row.score),
    today: row.score_today == null ? "—" : String(row.score_today),
    pebbles: Math.max(0, Math.min(3, row.otter_count ?? 0)),
    place: row.rank === 1 || row.rank === 2 || row.rank === 3 ? row.rank : null,
    status: statusLabel(row.status),
    you: Boolean(mine && row.farm_id === mine),
  }));
  const shown = Math.min(rows.length, BOARD_IMAGE_LIMIT);
  const total = input.total_count ?? input.entries.length;
  const appended = rows.length > shown;
  let caption: string;
  if (total > shown) {
    caption = appended
      ? `Top ${shown} of ${total} farms · plus your place`
      : `Top ${shown} of ${total} farms · fewest digs to 3 Otter Pebbles`;
  } else {
    caption = `${shown} farm${shown === 1 ? "" : "s"} · fewest digs to 3 Otter Pebbles`;
  }

  const prizes = prizesForImage(input.prize_places, input.prize_amount).map((item) => ({
    place: `${item.place}${placeSuffix(item.place)}`,
    label: prizeLabel(item),
  }));

  const first = input.entries.find((row) => row.rank === 1);
  const second = input.entries.find((row) => row.rank === 2);
  const third = input.entries.find((row) => row.rank === 3);
  const podium: BoardImagePodium[] = [];
  const toPodium = (entry: LeaderboardEntry | undefined, place: 1 | 2 | 3) => {
    if (!entry) return;
    podium.push({
      place,
      name: entry.name?.trim() || "Unnamed farm",
      avg: formatScore(entry.score),
    });
  };
  toPodium(second, 2);
  toPodium(first, 1);
  toPodium(third, 3);

  return {
    brand: "SFL Digging Tournament",
    title,
    window,
    prize_pool: prizePool,
    prizes,
    gates: {
      participants: joinedCountLabel(input.enrolled_count, input.max_players, total, true),
      island: islandLabel(input.min_bumpkin_island),
      streak: input.min_digging_streak == null ? "None" : String(input.min_digging_streak),
      vip: input.vip_required ? "Yes" : "No",
      approval: input.join_mode === "auto" ? "No" : "Yes",
    },
    podium,
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

function paintPebbles(ctx: CanvasRenderingContext2D, right: number, mid: number, count: number) {
  for (let i = 0; i < 3; i += 1) {
    const cx = right - 44 + i * 16;
    ctx.beginPath();
    ctx.arc(cx, mid, 5, 0, Math.PI * 2);
    if (i < count) {
      ctx.fillStyle = GOLD;
      ctx.fill();
    } else {
      ctx.strokeStyle = "rgba(184, 154, 86, 0.4)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function paintMeta(
  ctx: CanvasRenderingContext2D,
  model: BoardImageModel,
  layout: BoardImageLayout,
) {
  const { metaX, metaY, metaW, metaH, prizesW } = layout;
  roundedRect(ctx, metaX, metaY, metaW, metaH, 16);
  ctx.fillStyle = "rgba(20, 18, 16, 0.55)";
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  const prizesLeft = metaX + 22;
  const prizesRight = metaX + prizesW - 18;
  ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = MUTE;
  ctx.fillText("PRIZES", prizesLeft, metaY + 28);
  if (model.prize_pool) {
    ctx.textAlign = "right";
    ctx.fillStyle = GOLD;
    ctx.font = "700 14px Fraunces, Georgia, serif";
    ctx.fillText(fitText(ctx, model.prize_pool, prizesW - 120), prizesRight, metaY + 28);
  }

  model.prizes.forEach((item, index) => {
    const top = metaY + 48 + index * 62;
    roundedRect(ctx, prizesLeft, top, prizesRight - prizesLeft, 52, 12);
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.stroke();
    const mid = top + 26;
    ctx.beginPath();
    ctx.arc(prizesLeft + 22, mid, 12, 0, Math.PI * 2);
    ctx.fillStyle = RANK[index] ?? GOLD;
    ctx.fill();
    ctx.font = "700 12px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = BG;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), prizesLeft + 22, mid);
    ctx.textAlign = "left";
    ctx.fillStyle = MUTE;
    ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(item.place, prizesLeft + 44, mid);
    ctx.textAlign = "right";
    ctx.fillStyle = CREAM;
    ctx.font = "600 14px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillText(fitText(ctx, item.label, prizesW - 140), prizesRight - 14, mid);
  });

  const gateLeft = metaX + prizesW + 18;
  const gateRight = metaX + metaW - 22;
  const gateMid = (gateLeft + gateRight) / 2;
  const stats: Array<{ label: string; value: string; tone?: string }> = [
    { label: "PARTICIPANTS", value: model.gates.participants },
    { label: "MIN ISLAND", value: model.gates.island },
    { label: "MIN DIG STREAK", value: model.gates.streak },
    { label: "VIP STATUS", value: model.gates.vip, tone: model.gates.vip === "Yes" ? "yes" : "" },
    {
      label: "NEEDS APPROVAL",
      value: model.gates.approval,
      tone: model.gates.approval === "Yes" ? "yes" : "",
    },
  ];
  stats.forEach((stat, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = col === 0 ? gateLeft : gateMid + 12;
    const y = metaY + 28 + row * 72;
    const maxW = col === 0 ? gateMid - gateLeft - 16 : gateRight - gateMid - 8;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = MUTE;
    ctx.fillText(stat.label, x, y);
    ctx.font = "700 18px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = stat.tone === "yes" ? "#7d9a6e" : CREAM;
    ctx.fillText(fitText(ctx, stat.value, maxW), x, y + 26);
  });
}

function paintPodium(
  ctx: CanvasRenderingContext2D,
  model: BoardImageModel,
  layout: BoardImageLayout,
) {
  if (model.podium.length === 0) return;
  const { innerLeft, innerRight, podiumY, podiumH } = layout;
  const gap = 16;
  const cardW = (innerRight - innerLeft - gap * 2) / 3;
  const byPlace = new Map(model.podium.map((item) => [item.place, item]));
  const order: Array<1 | 2 | 3> = [2, 1, 3];
  order.forEach((place, slot) => {
    const item = byPlace.get(place);
    const x = innerLeft + slot * (cardW + gap);
    const taller = place === 1;
    const h = taller ? podiumH : podiumH - 28;
    const y = taller ? podiumY : podiumY + 28;
    roundedRect(ctx, x, y, cardW, h, 16);
    const wash = ctx.createLinearGradient(x, y, x, y + h);
    wash.addColorStop(0, PODIUM_WASH[place - 1]);
    wash.addColorStop(0.45, "rgba(26, 24, 21, 0.2)");
    wash.addColorStop(1, "rgba(26, 24, 21, 0.92)");
    ctx.fillStyle = wash;
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.stroke();

    ctx.font = "700 42px Fraunces, Georgia, serif";
    ctx.fillStyle = CREAM;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(place), x + 18, y + h - 78);

    const name = item?.name || "Open";
    ctx.font = "700 18px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = CREAM;
    ctx.fillText(fitText(ctx, name, cardW - 36), x + 18, y + h - 50);

    if (item) {
      ctx.font = "700 22px 'DM Mono', ui-monospace, monospace";
      ctx.fillStyle = CREAM;
      ctx.fillText(item.avg, x + 18, y + h - 22);
      const avgW = ctx.measureText(item.avg).width;
      ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillStyle = MUTE;
      ctx.fillText("AVG/DAY", x + 26 + avgW, y + h - 22);
    }
  });
}

function paintTable(
  ctx: CanvasRenderingContext2D,
  model: BoardImageModel,
  layout: BoardImageLayout,
) {
  const { innerLeft, innerRight, tableHeadY, rowTop, rowH } = layout;
  const colTotal = innerRight - 430;
  const colAvg = innerRight - 330;
  const colToday = innerRight - 236;
  const colPebbles = innerRight - 140;
  const colStatus = innerRight;
  const farmMax = colTotal - 36 - (innerLeft + 56);

  roundedRect(ctx, innerLeft - 8, tableHeadY - 18, innerRight - innerLeft + 16, 36, 10);
  ctx.fillStyle = "rgba(20, 18, 16, 0.7)";
  ctx.fill();

  ctx.font = "700 11px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("RANK", innerLeft, tableHeadY);
  ctx.fillText("FARM", innerLeft + 56, tableHeadY);
  ctx.textAlign = "right";
  ctx.fillText("TOTAL", colTotal, tableHeadY);
  ctx.fillText("AVG", colAvg, tableHeadY);
  ctx.fillText("TODAY", colToday, tableHeadY);
  ctx.fillText("PEBBLES", colPebbles, tableHeadY);
  ctx.fillText("STATUS", colStatus, tableHeadY);

  model.rows.forEach((row, index) => {
    const top = rowTop + index * rowH;
    const wash = row.you
      ? "rgba(184, 154, 86, 0.12)"
      : row.place === 1
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
      roundedRect(ctx, innerLeft - 8, top, innerRight - innerLeft + 16, rowH - 6, 10);
      ctx.fill();
    }

    const mid = top + (rowH - 6) / 2;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = "700 18px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = row.place ? RANK[row.place - 1] : CREAM;
    ctx.fillText(row.rank, innerLeft, mid);

    ctx.font = "700 16px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = CREAM;
    const nameDrawn = fitText(ctx, row.name, farmMax - (row.you ? 40 : 0));
    ctx.fillText(nameDrawn, innerLeft + 56, mid - 9);
    if (row.you) {
      const nameW = ctx.measureText(nameDrawn).width;
      ctx.font = "700 10px 'Source Sans 3', system-ui, sans-serif";
      ctx.fillStyle = GOLD;
      ctx.fillText("YOU", innerLeft + 64 + nameW, mid - 9);
    }
    ctx.font = "400 12px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = SAND;
    ctx.fillText(fitText(ctx, row.farm_id, farmMax), innerLeft + 56, mid + 12);

    ctx.textAlign = "right";
    ctx.font = "600 16px 'DM Mono', ui-monospace, monospace";
    ctx.fillStyle = CREAM;
    ctx.fillText(row.total, colTotal, mid);
    ctx.fillText(row.avg, colAvg, mid);
    ctx.fillText(row.today, colToday, mid);

    paintPebbles(ctx, colPebbles, mid, row.pebbles);

    ctx.font = "600 12px 'Source Sans 3', system-ui, sans-serif";
    ctx.fillStyle = row.status === "Completed" ? "#7d9a6e" : SAND;
    ctx.fillText(row.status, colStatus, mid);
  });
}

export function paintBoardImage(
  ctx: CanvasRenderingContext2D,
  model: BoardImageModel,
  width: number,
  height: number,
): void {
  const layout = boardImageLayout(model);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(width / 2, 0, width / 2, 280);
  gradient.addColorStop(0, "rgba(184, 154, 86, 0.16)");
  gradient.addColorStop(1, "rgba(184, 154, 86, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, 300);

  roundedRect(ctx, 22, 22, width - 44, height - 44, 18);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  const { innerLeft, innerRight } = layout;

  ctx.fillStyle = GOLD;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(innerLeft + 8 + i * 14, layout.brandY + (i === 1 ? 3 : 0), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = "700 12px 'Source Sans 3', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = GOLD;
  ctx.fillText(model.brand.toUpperCase(), innerLeft + 52, layout.brandY);

  ctx.font = "700 34px Fraunces, Georgia, serif";
  ctx.fillStyle = CREAM;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(fitText(ctx, model.title, innerRight - innerLeft), innerLeft, layout.titleY);

  ctx.font = "400 15px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.fillText(model.window, innerLeft, layout.windowY);

  paintMeta(ctx, model, layout);
  paintPodium(ctx, model, layout);
  paintTable(ctx, model, layout);

  ctx.beginPath();
  ctx.moveTo(innerLeft, layout.footerY);
  ctx.lineTo(innerRight, layout.footerY);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = "400 13px 'Source Sans 3', system-ui, sans-serif";
  ctx.fillStyle = MUTE;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(model.caption, innerLeft, layout.captionY);
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
  const { width, height } = boardImageSize(model);
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
