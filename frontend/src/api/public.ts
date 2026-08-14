import { errorMessage, requestJson } from "./client";

export type TournamentStatus = "scheduled" | "active" | "ended";
export type FarmStatus = "not_started" | "in_progress" | "completed" | "invalidated";

export type TournamentConfig = {
  start_at: string;
  end_at: string;
  prize_amount: string;
  status: TournamentStatus;
  last_full_sync_at: string | null;
  updated_at?: string;
};

export type LeaderboardEntry = {
  rank: number | null;
  farm_id: string;
  name: string;
  digs_to_third_op: number | null;
  otter_count: number;
  digs_today: number;
  total_digs: number;
  last_updated_at: string | null;
  status: FarmStatus;
  invalidated: boolean;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  count: number;
  generated_at: string | null;
  config: TournamentConfig;
};

export type FarmResponse = {
  farm: LeaderboardEntry;
};

export type Submission = {
  farm_id: string;
  name: string;
  submitted_at: string;
  status: string;
};

export async function fetchHealth(): Promise<{ status: string }> {
  const { response, data } = await requestJson<{ status: string }>("health");
  if (!response.ok || !data) throw new Error("API is unreachable");
  return data;
}

export async function fetchConfig(): Promise<TournamentConfig> {
  const { response, data } = await requestJson<TournamentConfig>("config");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load config"));
  return data;
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  const { response, data } = await requestJson<LeaderboardResponse>("leaderboard");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load leaderboard"));
  return data;
}

export async function fetchFarm(farmId: string): Promise<LeaderboardEntry> {
  const { response, data } = await requestJson<FarmResponse>(`farms/${encodeURIComponent(farmId)}`);
  if (!response.ok || !data) throw new Error(errorMessage(data, "farm not found"));
  return data.farm;
}

export async function submitFarm(farmId: string, name: string): Promise<Submission> {
  const { response, data } = await requestJson<{ submission: Submission }>("submissions", {
    method: "POST",
    body: JSON.stringify({ farm_id: farmId, name }),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to submit farm"));
  return data.submission;
}
