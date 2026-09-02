import { describe, expect, it } from "vitest";
import type { LeaderboardEntry } from "../api/public";
import {
  BOARD_IMAGE_LIMIT,
  boardImageFilename,
  boardImageLayout,
  boardImageSize,
  boardImageStandings,
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

function rankedFarms(count: number): LeaderboardEntry[] {
  return Array.from({ length: count }, (_, index) =>
    entry({
      farm_id: String(index + 1),
      rank: index + 1,
      score: 10 + index,
      name: `Farm ${index + 1}`,
      digs_to_third_op: 20 + index,
    }),
  );
}

function mockCtx() {
  const texts: string[] = [];
  const textYs: number[] = [];
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
    fillText(text: string, _x?: number, y?: number) {
      texts.push(text);
      if (typeof y === "number") textYs.push(y);
    },
    measureText(text: string) {
      return { width: text.length * 8 };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, textYs };
}

describe("boardImageFilename", () => {
  it("slugs the tournament name", () => {
    expect(boardImageFilename("Creators Digging Tournament")).toBe(
      "creators-digging-tournament-board.png",
    );
    expect(boardImageFilename("  ")).toBe("tournament-board.png");
  });
});

describe("boardImageStandings", () => {
  it("keeps official rank order and caps at the top 5", () => {
    const rows = boardImageStandings(rankedFarms(12));
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.name)).toEqual(["Farm 1", "Farm 2", "Farm 3", "Farm 4", "Farm 5"]);
    expect(rows.map((row) => row.name)).not.toContain("Farm 6");
    expect(rows.map((row) => row.name)).not.toContain("Farm 12");
  });

  it("appends the connected farm as a 6th row with its real rank", () => {
    const rows = boardImageStandings(rankedFarms(12), "12");
    expect(rows).toHaveLength(6);
    expect(rows[5]?.farm_id).toBe("12");
    expect(rows[5]?.rank).toBe(12);
    expect(rows[5]?.name).toBe("Farm 12");
    expect(rows.slice(0, 5).map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not duplicate a connected farm already in the top 5", () => {
    const rows = boardImageStandings(rankedFarms(12), "3");
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.farm_id === "3")).toHaveLength(1);
    expect(rows[2]?.name).toBe("Farm 3");
  });

  it("ignores a missing or unknown connected farm id", () => {
    expect(boardImageStandings(rankedFarms(12), null)).toHaveLength(5);
    expect(boardImageStandings(rankedFarms(12), "")).toHaveLength(5);
    expect(boardImageStandings(rankedFarms(12), "99")).toHaveLength(5);
  });
});

