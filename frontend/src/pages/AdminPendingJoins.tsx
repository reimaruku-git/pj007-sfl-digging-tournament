import { Link } from "react-router-dom";
import type { Submission, TournamentSummary } from "../api/public";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";

export function tournamentNameForJoin(
  item: Submission,
  tournaments: TournamentSummary[] = [],
): string {
  const fromRow = (item.tournament_name || "").trim();
  if (fromRow) return fromRow;
  const match = tournaments.find((row) => row.tournament_id === item.tournament_id);
  return (match?.name || "").trim() || "Untitled tournament";
}

export function AdminPendingJoins({
  submissions,
  tournaments = [],
  onOpen,
  onApprove,
  onReject,
}: {
  submissions: Submission[];
  tournaments?: TournamentSummary[];
  onOpen?: (tournamentId: string) => void;
  onApprove: (farmId: string, tournamentId: string) => Promise<void>;
  onReject: (farmId: string, tournamentId: string) => Promise<void>;
}) {
  const confirm = useConfirm();

  function requestReject(item: Submission) {
    confirm.ask(
      "Are you sure to do this?",
      `Reject the join request from ${item.name || item.farm_id}?`,
      () => onReject(item.farm_id, item.tournament_id),
    );
  }

  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="admin-pending-joins">
      <div className="kicker">Pending joins</div>
      {submissions.length === 0 && <p className="muted">None waiting.</p>}
      {submissions.map((item) => {
        const label = tournamentNameForJoin(item, tournaments);
        const href = `/tournaments/${encodeURIComponent(item.tournament_id)}`;
        return (
          <div key={`${item.farm_id}-${item.tournament_id}`} className="toolbar">
            <span>
              {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
              <div className="meta">
                wants{" "}
                <button
                  type="button"
                  className="pending-tourney-name"
                  data-testid={`admin-pending-open-${item.tournament_id}`}
                  onClick={() => onOpen?.(item.tournament_id)}
                >
                  {label}
                </button>
                {" · "}
                <Link
                  to={href}
                  className="pending-tourney-view"
                  data-testid={`admin-pending-view-${item.tournament_id}`}
                >
                  View
                </Link>
              </div>
            </span>
            <button
              className="btn primary"
              type="button"
              data-testid={`admin-dashboard-approve-${item.farm_id}`}
              onClick={() => void onApprove(item.farm_id, item.tournament_id)}
            >
              Approve
            </button>
            <button
              className="btn"
              type="button"
              data-testid={`admin-dashboard-reject-${item.farm_id}`}
              onClick={() => requestReject(item)}
            >
              Reject
            </button>
          </div>
        );
      })}
      <ConfirmDialog
        pending={confirm.pending}
        onYes={() => void confirm.accept()}
        onNo={confirm.cancel}
      />
    </section>
  );
}
