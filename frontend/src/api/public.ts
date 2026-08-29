import { errorMessage, requestJson } from "./client";

export type TournamentStatus = "scheduled" | "active" | "ended";
export type FarmStatus = "not_started" | "in_progress" | "completed" | "invalidated";
export type JoinMode = "auto" | "confirm";
export type BumpkinIsland = "basic" | "spring" | "desert" | "volcano+";

export const MIN_BUMPKIN_ISLANDS: BumpkinIsland[] = ["basic", "spring", "desert", "volcano+"];

export type PrizePlace = {
  place: number;
  amount: string;
  nft_name?: string;
};

export type TournamentConfig = {
  tournament_id?: string;
  name?: string;
  start_at: string | null;
  end_at: string | null;
  duration_days?: number;
  prize_amount: string;
  status: TournamentStatus;
  last_full_sync_at: string | null;
  updated_at?: string;
  featured_tournament_id?: string | null;
  min_bumpkin_island?: BumpkinIsland | null;
  min_digging_streak?: number | null;
  vip_required?: boolean;
  max_players?: number | null;
  join_mode?: JoinMode;
  description?: string;
  prize_places?: PrizePlace[];
  nft_giveaway?: boolean;
  enrolled_count?: number;
};

export type FarmDayRecord = {
  day: string;
  digs_to_third_op: number | null;
  digs_to_first_op?: number | null;
  digs_to_second_op?: number | null;
  otter_count: number;
  total_digs: number;
  digs_today?: number;
  status: FarmStatus;
  finalized: boolean;
  first_op_at?: string | null;
  second_op_at?: string | null;
  third_op_at?: string | null;
};

export type LeaderboardEntry = {
  rank: number | null;
  farm_id: string;
  name: string;
  score?: number | null;
  score_first_op?: number | null;
  score_second_op?: number | null;
  digs_to_third_op: number | null;
  digs_to_first_op?: number | null;
  digs_to_second_op?: number | null;
  otter_count: number;
  digs_today: number;
  score_today?: number | null;
  scored_days?: number;
  total_digs: number;
  tournament_days?: number;
  first_op_at?: string | null;
  second_op_at?: string | null;
  third_op_at?: string | null;
  last_updated_at: string | null;
  status: FarmStatus;
  invalidated: boolean;
  days?: FarmDayRecord[];
  recorded_average_per_day?: number | null;
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
  tournament_id: string;
  submitted_at: string | null;
  approved_at?: string | null;
  status: string;
};

export type SubmissionList = {
  submissions: Submission[];
  count: number;
};

export type Slogan = {
  text: string;
};

export type SloganList = {
  slogans: Slogan[];
  count: number;
  today_text?: string | null;
  today_day?: string | null;
};

export async function fetchSlogans(): Promise<SloganList> {
  const { response, data } = await requestJson<SloganList>("slogans");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load slogans"));
  return data;
}

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

export type FarmMembership = Submission;

export type FarmMembershipList = {
  memberships: FarmMembership[];
  count: number;
};

export async function fetchFarmMemberships(farmId: string): Promise<FarmMembershipList> {
  const { response, data } = await requestJson<FarmMembershipList>(
    `farms/${encodeURIComponent(farmId)}/memberships`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load memberships"));
  return data;
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
  min_bumpkin_island?: BumpkinIsland | null;
  min_digging_streak?: number | null;
  vip_required?: boolean;
  max_players?: number | null;
  join_mode?: JoinMode;
  description?: string;
  prize_places?: PrizePlace[];
  nft_giveaway?: boolean;
  enrolled_count?: number;
};

export type TournamentArchive = {
  tournament_id: string;
  archived_at: string;
  config: TournamentConfig;
  entries: LeaderboardEntry[];
  count: number;
  leader_farm_id: string | null;
  overall_average_per_day?: number | null;
  accepts_joins?: boolean;
};

export type TournamentList = {
  tournaments: TournamentSummary[];
  count: number;
  featured_tournament_id?: string | null;
};

export async function listTournaments(): Promise<TournamentList> {
  const { response, data } = await requestJson<TournamentList>("tournaments");
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

export type FarmIdentityResponse = {
  farm_id: string;
  name: string;
  nft_id?: number | null;
  identified_at?: string | null;
};

export async function identifyFarm(farmId: string): Promise<FarmIdentityResponse> {
  const { response, data } = await requestJson<FarmIdentityResponse>("identify", {
    method: "POST",
    body: JSON.stringify({ farm_id: farmId }),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to identify farm"));
  return data;
}

export async function submitFarm(
  farmId: string,
  name: string,
  tournamentIds: string[],
): Promise<SubmissionList> {
  const { response, data } = await requestJson<SubmissionList>("submissions", {
    method: "POST",
    body: JSON.stringify({ farm_id: farmId, name, tournament_ids: tournamentIds }),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to submit farm"));
  return data;
}
