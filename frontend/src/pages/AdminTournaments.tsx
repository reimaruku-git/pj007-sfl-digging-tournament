import { FormEvent, useMemo, useState } from "react";
import type { RosterMember, TrackedFarm } from "../api/admin";
import type { BumpkinIsland, JoinMode, PrizePlace, TournamentSummary } from "../api/public";
import { MIN_BUMPKIN_ISLANDS } from "../api/public";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";
import {
  adminBucketNeedsCheckAll,
  adminBucketPreview,
  liveTournamentsSoonestFirst,
  pastTournaments,
  upcomingTournaments,
} from "../lib/board";
import {
  formatDateRangeUtc,
  inclusiveCalendarDays,
  inclusiveFinalDayIso,
  isoToDateInput,
} from "../lib/format";

export type TournamentDraft = {
  name: string;
  start_at: string;
  end_at: string;
  prize_amount: string;
  description: string;
  min_bumpkin_island: BumpkinIsland | null;
  min_digging_streak: number | null;
  vip_required: boolean;
  max_players: number | null;
  join_mode: JoinMode;
  nft_giveaway: boolean;
  prize_places: PrizePlace[];
};

export type TournamentSavePayload = TournamentDraft & {
  duration_days: number;
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
  featuredId = null,
  onFeature,
}: {
  items: TournamentSummary[];
  players?: TrackedFarm[];
  loading?: boolean;
  selectedId?: string | null;
  roster?: RosterMember[];
  onSelect?: (id: string | null) => void;
  onCreate: (draft: TournamentSavePayload) => Promise<void>;
  onUpdate: (id: string, draft: TournamentSavePayload) => Promise<void>;
  onDelete: (row: TournamentSummary) => Promise<void>;
  onAddFarms?: (id: string, farmIds: string[]) => Promise<void>;
  onRemoveFarm?: (id: string, farmId: string) => Promise<void>;
  onApprove?: (farmId: string, tournamentId: string) => Promise<void>;
  onReject?: (farmId: string, tournamentId: string) => Promise<void>;
  featuredId?: string | null;
  onFeature?: (id: string | null) => Promise<void>;
}) {
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);
  const ended = useMemo(() => pastTournaments(items), [items]);
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
      end_at: isoToDateInput(inclusiveFinalDayIso(row.start_at, row.duration_days)),
      prize_amount: row.prize_amount || "30",
      description: row.description || "",
      min_bumpkin_island: row.min_bumpkin_island ?? null,
      min_digging_streak: row.min_digging_streak ?? null,
      vip_required: Boolean(row.vip_required),
      max_players: row.max_players ?? null,
      join_mode: row.join_mode === "auto" ? "auto" : "confirm",
      nft_giveaway: Boolean(row.nft_giveaway),
      prize_places: (row.prize_places ?? []).map((item) => ({
        place: item.place,
        amount: item.amount,
        nft_name: item.nft_name || "",
      })),
    });
    setError(null);
    setEditor({ mode: "edit", id: row.tournament_id });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.start_at || !draft.end_at) {
      setError("Title, start date, and end date are required.");
      return;
    }
    const days = inclusiveCalendarDays(draft.start_at, draft.end_at);
    if (days < 1) {
      setError("Tournament must run at least 1 day.");
      return;
    }
    const prizeAmount = draft.prize_amount.trim() || "30";
    const prizePlaces = draft.prize_places.map((item) => {
      const row: PrizePlace = { place: item.place, amount: item.amount.trim() || "0" };
      if (draft.nft_giveaway) row.nft_name = (item.nft_name || "").trim();
      return row;
    });
    if (!draft.nft_giveaway && prizePlaces.length > 0) {
      const sum = prizePlaces.reduce((total, item) => total + Number(item.amount || 0), 0);
      if (sum !== Number(prizeAmount)) {
        setError("Winner Flower prizes must sum to the prize pool.");
        return;
      }
    }
    const payload: TournamentSavePayload = {
      name: draft.name.trim(),
      start_at: `${draft.start_at}T00:00:00.000Z`,
      end_at: `${draft.end_at}T00:00:00.000Z`,
      duration_days: days,
      prize_amount: prizeAmount,
      description: draft.description.trim(),
      min_bumpkin_island: draft.min_bumpkin_island,
      min_digging_streak: draft.min_digging_streak,
      vip_required: draft.vip_required,
      max_players: draft.max_players,
      join_mode: draft.join_mode,
      nft_giveaway: draft.nft_giveaway,
      prize_places: prizePlaces,
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
          featuredId={featuredId}
          canFeature
          onOpen={onSelect}
          onEdit={openEdit}
          onDelete={requestDelete}
          onFeature={onFeature}
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
        <AdminGroup
          title="Past"
          empty="No past tournaments."
          items={ended}
          selectedId={selectedId}
          featuredId={featuredId}
          canFeature
          onOpen={onSelect}
          onFeature={onFeature}
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
        <div
          className="create-overlay"
          data-testid="create-tournament-window"
          role="dialog"
          aria-modal="true"
        >
          <form className="form-grid create-window" onSubmit={(event) => void submit(event)}>
            <div className="kicker">
              {editor.mode === "edit" ? "Edit tournament" : "Create new tournament"}
            </div>
            {error && <div className="flash err">{error}</div>}
            <label>
              Title
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Late August Otter Cup"
                required
              />
            </label>
            <label>
              Description
              <textarea
                data-testid="tournament-description-input"
                value={draft.description}
                maxLength={2000}
                rows={3}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="Optional rules or flavour text"
              />
            </label>
            <div className="form-row dates-row">
              <label>
                Start date
                <input
                  type="date"
                  data-testid="start-date"
                  value={draft.start_at}
                  onChange={(event) => setDraft({ ...draft, start_at: event.target.value })}
                  required
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  data-testid="end-date"
                  value={draft.end_at}
                  onChange={(event) => setDraft({ ...draft, end_at: event.target.value })}
                  required
                />
              </label>
              <label>
                Total days
                <input
                  data-testid="duration-days"
                  value={
                    inclusiveCalendarDays(draft.start_at, draft.end_at) || ""
                  }
                  readOnly
                />
              </label>
            </div>
            <label>
              Min bumpkin island
              <select
                data-testid="min-bumpkin-island"
                value={draft.min_bumpkin_island ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    min_bumpkin_island: parseIsland(event.target.value),
                  })
                }
              >
                <option value="">None</option>
                {MIN_BUMPKIN_ISLANDS.map((island) => (
                  <option key={island} value={island}>
                    {islandLabel(island)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Min digging streak
              <input
                type="number"
                min={1}
                data-testid="min-digging-streak"
                value={draft.min_digging_streak ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    min_digging_streak: optionalPositiveInt(event.target.value),
                  })
                }
                placeholder="None"
              />
            </label>
            <label>
              VIP status
              <select
                data-testid="vip-status"
                value={draft.vip_required ? "true" : "false"}
                onChange={(event) =>
                  setDraft({ ...draft, vip_required: event.target.value === "true" })
                }
              >
                <option value="false">False</option>
                <option value="true">True</option>
              </select>
            </label>
            <label>
              Maximum players
              <input
                type="number"
                min={1}
                data-testid="max-players"
                value={draft.max_players ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, max_players: optionalPositiveInt(event.target.value) })
                }
                placeholder="None"
              />
            </label>
            <label>
              How many players can win
              <input
                type="number"
                min={0}
                data-testid="winner-count"
                value={draft.prize_places.length}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    prize_places: resizePrizePlaces(
                      draft.prize_places,
                      Number(event.target.value),
                      draft.prize_amount,
                    ),
                  })
                }
              />
            </label>
            <div className="form-row prize-pool-row">
              <label>
                Prize pool
                <input
                  data-testid="prize-pool"
                  value={draft.prize_amount}
                  onChange={(event) => setDraft({ ...draft, prize_amount: event.target.value })}
                />
              </label>
              <label className="nft-toggle">
                <input
                  type="checkbox"
                  data-testid="nft-giveaway"
                  checked={draft.nft_giveaway}
                  onChange={(event) => setDraft({ ...draft, nft_giveaway: event.target.checked })}
                />
                NFTs given away
              </label>
            </div>
            {draft.prize_places.map((item, index) => (
              <div
                key={item.place}
                className={draft.nft_giveaway ? "form-row winner-row is-nft" : "form-row winner-row"}
              >
                <label>
                  {placeLabel(item.place)} prize
                  <input
                    data-testid={`prize-place-${item.place}`}
                    value={item.amount}
                    onChange={(event) => {
                      const next = draft.prize_places.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, amount: event.target.value } : row,
                      );
                      setDraft({ ...draft, prize_places: next });
                    }}
                    placeholder="Flower"
                  />
                </label>
                {draft.nft_giveaway ? (
                  <label>
                    NFT
                    <input
                      data-testid={`prize-place-${item.place}-nft`}
                      value={item.nft_name || ""}
                      onChange={(event) => {
                        const next = draft.prize_places.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, nft_name: event.target.value } : row,
                        );
                        setDraft({ ...draft, prize_places: next });
                      }}
                      placeholder="NFT name"
                    />
                  </label>
                ) : null}
              </div>
            ))}
            <label>
              Join mode
              <select
                data-testid="join-mode"
                value={draft.join_mode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    join_mode: event.target.value === "auto" ? "auto" : "confirm",
                  })
                }
              >
                <option value="confirm">Must confirm</option>
                <option value="auto">Auto join</option>
              </select>
            </label>
            <div className="toolbar">
              <button
                className="btn primary"
                type="submit"
                disabled={busy || !draft.name.trim() || !draft.start_at || !draft.end_at}
              >
                {editor.mode === "edit" ? "Save changes" : "Create tournament"}
              </button>
              <button className="btn" type="button" onClick={() => setEditor(null)} disabled={busy}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function emptyDraft(): TournamentDraft {
  return {
    name: "",
    start_at: "",
    end_at: "",
    prize_amount: "30",
    description: "",
    min_bumpkin_island: null,
    min_digging_streak: null,
    vip_required: false,
    max_players: null,
    join_mode: "confirm",
    nft_giveaway: false,
    prize_places: [],
  };
}

