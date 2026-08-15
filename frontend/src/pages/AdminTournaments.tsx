import { FormEvent, useMemo, useState } from "react";
import type { TournamentSummary } from "../api/public";
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
  loading,
  onCreate,
  onUpdate,
  onDelete,
}: {
  items: TournamentSummary[];
  loading?: boolean;
  onCreate: (draft: TournamentDraft) => Promise<void>;
  onUpdate: (id: string, draft: TournamentDraft) => Promise<void>;
  onDelete: (row: TournamentSummary) => Promise<void>;
}) {
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<TournamentDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <div className="tourney-home admin-tourney-home">
        <AdminGroup title="Ongoing" empty="No ongoing tournament." items={live} onEdit={openEdit} onDelete={onDelete} />
        <AdminGroup
          title="Upcoming"
          empty="No upcoming tournaments."
          items={upcoming}
          onEdit={openEdit}
          onDelete={onDelete}
        />
      </div>

      {loading && <p className="muted">Loading tournaments…</p>}

      {editor && (
        <form className="form-grid admin-tourney-form" onSubmit={(event) => void submit(event)}>
          <div className="kicker">{editor.mode === "edit" ? "Edit tournament" : "Create new tournament"}</div>
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
              onChange={(event) => setDraft({ ...draft, duration_days: Number(event.target.value) })}
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
            <button className="btn primary" type="submit" disabled={busy || !draft.name.trim() || !draft.start_at}>
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
  onEdit,
  onDelete,
}: {
  title: string;
  empty: string;
  items: TournamentSummary[];
  onEdit: (row: TournamentSummary) => void;
  onDelete: (row: TournamentSummary) => Promise<void>;
}) {
  return (
    <div className="tourney-group" data-testid={`admin-${title.toLowerCase()}-group`}>
      <div className="kicker">{title}</div>
      {items.length === 0 && <p className="muted tourney-empty">{empty}</p>}
      {items.map((row) => (
        <article key={row.tournament_id} className="tourney-card" data-testid={`admin-card-${row.tournament_id}`}>
          <div className="tourney-card-name">{row.name || "Untitled tournament"}</div>
          <div className="tourney-card-meta">
            {formatDateRangeUtc(row.start_at, row.end_at, row.duration_days)} · {row.prize_amount} Flower
          </div>
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            <button className="btn" type="button" onClick={() => onEdit(row)}>
              Edit
            </button>
            <button className="btn" type="button" onClick={() => void onDelete(row)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
