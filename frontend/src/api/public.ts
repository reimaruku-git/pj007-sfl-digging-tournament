import { errorMessage, requestJson } from "./client";

export type TournamentStatus = "scheduled" | "active" | "ended";
export type FarmStatus = "not_started" | "in_progress" | "completed" | "invalidated";

export type TournamentConfig = {
  tournament_id?: string;
  name?: string;
  start_at: string;
  end_at: string;
  duration_days?: number;
  prize_amount: string;
  status: TournamentStatus;
  last_full_sync_at: string | null;
  updated_at?: string;
};

export type LeaderboardEntry = {
  rank: number | null;
  farm_id: string;
  name: string;
  score?: number | null;
  digs_to_third_op: number | null;
  digs_to_first_op?: number | null;
  digs_to_second_op?: number | null;
  otter_count: number;
  digs_today: number;
  total_digs: number;
  tournament_days?: number;
  first_op_at?: string | null;
  second_op_at?: string | null;
  third_op_at?: string | null;
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

export async function fetchTournamentFarm(
  tournamentId: string,
  farmId: string,
): Promise<LeaderboardEntry> {
  const { response, data } = await requestJson<FarmResponse>(
    `tournaments/${encodeURIComponent(tournamentId)}/farms/${encodeURIComponent(farmId)}`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "farm not found"));
  return data.farm;
}

export type TournamentSummary = {
  tournament_id: string;
  name: string;
  start_at: string;
  end_at: string;
  duration_days: number;
  prize_amount: string;
  status: TournamentStatus;
  archived_at: string | null;
  count: number;
  leader_farm_id: string | null;
};

export type TournamentArchive = {
  tournament_id: string;
  archived_at: string;
  config: TournamentConfig;
  entries: LeaderboardEntry[];
  count: number;
  leader_farm_id: string | null;
};

export async function listTournaments(): Promise<{ tournaments: TournamentSummary[]; count: number }> {
  const { response, data } = await requestJson<{ tournaments: TournamentSummary[]; count: number }>(
    "tournaments",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load tournaments"));
  return data;
}

export async function fetchTournament(tournamentId: string): Promise<TournamentArchive> {
  const { response, data } = await requestJson<{ tournament: TournamentArchive }>(
    `tournaments/${encodeURIComponent(tournamentId)}`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "tournament not found"));
  return data.tournament;
}

export async function submitFarm(farmId: string, name: string): Promise<Submission> {
  const { response, data } = await requestJson<{ submission: Submission }>("submissions", {
    method: "POST",
    body: JSON.stringify({ farm_id: farmId, name }),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to submit farm"));
  return data.submission;
}