function parseIsland(raw: string): BumpkinIsland | null {
  return MIN_BUMPKIN_ISLANDS.find((item) => item === raw) ?? null;
}

function islandLabel(island: string): string {
  if (island === "volcano+") return "Volcano+";
  return island.charAt(0).toUpperCase() + island.slice(1);
}

function optionalPositiveInt(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return value;
}

function resizePrizePlaces(
  current: PrizePlace[],
  count: number,
  headline: string,
): PrizePlace[] {
  const n = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
  const next = current.slice(0, n).map((item, index) => ({
    place: index + 1,
    amount: item.amount,
    nft_name: item.nft_name || "",
  }));
  while (next.length < n) {
    next.push({
      place: next.length + 1,
      amount: next.length === 0 ? headline.trim() || "30" : "",
      nft_name: "",
    });
  }
  return next;
}

function placeLabel(place: number): string {
  if (place === 1) return "1st";
  if (place === 2) return "2nd";
  if (place === 3) return "3rd";
  return `${place}th`;
}

function AdminGroup({
  title,
  empty,
  items,
  selectedId,
  featuredId,
  canFeature,
  onOpen,
  onEdit,
  onDelete,
  onFeature,
}: {
  title: string;
  empty: string;
  items: TournamentSummary[];
  selectedId?: string | null;
  featuredId?: string | null;
  canFeature?: boolean;
  onOpen?: (id: string | null) => void;
  onEdit?: (row: TournamentSummary) => void;
  onDelete?: (row: TournamentSummary) => void | Promise<void>;
  onFeature?: (id: string | null) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = adminBucketPreview(items, expanded);
  const showCheckAll = adminBucketNeedsCheckAll(items.length) && !expanded;
  const bucket = title.toLowerCase();
  return (
    <div className="tourney-group" data-testid={`admin-${bucket}-group`}>
      <div className="kicker">{title}</div>
      {items.length === 0 && (
        <p className="muted tourney-empty" data-testid={`admin-${bucket}-empty`}>
          {empty}
        </p>
      )}
      {visible.map((row) => (
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
              {row.min_bumpkin_island ? ` · ${islandLabel(row.min_bumpkin_island)}` : ""}
              {row.max_players ? ` · max ${row.max_players}` : ""}
              {` · ${row.join_mode === "auto" ? "Auto join" : "Must confirm"}`}
              {featuredId === row.tournament_id ? " · Featured on home" : ""}
            </div>
            {row.description ? <p className="tourney-card-desc">{row.description}</p> : null}
            {row.prize_places && row.prize_places.length > 0 ? (
              <p className="tourney-card-desc" data-testid={`admin-prizes-${row.tournament_id}`}>
                {row.prize_places
                  .map((item) => `${placeLabel(item.place)} ${item.amount}`)
                  .join(" · ")}{" "}
                Flower
              </p>
            ) : null}
          </button>
          <div className="toolbar" style={{ marginTop: 10, marginBottom: 0 }}>
            {canFeature && (
              <button
                className="btn"
                type="button"
                data-testid={`admin-feature-${row.tournament_id}`}
                onClick={() =>
                  void onFeature?.(featuredId === row.tournament_id ? null : row.tournament_id)
                }
              >
                {featuredId === row.tournament_id ? "Featured" : "Feature"}
              </button>
            )}
            {onEdit && (
              <button className="btn" type="button" onClick={() => onEdit(row)}>
                Edit
              </button>
            )}
            {onDelete && (
              <button
                className="btn"
                type="button"
                data-testid={`admin-delete-${row.tournament_id}`}
                onClick={() => void onDelete(row)}
              >
                Delete
              </button>
            )}
          </div>
        </article>
      ))}
      {showCheckAll ? (
        <button
          type="button"
          className="detail-crumb check-standings"
          data-testid={`admin-check-all-${bucket}`}
          onClick={() => setExpanded(true)}
        >
          Check all {bucket} &gt;
        </button>
      ) : null}
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