describe("buildBoardImageModel", () => {
  it("caps ranked input of 12 farms at 5 rows and formats records", () => {
    const model = buildBoardImageModel({
      name: "Creators Digging Tournament",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "30",
      entries: rankedFarms(12),
      total_count: 12,
    });
    expect(BOARD_IMAGE_LIMIT).toBe(5);
    expect(model.rows).toHaveLength(5);
    expect(model.rows.map((row) => row.rank)).toEqual(["1", "2", "3", "4", "5"]);
    expect(model.rows.map((row) => row.name)).not.toContain("Farm 6");
    expect(model.rows.map((row) => row.name)).not.toContain("Farm 12");
    expect(model.rows[0]).toMatchObject({
      rank: "1",
      name: "Farm 1",
      total: "20",
      avg: "10.00",
      today: "10",
      pebbles: 3,
      place: 1,
      status: "Completed",
    });
    expect(model.window).toMatch(/August 17/);
    expect(model.window).toMatch(/August 23, 2026/);
    expect(model.prize_pool).toMatch(/30 Flower/);
    expect(model.prizes[0]?.label).toMatch(/30 Flower/);
    expect(model.caption).toBe("Top 5 of 12 farms · fewest digs to 3 Otter Pebbles");
    expect(model.filename).toBe("creators-digging-tournament-board.png");
  });

  it("adds the connected farm as a 6th row when it ranks outside the top 5", () => {
    const model = buildBoardImageModel({
      name: "Private Digging Tournament",
      start_at: "2026-09-01T00:00:00.000Z",
      end_at: "2026-09-08T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "Sunflower Land NFTs",
      connected_farm_id: "12",
      entries: rankedFarms(12),
      total_count: 12,
    });
    expect(model.rows).toHaveLength(6);
    expect(model.rows[5]).toMatchObject({
      rank: "12",
      name: "Farm 12",
      farm_id: "12",
      you: true,
    });
    expect(model.rows.filter((row) => row.farm_id === "12")).toHaveLength(1);
    expect(model.caption).toMatch(/plus your place/);
  });

  it("keeps five rows when the connected farm is already rank 3", () => {
    const model = buildBoardImageModel({
      name: "Cup",
      start_at: "2026-09-01T00:00:00.000Z",
      end_at: "2026-09-07T00:00:00.000Z",
      connected_farm_id: "3",
      entries: rankedFarms(12),
    });
    expect(model.rows).toHaveLength(5);
    expect(model.rows.filter((row) => row.farm_id === "3")).toHaveLength(1);
    expect(model.rows[2]?.you).toBe(true);
  });

  it("keeps five rows when the connected id is missing or unknown", () => {
    const entries = rankedFarms(12);
    expect(
      buildBoardImageModel({ name: "Cup", start_at: null, end_at: null, entries }).rows,
    ).toHaveLength(5);
    expect(
      buildBoardImageModel({
        name: "Cup",
        start_at: null,
        end_at: null,
        connected_farm_id: "99",
        entries,
      }).rows,
    ).toHaveLength(5);
  });

  it("keeps a text prize pool without a Flower suffix on the board image", () => {
    const model = buildBoardImageModel({
      name: "NFT pack cup",
      start_at: "2026-08-17T00:00:00.000Z",
      end_at: "2026-08-24T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "3x Rare Key",
      prize_places: [
        { place: 1, amount: "0", nft_name: "Squid Chicken" },
        { place: 2, amount: "0", nft_name: "Spa Sheep" },
        { place: 3, amount: "0", nft_name: "Flamingo Chicken" },
      ],
      entries: [entry({ farm_id: "1", rank: 1, score: 10, name: "Ada" })],
      min_bumpkin_island: "desert",
      min_digging_streak: null,
      vip_required: true,
      max_players: 10,
      enrolled_count: 6,
      join_mode: "confirm",
    });
    expect(model.prize_pool).toBe("3x Rare Key");
    expect(model.prize_pool).not.toMatch(/Flower/);
    expect(model.prizes.map((row) => row.label)).toEqual([
      "Squid Chicken",
      "Spa Sheep",
      "Flamingo Chicken",
    ]);
    expect(model.gates).toMatchObject({
      participants: "6/10",
      island: "Desert",
      streak: "None",
      vip: "Yes",
      approval: "Yes",
    });
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
  it("draws the full event card: title, prizes, podium, headers, and connected 6th row", () => {
    const model = buildBoardImageModel({
      name: "Private Digging Tournament",
      start_at: "2026-09-01T00:00:00.000Z",
      end_at: "2026-09-08T00:00:00.000Z",
      duration_days: 7,
      prize_amount: "Sunflower Land NFTs",
      prize_places: [
        { place: 1, amount: "0", nft_name: "Squid Chicken" },
        { place: 2, amount: "0", nft_name: "Spa Sheep" },
        { place: 3, amount: "0", nft_name: "Flamingo Chicken" },
      ],
      min_bumpkin_island: "desert",
      vip_required: true,
      max_players: 10,
      enrolled_count: 6,
      join_mode: "confirm",
      connected_farm_id: "12",
      entries: rankedFarms(12),
      total_count: 12,
    });
    const { ctx, texts, textYs } = mockCtx();
    const size = boardImageSize(model);
    const layout = boardImageLayout(model);
    paintBoardImage(ctx, model, size.width, size.height);

    expect(texts).toContain("Private Digging Tournament");
    expect(texts).toContain("Sunflower Land NFTs");
    expect(texts).toContain("Squid Chicken");
    expect(texts).toContain("Farm 1");
    expect(texts).toContain("RANK");
    expect(texts).toContain("FARM");
    expect(texts).toContain("TOTAL");
    expect(texts).toContain("AVG SCORE");
    expect(texts).toContain("TODAY");
    expect(texts).toContain("PEBBLES");
    expect(texts).toContain("STATUS");
    expect(texts).toContain("Farm 12");
    expect(texts).toContain("12");
    expect(layout.captionY).toBeLessThan(size.height);
    expect(Math.max(0, ...textYs)).toBeLessThanOrEqual(size.height);
    expect(size.height).toBe(layout.height);
  });
});
