import "../auth/amplify";
import { FormEvent, useEffect, useState } from "react";
import { confirmSignIn, signIn, signOut } from "aws-amplify/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFarm,
  addTournamentFarms,
  adminSession,
  approveSubmission,
  createTournament,
  deleteTournament,
  fetchAdminFarm,
  fetchSnapshot,
  fetchTournamentRoster,
  listAdminTournaments,
  listFarms,
  listSubmissions,
  refreshFarm,
  rejectSubmission,
  removeFarm,
  removeTournamentFarm,
  triggerSync,
  updateFarm,
  updateTournament,
} from "../api/admin";
import { getAuthToken } from "../auth/session";
import { AdminPlayers } from "./AdminPlayers";
import { AdminTournaments } from "./AdminTournaments";

export function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [needNewPassword, setNeedNewPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAuthToken()
      .then((token) => {
        if (!cancelled) setAuthed(Boolean(token));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const session = useQuery({
    queryKey: ["admin-session"],
    queryFn: adminSession,
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (authed && session.data === false) {
      void signOut().finally(() => setAuthed(false));
    }
  }, [authed, session.data]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoginError(null);
    setBusy(true);
    try {
      if (needNewPassword) {
        await confirmSignIn({ challengeResponse: newPassword });
        setAuthed(true);
        setNeedNewPassword(false);
        setPassword("");
        setNewPassword("");
        return;
      }
      try {
        await signOut();
      } catch {
        /* no existing session */
      }
      const result = await signIn({ username: username.trim(), password });
      if (result.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setNeedNewPassword(true);
        setPassword("");
        return;
      }
      setAuthed(true);
      setPassword("");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return <p className="muted">Checking session…</p>;
  }

  if (!authed) {
    return (
      <form className="card login" onSubmit={(event) => void onSubmit(event)}>
        <div className="kicker">Master admin</div>
        <p className="meta">
          Sign in with the Cognito user created in this app’s user pool. Public visitors cannot
          register.
        </p>
        {loginError && <div className="flash err">{loginError}</div>}
        <div className="form-grid">
          {!needNewPassword && (
            <>
              <label>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
            </>
          )}
          {needNewPassword && (
            <label>
              Choose a new password
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
          )}
          <button className="btn primary" type="submit" disabled={busy}>
            {needNewPassword ? "Save password" : "Sign in"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <AdminDashboard
      onLogout={() => {
        void signOut().finally(() => setAuthed(false));
      }}
    />
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const farms = useQuery({ queryKey: ["admin-farms"], queryFn: listFarms });
  const submissions = useQuery({ queryKey: ["admin-submissions"], queryFn: listSubmissions });
  const tournaments = useQuery({ queryKey: ["admin-tournaments"], queryFn: listAdminTournaments });
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const detail = useQuery({
    queryKey: ["admin-farm", selectedFarmId],
    queryFn: () => fetchAdminFarm(selectedFarmId as string),
    enabled: Boolean(selectedFarmId),
  });
  const roster = useQuery({
    queryKey: ["admin-roster", selectedTournamentId],
    queryFn: () => fetchTournamentRoster(selectedTournamentId as string),
    enabled: Boolean(selectedTournamentId),
  });

  function note(text: string, kind: "ok" | "err" = "ok") {
    setFlash({ kind, text });
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-farms"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-farm"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-tournaments"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-roster"] });
    void queryClient.invalidateQueries({ queryKey: ["config"] });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    void queryClient.invalidateQueries({ queryKey: ["tournaments"] });
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn ghost" onClick={onLogout} type="button">
          Sign out
        </button>
        <button
          className="btn"
          type="button"
          onClick={() =>
            triggerSync()
              .then(() => note("Full sync started. Scores refresh in the background."))
              .catch((error: Error) => note(error.message, "err"))
          }
        >
          Force full sync
        </button>
      </div>
      {flash && <div className={`flash ${flash.kind}`}>{flash.text}</div>}

      <AdminTournaments
        items={tournaments.data ?? []}
        players={farms.data ?? []}
        loading={tournaments.isLoading}
        selectedId={selectedTournamentId}
        roster={roster.data ?? []}
        onSelect={(id) => setSelectedTournamentId(id)}
        onCreate={async (draft) => {
          const created = await createTournament(draft);
          note(`Created ${created.name} (${created.status}).`);
          invalidate();
        }}
        onUpdate={async (id, draft) => {
          await updateTournament(id, draft);
          note("Tournament updated.");
          invalidate();
        }}
        onDelete={async (row) => {
          await deleteTournament(row.tournament_id);
          if (selectedTournamentId === row.tournament_id) setSelectedTournamentId(null);
          note(row.status === "active" ? "Live tournament deleted." : "Scheduled tournament cancelled.");
          invalidate();
        }}
        onAddFarms={async (id, farmIds) => {
          await addTournamentFarms(id, farmIds);
          note(`Added ${farmIds.length} player${farmIds.length === 1 ? "" : "s"} to the tournament.`);
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["admin-roster", id] });
        }}
        onRemoveFarm={async (id, farmId) => {
          await removeTournamentFarm(id, farmId);
          note("Removed from this tournament.");
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["admin-roster", id] });
        }}
        onApprove={async (farmId, tournamentId) => {
          await approveSubmission(farmId, tournamentId);
          note("Join approved.");
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["admin-roster", tournamentId] });
        }}
        onReject={async (farmId, tournamentId) => {
          await rejectSubmission(farmId, tournamentId);
          note("Join rejected.");
          invalidate();
          void queryClient.invalidateQueries({ queryKey: ["admin-roster", tournamentId] });
        }}
      />

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="kicker">Pending joins</div>
        {(submissions.data ?? []).length === 0 && <p className="muted">None waiting.</p>}
        {(submissions.data ?? []).map((item) => (
          <div key={`${item.farm_id}-${item.tournament_id}`} className="toolbar">
            <span>
              {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
              <div className="meta">wants {item.tournament_id}</div>
            </span>
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                approveSubmission(item.farm_id, item.tournament_id)
                  .then(() => {
                    note("Approved.");
                    invalidate();
                  })
                  .catch((error: Error) => note(error.message, "err"))
              }
            >
              Approve
            </button>
            <button
              className="btn"
              type="button"
              onClick={() =>
                rejectSubmission(item.farm_id, item.tournament_id)
                  .then(() => {
                    note("Rejected.");
                    invalidate();
                  })
                  .catch((error: Error) => note(error.message, "err"))
              }
            >
              Reject
            </button>
          </div>
        ))}
      </section>

      <AdminPlayers
        farms={farms.data ?? []}
        selectedId={selectedFarmId}
        detail={detail.data ?? null}
        snapshot={snapshot}
        onSelect={(id) => {
          setSelectedFarmId(id);
          setSnapshot("");
        }}
        onAdd={async (id, name) => {
          try {
            await addFarm(id, name);
            note("Farm added to S3 registry.");
            invalidate();
          } catch (error) {
            note(error instanceof Error ? error.message : "failed to add farm", "err");
            throw error;
          }
        }}
        onToggleActive={async (farm) => {
          try {
            await updateFarm(farm.farm_id, { active: !farm.active });
            invalidate();
          } catch (error) {
            note(error instanceof Error ? error.message : "failed to update farm", "err");
          }
        }}
        onRefresh={async (farm) => {
          try {
            await refreshFarm(farm.farm_id);
            note(`Refresh started for ${farm.farm_id}. Score updates in the background.`);
          } catch (error) {
            note(error instanceof Error ? error.message : "failed to refresh", "err");
          }
        }}
        onSnapshot={async (farm) => {
          try {
            const payload = await fetchSnapshot(farm.farm_id);
            setSnapshot(JSON.stringify(payload, null, 2));
          } catch (error) {
            note(error instanceof Error ? error.message : "snapshot not found", "err");
          }
        }}
        onRemove={async (farm) => {
          try {
            await removeFarm(farm.farm_id);
            if (selectedFarmId === farm.farm_id) setSelectedFarmId(null);
            note("Removed from S3 registry.");
            invalidate();
          } catch (error) {
            note(error instanceof Error ? error.message : "failed to remove farm", "err");
          }
        }}
      />
    </>
  );
}
