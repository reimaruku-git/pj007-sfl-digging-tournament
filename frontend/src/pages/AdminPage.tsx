import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addFarm,
  adminLogin,
  adminSession,
  approveSubmission,
  fetchSnapshot,
  listFarms,
  listSubmissions,
  overrideScore,
  refreshFarm,
  rejectSubmission,
  removeFarm,
  saveConfig,
  triggerSync,
  updateFarm,
} from "../api/admin";
import { fetchConfig } from "../api/public";
import { getAdminToken, setAdminToken } from "../api/client";
import { formatWhen } from "../components/Layout";

export function AdminPage() {
  const [authed, setAuthed] = useState(Boolean(getAdminToken()));
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const session = useQuery({
    queryKey: ["admin-session"],
    queryFn: adminSession,
    enabled: authed,
    retry: false,
  });

  useEffect(() => {
    if (authed && session.data === false) {
      setAdminToken(null);
      setAuthed(false);
    }
  }, [authed, session.data]);

  if (!authed) {
    return (
      <form
        className="card login"
        onSubmit={async (event) => {
          event.preventDefault();
          setLoginError(null);
          try {
            await adminLogin(password);
            setAuthed(true);
          } catch (error) {
            setLoginError((error as Error).message);
          }
        }}
      >
        <div className="kicker">Master admin</div>
        <p className="meta">Only the tournament operator can change farms, dates, or scores.</p>
        {loginError && <div className="flash err">{loginError}</div>}
        <div className="form-grid">
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <button className="btn primary" type="submit">
            Sign in
          </button>
        </div>
      </form>
    );
  }

  return <AdminDashboard onLogout={() => { setAdminToken(null); setAuthed(false); }} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const queryClient = useQueryClient();
  const farms = useQuery({ queryKey: ["admin-farms"], queryFn: listFarms });
  const submissions = useQuery({ queryKey: ["admin-submissions"], queryFn: listSubmissions });
  const config = useQuery({ queryKey: ["config"], queryFn: fetchConfig });
  const [farmId, setFarmId] = useState("");
  const [farmName, setFarmName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [prize, setPrize] = useState("30");
  const [message, setMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");

  useEffect(() => {
    if (!config.data || startAt) return;
    setStartAt(toLocalInput(config.data.start_at));
    setEndAt(toLocalInput(config.data.end_at));
    setPrize(config.data.prize_amount);
  }, [config.data, startAt]);

  function note(text: string) {
    setMessage(text);
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-farms"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-submissions"] });
    void queryClient.invalidateQueries({ queryKey: ["config"] });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
  };

  const add = useMutation({
    mutationFn: () => addFarm(farmId.trim(), farmName.trim()),
    onSuccess: () => {
      setFarmId("");
      setFarmName("");
      note("Farm added to S3 registry.");
      invalidate();
    },
    onError: (error: Error) => note(error.message),
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
              .catch((error: Error) => note(error.message))
          }
        >
          Force full sync
        </button>
      </div>
      {message && <div className="flash ok">{message}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div className="kicker">Tournament window</div>
        <form
          className="form-grid"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            saveConfig({
              start_at: new Date(startAt).toISOString(),
              end_at: new Date(endAt).toISOString(),
              prize_amount: prize,
            })
              .then(() => {
                note("Config saved.");
                invalidate();
              })
              .catch((error: Error) => note(error.message));
          }}
        >
          <label>
            Start
            <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
          <label>
            End
            <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
          </label>
          <label>
            Prize (Flower)
            <input value={prize} onChange={(e) => setPrize(e.target.value)} />
          </label>
          <button className="btn primary" type="submit">
            Save dates & prize
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
                  .catch((error: Error) => note(error.message))
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
                  .catch((error: Error) => note(error.message))
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
                          .catch((error: Error) => note(error.message))
                      }
                    >
                      {farm.active ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        refreshFarm(farm.farm_id)
                          .then(() => note(`Refreshed ${farm.farm_id}`))
                          .catch((error: Error) => note(error.message))
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
                          .catch((error: Error) => note(error.message))
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
                          .catch((error: Error) => note(error.message));
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
                          .catch((error: Error) => note(error.message))
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
                          .catch((error: Error) => note(error.message))
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

      <p className="muted">Last public sync: {formatWhen(config.data?.last_full_sync_at)}</p>
    </>
  );
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
