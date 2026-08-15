import { errorMessage, requestJson } from "./client";
import type { LeaderboardEntry, Submission, TournamentConfig, TournamentSummary } from "./public";

export type TrackedFarm = {
  farm_id: string;
  name: string;
  active: boolean;
};

export async function adminSession(): Promise<boolean> {
  const { response } = await requestJson<{ ok: boolean }>("admin/session");
  return response.ok;
}

export async function listFarms(): Promise<TrackedFarm[]> {
  const { response, data } = await requestJson<{ farms: TrackedFarm[]; count: number }>(
    "admin/farms",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load farms"));
  return data.farms;
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

export async function approveSubmission(farmId: string): Promise<void> {
  const { response, data } = await requestJson<{ farm: TrackedFarm }>(
    `admin/submissions/${encodeURIComponent(farmId)}/approve`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to approve"));
}

export async function rejectSubmission(farmId: string): Promise<void> {
  const { response, data } = await requestJson<{ ok: boolean }>(
    `admin/submissions/${encodeURIComponent(farmId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(errorMessage(data, "failed to reject"));
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
};

export async function listAdminTournaments(): Promise<TournamentSummary[]> {
  const { response, data } = await requestJson<{ tournaments: TournamentSummary[]; count: number }>(
    "admin/tournaments",
  );
  if (!response.ok || !data) throw new Error(errorMessage(data, "failed to load tournaments"));
  return data.tournaments;
}

export async function createTournament(input: {
  name: string;
  start_at: string;
  end_at?: string;
  duration_days?: number;
  prize_amount: string;
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
