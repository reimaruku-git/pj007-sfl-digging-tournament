import type { Submission } from "../api/public";
import { ConfirmDialog, useConfirm } from "../components/ConfirmDialog";

export function AdminPendingJoins({
  submissions,
  onApprove,
  onReject,
}: {
  submissions: Submission[];
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
      {submissions.map((item) => (
        <div key={`${item.farm_id}-${item.tournament_id}`} className="toolbar">
          <span>
            {item.name || "Unnamed"} <span className="farm-id">{item.farm_id}</span>
            <div className="meta">wants {item.tournament_id}</div>
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
      ))}
      <ConfirmDialog
        pending={confirm.pending}
        onYes={() => void confirm.accept()}
        onNo={confirm.cancel}
      />
    </section>
  );
}
