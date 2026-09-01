import { errorMessage, requestJson } from "./client";
import type {
  HeroLayer,
  LeaderboardEntry,
  Slogan,
  SloganList,
  Submission,
  TournamentConfig,
  TournamentList,
} from "./public";

export type TrackedFarm = {
  farm_id: string;
  name: string;
  active: boolean;
  digging_streak?: number;
  average_per_day?: number | null;
};

export type FarmHistoryRow = {
  tournament_id: string;
  name: string;
  start_at: string | null;
  end_at: string | null;
  duration_days?: number | null;
  score: number | null;
  digs_to_third_op: number | null;
  rank: number | null;
  status: string;
  otter_count?: number;
};

export type RosterMember = {
  farm_id: string;
  name: string;
  tournament_id: string;
  status: "pending" | "enrolled" | string;
  submitted_at: string | null;
  approved_at?: string | null;
  active?: boolean;
  tracked?: boolean;
  tournament_name?: string;
  tournament_status?: string;
};

export type PlayerDetail = TrackedFarm & {
  score?: Record<string, unknown> | null;
  history: FarmHistoryRow[];
  enrollments: RosterMember[];
  pending_joins: RosterMember[];
};

export async function adminSession(): Promise<boolean> {
  const { response } = await requestJson<{ ok: boolean }>("admin/session");
  return response.ok;
}

export type IdentifiedFarm = {
  farm_id: string;
  name: string;
  nft_id?: number | null;
  identified_at?: string | null;
};

