import { describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "../api/public";
import {
  BOARD_IMAGE_LIMIT,
  boardImageFilename,
  boardImageSize,
  buildBoardImageModel,
  paintBoardImage,
} from "./boardImage";

function entry(
  partial: Partial<LeaderboardEntry> & Pick<LeaderboardEntry, "farm_id" | "rank" | "score">,
): LeaderboardEntry {
  return {
    name: partial.name ?? `farm-${partial.farm_id}`,
    digs_to_third_op: 10,
    otter_count: 3,
    digs_today: 0,
    score_today: 10,
    total_digs: 10,
    last_updated_at: null,
    status: "completed",
    invalidated: false,
    ...partial,
  };
}

function mockCtx() {
  const texts: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    lineWidth: 1,
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    arcTo() {},
    fillText(text: string) {
      texts.push(text);
    },
    measureText(text: string) {
      return { width: text.length * 8 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

describe("boardImageFilename", () => {
  it("slugs the tournament name", () => {
    expect(boardImageFilename("Creators Digging Tournament")).toBe(
      "creators-digging-tournament-top-10.png",
    );
    expect(boardImageFilename("  ")).toBe("tournament-top-10.png");
  });
});

describe("buildBoardImageModel", () => {
  it("keeps official rank order, caps at 10, and formats records", () => {
    const entries = [
      entry({ farm_id: "2", rank: 2, score: 19.33, name: "kkuummaa", digs_to_third_op: 58 }),
      entry({
        farm_id: "1",
        rank: 1,
        score: 18.333,
        name: "Freako",
        digs_to_third_op: 55,
        score_today: 16,
      }),
      ...Array.from({ length: 12 }, (_, index) =>
        entry({
          farm_id: `p${index + 3}`,
          rank: index + 3,
          score: 20 + index,
          name: `Player ${index + 3}`,
        }),
      ),
    ];
    const model = buildBoardImageModel({
      name: "Creators Digging Tournament",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "30",
      entries,
      total_count: 14,
    });
    expect(model.rows).toHaveLength(BOARD_IMAGE_LIMIT);
    expect(model.rows[0]).toMatchObject({
      rank: "1",
      name: "Freako",
      total: "55",
      avg: "18.33",
      today: "16",
      pebbles: 3,
      place: 1,
    });
    expect(model.rows[1]?.name).toBe("kkuummaa");
    expect(model.rows.map((row) => row.name)).not.toContain("Player 13");
    expect(model.subtitle).toMatch(/17 Aug → 24 Aug · 7d/);
    expect(model.subtitle).toMatch(/30 Flower/);
    expect(model.caption).toBe("Top 10 of 14 farms · fewest digs to 3 Otter Pebbles");
    expect(model.filename).toBe("creators-digging-tournament-top-10.png");
  });

  it("falls back for missing names, scores, and pebbles", () => {
    const model = buildBoardImageModel({
      name: "",
      start_at: null,
      end_at: null,
      entries: [
        entry({
          farm_id: "x",
          rank: null,
          score: null,
          name: "  ",
          digs_to_third_op: null,
          score_today: null,
          otter_count: 9,
        }),
      ],
    });
    expect(model.title).toBe("Tournament");
    expect(model.rows[0]).toMatchObject({
      rank: "—",
      name: "Unnamed farm",
      total: "—",
      avg: "—",
      today: "—",
      pebbles: 3,
      place: null,
    });
    expect(model.caption).toMatch(/1 farm ·/);
  });
});

describe("paintBoardImage", () => {
  it("draws the title and top-row records onto the canvas", () => {
    const model = buildBoardImageModel({
      name: "Creators Digging Tournament",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "30",
      entries: [
        entry({ farm_id: "197333", rank: 1, score: 18.33, name: "Freako", digs_to_third_op: 55 }),
      ],
    });
    const { ctx, texts } = mockCtx();
    const size = boardImageSize(model.rows.length);
    paintBoardImage(ctx, model, size.width, size.height);
    expect(texts.join(" ")).toMatch(/SFL DIGGING TOURNAMENT/i);
    expect(texts).toContain("Creators Digging Tournament");
    expect(texts).toContain("Freako");
    expect(texts).toContain("197333");
    expect(texts).toContain("55");
    expect(texts).toContain("18.33");
    expect(texts).toContain("RANK");
    expect(texts).toContain("TOTAL");
    expect(texts).toContain("AVG / DAY");
  });
});
