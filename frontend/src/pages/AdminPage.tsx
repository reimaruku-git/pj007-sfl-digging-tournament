import "../auth/amplify";
import { FormEvent, useEffect, useState } from "react";
import { confirmSignIn, signIn, signOut } from "aws-amplify/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFarm,
  adminSession,
  approveSubmission,
  createTournament,
  deleteTournament,
  fetchSnapshot,
  listAdminTournaments,
  listFarms,
  listSubmissions,
  overrideScore,
  refreshFarm,
  rejectSubmission,
  removeFarm,
  triggerSync,
  updateFarm,
  updateTournament,
} from "../api/admin";
import { getAuthToken } from "../auth/session";
import { formatDateRangeUtc, statusLabel } from "../lib/format";

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
  const [farmId, setFarmId] = useState("");
  const [farmName, setFarmName] = useState("");
  const [eventName, setEventName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [durationDays, setDurationDays] = useState(7);
  const [prize, setPrize] = useState("30");
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");

  function note(text: string, kind: "ok" | "err" = "ok") {
    setFlash({ kind, text });
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-farms"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-config"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-tournaments"] });
    void queryClient.invalidateQueries({ queryKey: ["config"] });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    void queryClient.invalidateQueries({ queryKey: ["tournaments"] });
  };

  const add = useMutation({
    mutationFn: () => addFarm(farmId.trim(), farmName.trim()),
    onSuccess: () => {
      setFarmId("");
      setFarmName("");
      note("Farm added to S3 registry.");
      invalidate();
    },
    onError: (error: Error) => note(error.message, "err"),
  });

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

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="kicker">Tournaments</div>
        {(tournaments.data ?? []).length === 0 && !tournaments.isLoading && (
          <p className="muted">No tournaments yet. Create one below.</p>
        )}
        {(tournaments.data ?? []).map((row) => (
          <div key={row.tournament_id} className="toolbar" style={{ alignItems: "center" }}>
            <span>
              <span className={`badge ${row.status}`}>{statusLabel(row.status)}</span>{" "}
              <b>{row.name || row.tournament_id}</b>
              <div className="meta">
                {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} · {row.prize_amount}{" "}
                Flower
              </div>
            </span>
            {(row.status === "scheduled" || row.status === "active") && (
              <button
                className="btn"
                type="button"
                onClick={() =>
                  deleteTournament(row.tournament_id)
                    .then(() => {
                      note(
                        row.status === "active"
                          ? "Live tournament deleted."
                          : "Scheduled tournament cancelled.",
                      );
                      invalidate();
                    })
                    .catch((error: Error) => note(error.message, "err"))
                }
              >
                Delete
              </button>
            )}
            {row.status === "active" && (
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const nextName = window.prompt("Tournament name", row.name || "");
                  if (nextName === null) return;
                  const nextPrize = window.prompt("Prize (Flower)", row.prize_amount);
                  if (nextPrize === null) return;
                  updateTournament(row.tournament_id, {
                    name: nextName.trim(),
                    prize_amount: nextPrize.trim() || "30",
                  })
                    .then(() => {
                      note("Live tournament updated.");
                      invalidate();
                    })
                    .catch((error: Error) => note(error.message, "err"));
                }}
              >
                Edit name / prize
              </button>
            )}
          </div>
        ))}
        <form
          className="form-grid"
          style={{ marginTop: 16 }}
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            if (!startAt) {
              note("Start must be a valid date.", "err");
              return;
            }
            const payload: {
              name: string;
              start_at: string;
              end_at?: string;
              duration_days?: number;
              prize_amount: string;
            } = {
              name: eventName.trim(),
              start_at: `${startAt}T00:00:00.000Z`,
              prize_amount: prize.trim() || "30",
            };
            if (endAt) {
              payload.end_at = `${endAt}T00:00:00.000Z`;
            } else {
              if (durationDays < 7) {
                note("Tournament must run at least 7 days.", "err");
                return;
              }
              payload.duration_days = durationDays;
            }
            createTournament(payload)
              .then((created) => {
                note(`Created ${created.name} (${created.status}).`);
                setEventName("");
                invalidate();
              })
              .catch((error: Error) => note(error.message, "err"));
          }}
        >
          <label>
            Name
            <input
              value={eventName}
              onChange={(event) => setEventName(event.target.value)}
              placeholder="Late August Otter Cup"
              required
            />
          </label>
          <label>
            From
            <input
              type="date"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              required
            />
          </label>
          <label>
            To (optional)
            <input type="date" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
          </label>
          <label>
            Length (days)
            <select
              value={[7, 14, 30].includes(durationDays) ? String(durationDays) : "custom"}
              onChange={(event) => {
                if (event.target.value === "custom") return;
                setDurationDays(Number(event.target.value));
              }}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            Custom days
            <input
              type="number"
              min={7}
              value={durationDays}
              onChange={(event) => setDurationDays(Number(event.target.value))}
            />
          </label>
          <label>
            Prize (Flower)
            <input value={prize} onChange={(event) => setPrize(event.target.value)} />
          </label>
          <button className="btn primary" type="submit" disabled={!startAt || !eventName.trim()}>
            Create tournament
          </button>
        </form>
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="kicker">Pending submissions</div>
        {(submissions.data ?? []).length === 0 && <p className="muted">None waiting.</p>}
        {(submissions.data ?? []).map((item) => (
          <div key={item.farm_id} className="toolbar">
            <span>
              {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
            </span>
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                approveSubmission(item.farm_id)
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
                rejectSubmission(item.farm_id)
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

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="kicker">Tracked farms (S3 JSON)</div>
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <input
            className="search"
            placeholder="Farm ID"
            value={farmId}
            onChange={(e) => setFarmId(e.target.value)}
            required
          />
          <input placeholder="Name" value={farmName} onChange={(e) => setFarmName(e.target.value)} />
          <button className="btn primary" type="submit">
            Add farm
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Farm</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(farms.data ?? []).map((farm) => (
                <tr key={farm.farm_id}>
                  <td>
                    {farm.name || "Unnamed"}
                    <div className="farm-id">{farm.farm_id}</div>
                  </td>
                  <td>{farm.active ? "yes" : "no"}</td>
                  <td className="row-actions">
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        updateFarm(farm.farm_id, { active: !farm.active })
                          .then(invalidate)
                          .catch((error: Error) => note(error.message, "err"))
                      }
                    >
                      {farm.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        refreshFarm(farm.farm_id)
                          .then(() =>
                            note(
                              `Refresh started for ${farm.farm_id}. Score updates in the background.`,
                            ),
                          )
                          .catch((error: Error) => note(error.message, "err"))
                      }
                    >
                      Refresh
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        fetchSnapshot(farm.farm_id)
                          .then((payload) => setSnapshot(JSON.stringify(payload, null, 2)))
                          .catch((error: Error) => note(error.message, "err"))
                      }
                    >
                      Snapshot
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const value = window.prompt("Override digs to 3rd OP (blank to clear)");
                        if (value === null) return;
                        const parsed = value.trim() === "" ? null : Number(value);
                        overrideScore(farm.farm_id, {
                          override_digs_to_third_op: parsed,
                          override_reason: "admin override",
                        })
                          .then(() => {
                            note("Score override saved.");
                            invalidate();
                          })
                          .catch((error: Error) => note(error.message, "err"));
                      }}
                    >
                      Override
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        overrideScore(farm.farm_id, { invalidated: true, override_reason: "invalidated" })
                          .then(() => {
                            note("Score invalidated.");
                            invalidate();
                          })
                          .catch((error: Error) => note(error.message, "err"))
                      }
                    >
                      Invalidate
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        removeFarm(farm.farm_id)
                          .then(() => {
                            note("Removed from S3 registry.");
                            invalidate();
                          })
                          .catch((error: Error) => note(error.message, "err"))
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {snapshot && <pre className="snapshot">{snapshot}</pre>}
      </section>


    </>
  );
}
