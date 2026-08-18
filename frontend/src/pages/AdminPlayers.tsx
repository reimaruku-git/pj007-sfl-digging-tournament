import { FormEvent, useState } from "react";
import type { PlayerDetail, TrackedFarm } from "../api/admin";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";
import { formatScore } from "../lib/format";

export function AdminPlayers({
  farms,
  selectedId,
  detail,
  snapshot,
  onSelect,
  onAdd,
  onToggleActive,
  onRefresh,
  onSnapshot,
  onRemove,
}: {
  farms: TrackedFarm[];
  selectedId: string | null;
  detail: PlayerDetail | null;
  snapshot: string;
  onSelect: (farmId: string | null) => void;
  onAdd: (farmId: string, name: string) => Promise<void>;
  onToggleActive: (farm: TrackedFarm) => Promise<void>;
  onRefresh: (farm: TrackedFarm) => Promise<void>;
  onSnapshot: (farm: TrackedFarm) => Promise<void>;
  onRemove: (farm: TrackedFarm) => Promise<void>;
}) {
  const [farmId, setFarmId] = useState("");
  const [farmName, setFarmName] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  function requestRemove(farm: TrackedFarm) {
    confirm.ask(
      "Are you sure to do this?",
      `Remove ${farm.name || farm.farm_id} from tracked farms? Scores and enrollments go with it.`,
      () => onRemove(farm),
    );
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await onAdd(farmId.trim(), farmName.trim());
      setFarmId("");
      setFarmName("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="admin-players">
      <div className="kicker">Players</div>
      <form className="toolbar" onSubmit={(event) => void add(event)}>
        <input
          className="search"
          placeholder="Farm ID"
          value={farmId}
          onChange={(event) => setFarmId(event.target.value)}
          required
        />
        <input
          placeholder="Name"
          value={farmName}
          onChange={(event) => setFarmName(event.target.value)}
        />
        <button className="btn primary" type="submit" disabled={busy}>
          Add farm
        </button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Farm</th>
              <th>Active</th>
              <th>Digging streak</th>
              <th>Average per day</th>
            </tr>
          </thead>
          <tbody>
            {farms.map((farm) => {
              const open = selectedId === farm.farm_id;
              return (
                <tr
                  key={farm.farm_id}
                  className={open ? "player-row is-open" : "player-row"}
                  data-testid={`player-row-${farm.farm_id}`}
                  onClick={() => onSelect(open ? null : farm.farm_id)}
                >
                  <td>
                    {farm.name || "Unnamed"}
                    <div className="farm-id">{farm.farm_id}</div>
                  </td>
                  <td>{farm.active ? "yes" : "no"}</td>
                  <td data-testid={`player-streak-${farm.farm_id}`}>{farm.digging_streak ?? 0}</td>
                  <td data-testid={`player-avg-${farm.farm_id}`}>
                    {formatScore(farm.average_per_day)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedId && (
        <PlayerDetailPanel
          farm={farms.find((item) => item.farm_id === selectedId) ?? null}
          detail={detail?.farm_id === selectedId ? detail : null}
          snapshot={snapshot}
          onToggleActive={onToggleActive}
          onRefresh={onRefresh}
          onSnapshot={onSnapshot}
          onRemove={requestRemove}
        />
      )}
      <ConfirmDialog
        pending={confirm.pending}
        onYes={() => void confirm.accept()}
        onNo={confirm.cancel}
      />
    </section>
  );
}

function PlayerDetailPanel({
  farm,
  detail,
  snapshot,
  onToggleActive,
  onRefresh,
  onSnapshot,
  onRemove,
}: {
  farm: TrackedFarm | null;
  detail: PlayerDetail | null;
  snapshot: string;
  onToggleActive: (farm: TrackedFarm) => Promise<void>;
  onRefresh: (farm: TrackedFarm) => Promise<void>;
  onSnapshot: (farm: TrackedFarm) => Promise<void>;
  onRemove: (farm: TrackedFarm) => void | Promise<void>;
}) {
  if (!farm) return null;
  const score = detail?.score ?? null;
  return (
    <div className="player-detail" data-testid={`player-detail-${farm.farm_id}`}>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="kicker" style={{ marginBottom: 0 }}>
            {farm.name || "Unnamed"} · {farm.farm_id}
          </div>
          <p className="meta">
            Streak {detail?.digging_streak ?? farm.digging_streak ?? 0} · avg/day{" "}
            {formatScore(detail?.average_per_day ?? farm.average_per_day)}
          </p>
        </div>
        <div className="row-actions" data-testid="player-detail-actions">
          <button className="btn" type="button" onClick={() => void onToggleActive(farm)}>
            {farm.active ? "Disable" : "Enable"}
          </button>
          <button className="btn" type="button" onClick={() => void onRefresh(farm)}>
            Refresh
          </button>
          <button className="btn" type="button" onClick={() => void onSnapshot(farm)}>
            Snapshot
          </button>
          <button
            className="btn"
            type="button"
            data-testid="player-remove"
            onClick={() => void onRemove(farm)}
          >
            Remove
          </button>
        </div>
      </div>
      {score && (
        <p className="meta">
          Live record: {String(score.digs_to_third_op ?? "—")} digs ·{" "}
          {String(score.otter_count ?? 0)} pebbles · {String(score.status ?? "—")}
        </p>
      )}
      <div className="kicker">History</div>
      {(detail?.history ?? []).length === 0 && <p className="muted">No ended-event records yet.</p>}
      {(detail?.history ?? []).map((row) => (
        <div
          key={row.tournament_id}
          className="meta"
          data-testid={`player-history-${row.tournament_id}`}
        >
          {row.name || row.tournament_id}: rank {row.rank ?? "—"} · {formatScore(row.score)} ·{" "}
          {row.digs_to_third_op ?? "—"} digs
        </div>
      ))}
      <div className="kicker" style={{ marginTop: 12 }}>
        Enrollments
      </div>
      {(detail?.enrollments ?? []).length === 0 && (
        <p className="muted">Not enrolled in any event.</p>
      )}
      {(detail?.enrollments ?? []).map((row) => (
        <div key={`${row.tournament_id}-${row.farm_id}`} className="meta">
          {row.tournament_name || row.tournament_id} · {row.status}
        </div>
      ))}
      {snapshot && <pre className="snapshot">{snapshot}</pre>}
    </div>
  );
}
