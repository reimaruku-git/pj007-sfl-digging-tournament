import { FormEvent, useEffect, useMemo, useState } from "react";
import type { RosterMember, TrackedFarm } from "../api/admin";
import type { BumpkinIsland, JoinMode, PrizePlace, TournamentSummary } from "../api/public";
import { MIN_BUMPKIN_ISLANDS } from "../api/public";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";
import {
  ADMIN_LIVE_PREVIEW,
  ADMIN_PAST_PREVIEW,
  adminBucketPreview,
  adminLiveNeedsOverflow,
  adminPastNeedsOverflow,
  filterTournamentsBySearch,
  liveTournamentsSoonestFirst,
  pastTournaments,
  upcomingTournaments,
} from "../lib/board";
import {
  formatDateRangeUtc,
  formatDetailDateRangeUtc,
  inclusiveCalendarDays,
  inclusiveFinalDayIso,
  isoToDateInput,
  joinedCountLabel,
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
  reviewId,
  onReview,
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
  reviewId?: string | null;
  onReview?: (id: string | null) => void;
}) {
  const live = useMemo(() => liveTournamentsSoonestFirst(items), [items]);
  const upcoming = useMemo(() => upcomingTournaments(items), [items]);
  const ended = useMemo(() => pastTournaments(items), [items]);
  const [editor, setEditor] = useState<Editor>(null);
  const [draft, setDraft] = useState<TournamentDraft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localReviewId, setLocalReviewId] = useState<string | null>(null);
  const [liveOverflow, setLiveOverflow] = useState(false);
  const [pastOverflow, setPastOverflow] = useState(false);
  const confirm = useConfirm();
  const openReviewId = localReviewId;

  useEffect(() => {
    if (reviewId !== undefined) setLocalReviewId(reviewId);
  }, [reviewId]);

  function openPendingReview(id: string) {
    setLocalReviewId(id);
    onReview?.(id);
    onSelect?.(id);
  }

  function closePendingReview() {
    setLocalReviewId(null);
    onReview?.(null);
  }

  function openRoster(id: string) {
    setLocalReviewId(null);
    onReview?.(null);
    onSelect?.(selectedId === id ? null : id);
  }

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
        <div className="admin-tourney-col" data-testid="admin-live-column">
          <AdminGroup
            title="Ongoing"
            empty="No ongoing tournament."
            items={adminBucketPreview(live, ADMIN_LIVE_PREVIEW)}
            selectedId={selectedId}
            featuredId={featuredId}
            canFeature
            onOpen={openRoster}
            onEdit={openEdit}
            onDelete={requestDelete}
            onFeature={onFeature}
          />
          <AdminGroup
            title="Upcoming"
            empty="No upcoming tournaments."
            items={adminBucketPreview(upcoming, ADMIN_LIVE_PREVIEW)}
            selectedId={selectedId}
            featuredId={featuredId}
            canFeature
            onOpen={openPendingReview}
            onEdit={openEdit}
            onDelete={requestDelete}
            onFeature={onFeature}
          />
          {adminLiveNeedsOverflow(live.length, upcoming.length) ? (
            <button
              type="button"
              className="admin-overflow-link"
              data-testid="admin-see-all-live"
              onClick={() => setLiveOverflow(true)}
            >
              See all ongoing and upcoming &gt;
            </button>
          ) : null}
        </div>
        <div className="admin-tourney-col" data-testid="admin-past-column">
          <AdminGroup
            title="Past"
            empty="No past tournaments."
            items={adminBucketPreview(ended, ADMIN_PAST_PREVIEW)}
            selectedId={selectedId}
            featuredId={featuredId}
            canFeature
            onOpen={openRoster}
            onFeature={onFeature}
          />
          {adminPastNeedsOverflow(ended.length) ? (
            <button
              type="button"
              className="admin-overflow-link"
              data-testid="admin-see-all-past"
              onClick={() => setPastOverflow(true)}
            >
              See all past &gt;
            </button>
          ) : null}
        </div>
      </div>

      {liveOverflow && (
        <AdminOverflow
          kind="live"
          live={live}
          upcoming={upcoming}
          past={[]}
          selectedId={selectedId}
          featuredId={featuredId}
          onClose={() => setLiveOverflow(false)}
          onOpenLive={(id) => {
            setLiveOverflow(false);
            openRoster(id);
          }}
          onOpenUpcoming={(id) => {
            setLiveOverflow(false);
            openPendingReview(id);
          }}
          onEdit={(row) => {
            setLiveOverflow(false);
            openEdit(row);
          }}
          onDelete={requestDelete}
          onFeature={onFeature}
        />
      )}

      {pastOverflow && (
        <AdminOverflow
          kind="past"
          live={[]}
          upcoming={[]}
          past={ended}
          selectedId={selectedId}
          featuredId={featuredId}
          onClose={() => setPastOverflow(false)}
          onOpenLive={openRoster}
          onOpenUpcoming={openPendingReview}
          onOpenPast={(id) => {
            setPastOverflow(false);
            openRoster(id);
          }}
          onEdit={openEdit}
          onDelete={requestDelete}
          onFeature={onFeature}
        />
      )}

      {openReviewId && (
        <PendingJoinReview
          tournamentId={openReviewId}
          tournament={items.find((item) => item.tournament_id === openReviewId) ?? null}
          roster={roster}
          onClose={closePendingReview}
          onApprove={onApprove}
          onReject={onReject}
          ask={confirm.ask}
        />
      )}

      {selectedId && !openReviewId && (
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

function islandLabel(island: string | null | undefined): string {
  if (!island) return "None";
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
  onOpen?: (id: string) => void;
  onEdit?: (row: TournamentSummary) => void;
  onDelete?: (row: TournamentSummary) => void | Promise<void>;
  onFeature?: (id: string | null) => Promise<void>;
}) {
  const bucket = title.toLowerCase();
  return (
    <div className="tourney-group" data-testid={`admin-${bucket}-group`}>
      <div className="kicker">{title}</div>
      {items.length === 0 && (
        <p className="muted tourney-empty" data-testid={`admin-${bucket}-empty`}>
          {empty}
        </p>
      )}
      {items.map((row) => (
        <AdminTourneyCard
          key={row.tournament_id}
          row={row}
          selectedId={selectedId}
          featuredId={featuredId}
          canFeature={canFeature}
          onOpen={onOpen}
          onEdit={onEdit}
          onDelete={onDelete}
          onFeature={onFeature}
        />
      ))}
    </div>
  );
}

function AdminTourneyCard({
  row,
  selectedId,
  featuredId,
  canFeature,
  onOpen,
  onEdit,
  onDelete,
  onFeature,
}: {
  row: TournamentSummary;
  selectedId?: string | null;
  featuredId?: string | null;
  canFeature?: boolean;
  onOpen?: (id: string) => void;
  onEdit?: (row: TournamentSummary) => void;
  onDelete?: (row: TournamentSummary) => void | Promise<void>;
  onFeature?: (id: string | null) => Promise<void>;
}) {
  return (
    <article
      className={selectedId === row.tournament_id ? "tourney-card is-open" : "tourney-card"}
      data-testid={`admin-card-${row.tournament_id}`}
    >
      <button
        type="button"
        className="tourney-open"
        data-testid={`admin-open-${row.tournament_id}`}
        onClick={() => onOpen?.(row.tournament_id)}
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
            {row.prize_places.map((item) => `${placeLabel(item.place)} ${item.amount}`).join(" · ")}{" "}
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
  );
}

function AdminOverflow({
  kind,
  live,
  upcoming,
  past,
  selectedId,
  featuredId,
  onClose,
  onOpenLive,
  onOpenUpcoming,
  onOpenPast,
  onEdit,
  onDelete,
  onFeature,
}: {
  kind: "live" | "past";
  live: TournamentSummary[];
  upcoming: TournamentSummary[];
  past: TournamentSummary[];
  selectedId?: string | null;
  featuredId?: string | null;
  onClose: () => void;
  onOpenLive: (id: string) => void;
  onOpenUpcoming: (id: string) => void;
  onOpenPast?: (id: string) => void;
  onEdit?: (row: TournamentSummary) => void;
  onDelete?: (row: TournamentSummary) => void | Promise<void>;
  onFeature?: (id: string | null) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const liveShown = filterTournamentsBySearch(live, query);
  const upcomingShown = filterTournamentsBySearch(upcoming, query);
  const pastShown = filterTournamentsBySearch(past, query);
  return (
    <div
      className="create-overlay"
      data-testid={kind === "live" ? "admin-overflow-live" : "admin-overflow-past"}
      role="dialog"
      aria-modal="true"
    >
      <div className={`create-window admin-overflow-window${kind === "past" ? " is-past" : ""}`}>
        <div className="admin-overflow-head">
          <div className="kicker">
            {kind === "live" ? "Ongoing and upcoming" : "Past tournaments"}
          </div>
          <input
            data-testid="admin-overflow-search"
            placeholder="Search name or id"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search tournaments"
          />
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {kind === "live" ? (
          <div className="admin-overflow-grid">
            <div className="admin-overflow-col" data-testid="admin-overflow-ongoing">
              <div className="kicker">Ongoing</div>
              {liveShown.length === 0 && <p className="muted">No matching ongoing events.</p>}
              {liveShown.map((row) => (
                <AdminTourneyCard
                  key={row.tournament_id}
                  row={row}
                  selectedId={selectedId}
                  featuredId={featuredId}
                  canFeature
                  onOpen={onOpenLive}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onFeature={onFeature}
                />
              ))}
            </div>
            <div className="admin-overflow-col" data-testid="admin-overflow-upcoming">
              <div className="kicker">Upcoming</div>
              {upcomingShown.length === 0 && <p className="muted">No matching upcoming events.</p>}
              {upcomingShown.map((row) => (
                <AdminTourneyCard
                  key={row.tournament_id}
                  row={row}
                  selectedId={selectedId}
                  featuredId={featuredId}
                  canFeature
                  onOpen={onOpenUpcoming}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onFeature={onFeature}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="admin-overflow-grid">
            <div className="admin-overflow-col" data-testid="admin-overflow-past-list">
              {pastShown.length === 0 && <p className="muted">No matching past events.</p>}
              {pastShown.map((row) => (
                <AdminTourneyCard
                  key={row.tournament_id}
                  row={row}
                  selectedId={selectedId}
                  featuredId={featuredId}
                  canFeature
                  onOpen={onOpenPast}
                  onFeature={onFeature}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingJoinReview({
  tournamentId,
  tournament,
  roster,
  onClose,
  onApprove,
  onReject,
  ask,
}: {
  tournamentId: string;
  tournament: TournamentSummary | null;
  roster: RosterMember[];
  onClose: () => void;
  onApprove?: (farmId: string, tournamentId: string) => Promise<void>;
  onReject?: (farmId: string, tournamentId: string) => Promise<void>;
  ask: (title: string, message: string, run: () => void | Promise<void>) => void;
}) {
  const pending = roster.filter((item) => item.status === "pending");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggle(farmId: string) {
    setPicked((current) =>
      current.includes(farmId) ? current.filter((id) => id !== farmId) : [...current, farmId],
    );
  }

  function selectedMembers() {
    return pending.filter((item) => picked.includes(item.farm_id));
  }

  async function runBulk(action: "approve" | "reject") {
    const chosen = selectedMembers();
    setBusy(true);
    try {
      for (const item of chosen) {
        if (action === "approve") await onApprove?.(item.farm_id, tournamentId);
        else await onReject?.(item.farm_id, tournamentId);
      }
      setPicked([]);
    } finally {
      setBusy(false);
    }
  }

  function requestBulk(action: "approve" | "reject") {
    const n = selectedMembers().length;
    if (n === 0) return;
    const verb = action === "approve" ? "Approve" : "Reject";
    ask(
      "Are you sure to do this?",
      `${verb} ${n} join request${n === 1 ? "" : "s"}?`,
      () => runBulk(action),
    );
  }

  const name = tournament?.name || "Untitled tournament";
  const range = tournament
    ? formatDetailDateRangeUtc(
        tournament.start_at,
        inclusiveFinalDayIso(tournament.start_at, tournament.duration_days),
      )
    : "";
  const prizes =
    tournament?.prize_places && tournament.prize_places.length > 0
      ? tournament.prize_places
          .map((item) => {
            const flower = `${placeLabel(item.place)} ${item.amount} Flower`;
            return item.nft_name ? `${flower} · ${item.nft_name}` : flower;
          })
          .join(" · ")
      : tournament
        ? `${tournament.prize_amount} Flower`
        : "";

  return (
    <div
      className="create-overlay"
      data-testid="admin-pending-review"
      role="dialog"
      aria-modal="true"
    >
      <div className="create-window admin-review-window">
        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div className="kicker" style={{ marginBottom: 0 }}>
            {name}
          </div>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="admin-review-facts" data-testid="admin-review-facts">
          {range ? (
            <div className="detail-range" data-testid="admin-review-window">
              {range}
            </div>
          ) : null}
          {tournament?.description ? <p className="tourney-description">{tournament.description}</p> : null}
          {prizes ? (
            <p className="tourney-card-desc" data-testid="admin-review-prizes">
              {prizes}
            </p>
          ) : null}
          {tournament ? (
            <dl className="window-card-facts">
              <div>
                <dt>Joined</dt>
                <dd>
                  {joinedCountLabel(
                    tournament.enrolled_count,
                    tournament.max_players,
                    tournament.count,
                    true,
                  )}
                </dd>
              </div>
              <div>
                <dt>Island</dt>
                <dd>{islandLabel(tournament.min_bumpkin_island)}</dd>
              </div>
              <div>
                <dt>Streak</dt>
                <dd>
                  {tournament.min_digging_streak == null ? "None" : tournament.min_digging_streak}
                </dd>
              </div>
              <div>
                <dt>VIP</dt>
                <dd>{tournament.vip_required ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Needs approval</dt>
                <dd>{tournament.join_mode === "auto" ? "No" : "Yes"}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        <div className="kicker">Joining players</div>
        {pending.length === 0 && <p className="muted">None waiting for this event.</p>}
        {pending.map((item) => (
          <label key={item.farm_id} className="join-option">
            <input
              type="checkbox"
              data-testid={`admin-review-pick-${item.farm_id}`}
              checked={picked.includes(item.farm_id)}
              onChange={() => toggle(item.farm_id)}
            />
            <span>
              {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
            </span>
          </label>
        ))}
        {pending.length > 0 && (
          <div className="toolbar admin-review-actions">
            <span className="toolbar" style={{ marginBottom: 0 }}>
              <button
                className="btn"
                type="button"
                data-testid="admin-review-select-all"
                onClick={() => setPicked(pending.map((item) => item.farm_id))}
              >
                Select all
              </button>
              <button
                className="btn"
                type="button"
                data-testid="admin-review-deselect-all"
                onClick={() => setPicked([])}
              >
                Deselect all
              </button>
            </span>
            <span className="toolbar" style={{ marginBottom: 0 }}>
              <button
                className="btn primary"
                type="button"
                data-testid="admin-review-approve"
                disabled={busy || picked.length === 0}
                onClick={() => requestBulk("approve")}
              >
                Approve selected
              </button>
              <button
                className="btn"
                type="button"
                data-testid="admin-review-reject"
                disabled={busy || picked.length === 0}
                onClick={() => requestBulk("reject")}
              >
                Reject selected
              </button>
            </span>
          </div>
        )}
      </div>
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
