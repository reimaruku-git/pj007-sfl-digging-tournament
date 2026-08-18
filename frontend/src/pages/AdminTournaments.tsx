import { FormEvent, useMemo, useState } from "react";
import type { RosterMember, TrackedFarm } from "../api/admin";
import type { TournamentSummary } from "../api/public";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";
import { liveTournamentsSoonestFirst, upcomingTournaments } from "../lib/board";
import { formatDateRangeUtc, isoToDateInput } from "../lib/format";

export type TournamentDraft = {
  name: string;
  start_at: string;
  duration_days: number;
  prize_amount: string;
};

type Editor = { mode: "create" } | { mode: "edit"; id: string } | null;

export function AdminTournaments({
  items,
  players = [],
  loading,
  selectedId = null,
  roster = [],
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onAddFarms,
  onRemoveFarm,
  onApprove,
  onReject,
}: {
  items: TournamentSummary[];
  players?: TrackedFarm[];
  loading?: boolean;
  selectedId?: string | null;
  roster?: RosterMember[];
  onSelect?: (id: string | null) => void;
  onCreate: (draft: TournamentDraft) => Promise<void>;
  onUpdate: (id: string, draft: TournamentDraft) => Promise<void>;
  onDelete: (row: TournamentSummary) => Promise<void>;
  onAddFarms?: (id: string, farmIds: string[]) => Promise<void>;
  onRemoveFarm?: (id: string, farmId: string) => Promise<void>;
  onApprove?: (farmId: string, tournamentId: string) => Promise<void>;
  onReject?: (farmId: string, tournamentId: string) => Promise<void>;
}) {
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<TournamentDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  function requestDelete(row: TournamentSummary) {
    const label = row.name || "this tournament";
    confirm.ask("Are you sure to do this?", `Delete ${label}? This cannot be undone.`, () =>
      onDelete(row),
    );
  }

  function requestReject(farmId: string, tournamentId: string, name: string) {
    confirm.ask("Are you sure to do this?", `Reject the join request from ${name || farmId}?`, () =>
      onReject?.(farmId, tournamentId),
    );
  }

  function requestRemoveFarm(tournamentId: string, farmId: string, name: string) {
    confirm.ask("Are you sure to do this?", `Remove ${name || farmId} from this tournament?`, () =>
      onRemoveFarm?.(tournamentId, farmId),
    );
  }

  function openCreate() {
    setDraft(emptyDraft());
    setError(null);
    setEditor({ mode: "create" });
  }

  function openEdit(row: TournamentSummary) {
    setDraft({
      name: row.name || "",
      start_at: isoToDateInput(row.start_at),
      duration_days: row.duration_days || 7,
      prize_amount: row.prize_amount || "30",
    });
    setError(null);
    setEditor({ mode: "edit", id: row.tournament_id });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.start_at) {
      setError("Name and start date are required.");
      return;
    }
    if (draft.duration_days < 1) {
      setError("Tournament must run at least 1 day.");
      return;
    }
    const payload: TournamentDraft = {
      name: draft.name.trim(),
      start_at: `${draft.start_at}T00:00:00.000Z`,
      duration_days: draft.duration_days,
      prize_amount: draft.prize_amount.trim() || "30",
    };
    setBusy(true);
    setError(null);
    try {
      if (editor?.mode === "edit") {
        await onUpdate(editor.id, payload);
      } else {
        await onCreate(payload);
      }
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="kicker" style={{ marginBottom: 0 }}>
          Tournaments
        </div>
        <button className="btn primary" type="button" onClick={openCreate}>
          Create new tournament
        </button>
      </div>

      <div className="admin-tourney-home">
        <AdminGroup
          title="Ongoing"
          empty="No ongoing tournament."
          items={live}
          selectedId={selectedId}
          onOpen={onSelect}
          onEdit={openEdit}
          onDelete={requestDelete}
        />
        <AdminGroup
          title="Upcoming"
          empty="No upcoming tournaments."
          items={upcoming}
          selectedId={selectedId}
          onOpen={onSelect}
          onEdit={openEdit}
          onDelete={requestDelete}
        />
      </div>

      {selectedId && (
        <TournamentRoster
          tournamentId={selectedId}
          name={items.find((item) => item.tournament_id === selectedId)?.name || selectedId}
          players={players}
          roster={roster}
          onAddFarms={onAddFarms}
          onRemoveFarm={requestRemoveFarm}
          onApprove={onApprove}
          onReject={requestReject}
          onClose={() => onSelect?.(null)}
        />
      )}

      <ConfirmDialog
        pending={confirm.pending}
        onYes={() => void confirm.accept()}
        onNo={confirm.cancel}
      />

      {loading && <p className="muted">Loading tournaments…</p>}

      {editor && (
        <form className="form-grid admin-tourney-form" onSubmit={(event) => void submit(event)}>
          <div className="kicker">
            {editor.mode === "edit" ? "Edit tournament" : "Create new tournament"}
          </div>
          {error && <div className="flash err">{error}</div>}
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Late August Otter Cup"
              required
            />
          </label>
          <label>
            From
            <input
              type="date"
              value={draft.start_at}
              onChange={(event) => setDraft({ ...draft, start_at: event.target.value })}
              required
            />
          </label>
          <label>
            Length (days)
            <input
              type="number"
              min={1}
              value={draft.duration_days}
              onChange={(event) =>
                setDraft({ ...draft, duration_days: Number(event.target.value) })
              }
              required
            />
          </label>
          <label>
            Prize (Flower)
            <input
              value={draft.prize_amount}
              onChange={(event) => setDraft({ ...draft, prize_amount: event.target.value })}
            />
          </label>
          <div className="toolbar">
            <button
              className="btn primary"
              type="submit"
              disabled={busy || !draft.name.trim() || !draft.start_at}
            >
              {editor.mode === "edit" ? "Save changes" : "Create tournament"}
            </button>
            <button className="btn" type="button" onClick={() => setEditor(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function emptyDraft(): TournamentDraft {
  return { name: "", start_at: "", duration_days: 7, prize_amount: "30" };
}

function AdminGroup({
  title,
  empty,
  items,
  selectedId,
  onOpen,
  onEdit,
  onDelete,
}: {
  title: string;
  empty: string;
  items: TournamentSummary[];
  selectedId?: string | null;
  onOpen?: (id: string | null) => void;
  onEdit: (row: TournamentSummary) => void;
  onDelete: (row: TournamentSummary) => void | Promise<void>;
}) {
  return (
    <div className="tourney-group" data-testid={`admin-${title.toLowerCase()}-group`}>
      <div className="kicker">{title}</div>
      {items.length === 0 && (
        <p className="muted tourney-empty" data-testid={`admin-${title.toLowerCase()}-empty`}>
          {empty}
        </p>
      )}
      {items.map((row) => (
        <article
          key={row.tournament_id}
          className={selectedId === row.tournament_id ? "tourney-card is-open" : "tourney-card"}
          data-testid={`admin-card-${row.tournament_id}`}
        >
          <button
            type="button"
            className="tourney-open"
            data-testid={`admin-open-${row.tournament_id}`}
            onClick={() => onOpen?.(selectedId === row.tournament_id ? null : row.tournament_id)}
          >
            <div className="tourney-card-name">{row.name || "Untitled tournament"}</div>
            <div className="tourney-card-meta">
              {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} · {row.prize_amount}{" "}
              Flower
            </div>
          </button>
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            <button className="btn" type="button" onClick={() => onEdit(row)}>
              Edit
            </button>
            <button
              className="btn"
              type="button"
              data-testid={`admin-delete-${row.tournament_id}`}
              onClick={() => void onDelete(row)}
            >
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TournamentRoster({
  tournamentId,
  name,
  players,
  roster,
  onAddFarms,
  onRemoveFarm,
  onApprove,
  onReject,
  onClose,
}: {
  tournamentId: string;
  name: string;
  players: TrackedFarm[];
  roster: RosterMember[];
  onAddFarms?: (id: string, farmIds: string[]) => Promise<void>;
  onRemoveFarm?: (id: string, farmId: string, name: string) => void;
  onApprove?: (farmId: string, tournamentId: string) => Promise<void>;
  onReject?: (farmId: string, tournamentId: string, name: string) => void;
  onClose: () => void;
}) {
  const enrolled = new Set(
    roster.filter((item) => item.status === "enrolled").map((item) => item.farm_id),
  );
  const pending = roster.filter((item) => item.status === "pending");
  const available = players.filter((item) => !enrolled.has(item.farm_id));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggle(farmId: string) {
    setPicked((current) =>
      current.includes(farmId) ? current.filter((id) => id !== farmId) : [...current, farmId],
    );
  }

  return (
    <div className="player-detail" data-testid={`admin-roster-${tournamentId}`}>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <div className="kicker" style={{ marginBottom: 0 }}>
          Roster · {name}
        </div>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="kicker">Pending joins</div>
      {pending.length === 0 && <p className="muted">None waiting for this event.</p>}
      {pending.map((item) => (
        <div key={item.farm_id} className="toolbar">
          <span>
            {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
          </span>
          <button
            className="btn primary"
            type="button"
            onClick={() => void onApprove?.(item.farm_id, tournamentId)}
          >
            Approve
          </button>
          <button
            className="btn"
            type="button"
            data-testid={`admin-reject-${item.farm_id}`}
            onClick={() => onReject?.(item.farm_id, tournamentId, item.name || "")}
          >
            Reject
          </button>
        </div>
      ))}
      <div className="kicker">Enrolled</div>
      {roster.filter((item) => item.status === "enrolled").length === 0 && (
        <p className="muted">No one enrolled yet.</p>
      )}
      {roster
        .filter((item) => item.status === "enrolled")
        .map((item) => (
          <div key={item.farm_id} className="toolbar">
            <span>
              {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
            </span>
            <button
              className="btn"
              type="button"
              data-testid={`admin-remove-roster-${item.farm_id}`}
              onClick={() => onRemoveFarm?.(tournamentId, item.farm_id, item.name || "")}
            >
              Remove from event
            </button>
          </div>
        ))}
      <div className="kicker">Add existing players</div>
      {available.length === 0 && (
        <p className="muted">Every tracked player is already on this event.</p>
      )}
      {available.map((farm) => (
        <label key={farm.farm_id} className="join-option">
          <input
            type="checkbox"
            checked={picked.includes(farm.farm_id)}
            onChange={() => toggle(farm.farm_id)}
          />
          <span>
            {farm.name || "Unnamed"} <span className="farm-id">{farm.farm_id}</span>
          </span>
        </label>
      ))}
      {available.length > 0 && (
        <button
          className="btn primary"
          type="button"
          disabled={busy || picked.length === 0}
          onClick={() => {
            setBusy(true);
            void onAddFarms?.(tournamentId, picked)
              .then(() => setPicked([]))
              .finally(() => setBusy(false));
          }}
        >
          Add selected
        </button>
      )}
    </div>
  );
}