export async function listIdentities(): Promise<IdentifiedFarm[]> {
  const { response, data } = await requestJson<{ identities: IdentifiedFarm[]; count: number }>(
    "admin/identities",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load identities"));
  return data.identities;
}

export async function listFarms(): Promise<TrackedFarm[]> {
  const { response, data } = await requestJson<{ farms: TrackedFarm[]; count: number }>(
    "admin/farms",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load farms"));
  return data.farms;
}

export async function fetchAdminFarm(farmId: string): Promise<PlayerDetail> {
  const { response, data } = await requestJson<{ farm: PlayerDetail }>(
    `admin/farms/${encodeURIComponent(farmId)}`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load farm"));
  return data.farm;
}

export async function addFarm(farmId: string, name: string): Promise<TrackedFarm> {
  const { response, data } = await requestJson<{ farm: TrackedFarm }>("admin/farms", {
    method: "POST",
    body: JSON.stringify({ farm_id: farmId, name, active: true }),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to add farm"));
  return data.farm;
}

export async function updateFarm(
  farmId: string,
  patch: { name?: string; active?: boolean },
): Promise<TrackedFarm> {
  const { response, data } = await requestJson<{ farm: TrackedFarm }>(
    `admin/farms/${encodeURIComponent(farmId)}`,
    { method: "PUT", body: JSON.stringify(patch) },
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to update farm"));
  return data.farm;
}

export async function removeFarm(farmId: string): Promise<void> {
  const { response, data } = await requestJson<{ farms: TrackedFarm[] }>(
    `admin/farms/${encodeURIComponent(farmId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to remove farm"));
}

export async function listSubmissions(): Promise<Submission[]> {
  const { response, data } = await requestJson<{ submissions: Submission[]; count: number }>(
    "admin/submissions",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load submissions"));
  return data.submissions;
}

export async function approveSubmission(farmId: string, tournamentId: string): Promise<void> {
  const { response, data } = await requestJson<{ farm: TrackedFarm }>(
    `admin/submissions/${encodeURIComponent(farmId)}/${encodeURIComponent(tournamentId)}/approve`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to approve"));
}

export async function rejectSubmission(farmId: string, tournamentId: string): Promise<void> {
  const { response, data } = await requestJson<{ ok: boolean }>(
    `admin/submissions/${encodeURIComponent(farmId)}/${encodeURIComponent(tournamentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to reject"));
}

export async function fetchTournamentRoster(tournamentId: string): Promise<RosterMember[]> {
  const { response, data } = await requestJson<{ members: RosterMember[]; count: number }>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}/roster`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load roster"));
  return data.members;
}

export async function addTournamentFarms(
  tournamentId: string,
  farmIds: string[],
): Promise<TrackedFarm[]> {
  const { response, data } = await requestJson<{ farms: TrackedFarm[]; count: number }>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}/farms`,
    { method: "POST", body: JSON.stringify({ farm_ids: farmIds }) },
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to add farms"));
  return data.farms;
}

export async function removeTournamentFarm(tournamentId: string, farmId: string): Promise<void> {
  const { response, data } = await requestJson<{ ok: boolean }>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}/farms/${encodeURIComponent(farmId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to remove farm from tournament"));
}

export async function fetchAdminSlogans(): Promise<SloganList> {
  const { response, data } = await requestJson<SloganList>("admin/slogans");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load slogans"));
  return data;
}

export async function addSlogan(input: { text: string }): Promise<SloganList> {
  const { response, data } = await requestJson<SloganList & { slogan: Slogan }>("admin/slogans", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to add slogan"));
  return data;
}

export async function saveSlogans(
  slogans: Slogan[],
  extra: { today_text?: string | null } = {},
): Promise<SloganList> {
  const body: { slogans: Slogan[]; today_text?: string | null } = { slogans };
  if ("today_text" in extra) body.today_text = extra.today_text ?? null;
  const { response, data } = await requestJson<SloganList>("admin/slogans", {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to save slogans"));
  return data;
}

export async function fetchAdminConfig(): Promise<TournamentConfig> {
  const { response, data } = await requestJson<{ config: TournamentConfig }>("admin/config");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load config"));
  return data.config;
}

export type ConfigRescore = {
  rescored: number;
  missing_snapshots: number;
  sync_accepted: boolean;
};

export type ConfigSaveResult = {
  config: TournamentConfig;
  rescore?: ConfigRescore;
};

export type TournamentWrite = {
  tournament_id: string;
  name: string;
  start_at: string;
  end_at: string;
  duration_days: number;
  prize_amount: string;
  status: string;
  min_bumpkin_island?: string | null;
  min_digging_streak?: number | null;
  vip_required?: boolean;
  max_players?: number | null;
  join_mode?: string;
  description?: string;
  prize_places?: { place: number; amount: string; nft_name?: string }[];
  nft_giveaway?: boolean;
  image_1_url?: string | null;
  image_2_url?: string | null;
  hero_layers?: HeroLayer[];
};

export async function listAdminTournaments(): Promise<TournamentList> {
  const { response, data } = await requestJson<TournamentList>("admin/tournaments");
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load tournaments"));
  return data;
}

export async function setFeaturedTournament(
  tournamentId: string | null,
): Promise<string | null> {
  const { response, data } = await requestJson<{ featured_tournament_id: string | null }>(
    "admin/featured",
    { method: "PUT", body: JSON.stringify({ tournament_id: tournamentId }) },
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to set featured tournament"));
  return data.featured_tournament_id ?? null;
}

export async function createTournament(input: {
  name: string;
  start_at: string;
  end_at?: string;
  duration_days?: number;
  prize_amount: string;
  min_bumpkin_island?: string | null;
  min_digging_streak?: number | null;
  vip_required?: boolean;
  max_players?: number | null;
  join_mode?: string;
  description?: string;
  prize_places?: { place: number; amount: string; nft_name?: string }[];
  nft_giveaway?: boolean;
  image_1_url?: string | null;
  image_2_url?: string | null;
  hero_layers?: HeroLayer[];
}): Promise<TournamentWrite> {
  const { response, data } = await requestJson<{ tournament: TournamentWrite }>("admin/tournaments", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok || !data?.tournament) {
    throw new Error(errorMessage(data, "failed to create tournament"));
  }
  return data.tournament;
}

export async function updateTournament(
  tournamentId: string,
  input: {
    name?: string;
    start_at?: string;
    end_at?: string;
    duration_days?: number;
    prize_amount?: string;
    min_bumpkin_island?: string | null;
    min_digging_streak?: number | null;
    vip_required?: boolean;
    max_players?: number | null;
    join_mode?: string;
    description?: string;
    prize_places?: { place: number; amount: string; nft_name?: string }[];
    nft_giveaway?: boolean;
    image_1_url?: string | null;
    image_2_url?: string | null;
    hero_layers?: HeroLayer[];
  },
): Promise<TournamentWrite> {
  const { response, data } = await requestJson<{ tournament: TournamentWrite }>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  if (!response.ok || !data?.tournament) {
    throw new Error(errorMessage(data, "failed to update tournament"));
  }
  return data.tournament;
}

export async function deleteTournament(tournamentId: string): Promise<void> {
  const { response, data } = await requestJson<{ ok: boolean }>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to cancel tournament"));
}

export type TournamentImageUpload = {
  slot: "image_1" | "image_2";
  key: string;
  public_url: string;
};

export async function uploadAdminTournamentImage(
  tournamentId: string,
  slot: "image_1" | "image_2",
  contentType: string,
  data: string,
): Promise<TournamentImageUpload> {
  const { response, data: payload } = await requestJson<TournamentImageUpload>(
    `admin/tournaments/${encodeURIComponent(tournamentId)}/images`,
    {
      method: "POST",
      body: JSON.stringify({ slot, content_type: contentType, data }),
    },
  );
  if (!response.ok || !payload) {
    throw new Error(errorMessage(payload, "failed to upload tournament image"));
  }
  return payload;
}

export async function saveConfig(input: {
  start_at: string;
  end_at?: string;
  duration_days?: number;
  prize_amount: string;
}): Promise<ConfigSaveResult> {
  const { response, data } = await requestJson<ConfigSaveResult>("admin/config", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!response.ok || !data?.config) {
    throw new Error(errorMessage(data, "failed to save config"));
  }
  return {
    config: data.config,
    rescore: data.rescore ?? {
      rescored: 0,
      missing_snapshots: 0,
      sync_accepted: false,
    },
  };
}

export async function refreshFarm(farmId: string): Promise<void> {
  const { response, data } = await requestJson<{ accepted: boolean; farm_id: string }>(
    `admin/farms/${encodeURIComponent(farmId)}/refresh`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to start farm refresh"));
}

export async function triggerSync(): Promise<void> {
  const { response, data } = await requestJson<{ accepted: boolean }>("admin/sync", {
    method: "POST",
  });
  if (!response.ok) throw new Error(errorMessage(data, "failed to start sync"));
}

export async function overrideScore(
  farmId: string,
  patch: {
    override_digs_to_third_op?: number | null;
    invalidated?: boolean;
    override_reason?: string;
  },
): Promise<void> {
  const { response, data } = await requestJson<{ score: LeaderboardEntry }>(
    `admin/scores/${encodeURIComponent(farmId)}`,
    { method: "PUT", body: JSON.stringify(patch) },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to override score"));
}

export async function fetchSnapshot(farmId: string): Promise<unknown> {
  const { response, data } = await requestJson<{ snapshot: unknown }>(
    `admin/scores/${encodeURIComponent(farmId)}/snapshot`,
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "snapshot not found"));
  return data.snapshot;
}
