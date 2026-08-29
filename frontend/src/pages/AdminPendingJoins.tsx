import type { Submission, TournamentSummary } from "../api/public";

export function tournamentNameForJoin(
  item: Submission,
  tournaments: TournamentSummary[] = [],
): string {
  const fromRow = (item.tournament_name || "").trim();
  if (fromRow) return fromRow;
  const match = tournaments.find((row) => row.tournament_id === item.tournament_id);
  return (match?.name || "").trim() || "Untitled tournament";
}

export type PendingJoinGroup = {
  tournament_id: string;
  name: string;
  count: number;
};

export function pendingJoinsByTournament(
  submissions: Submission[],
  tournaments: TournamentSummary[] = [],
): PendingJoinGroup[] {
  const groups = new Map<string, PendingJoinGroup>();
  for (const item of submissions) {
    const existing = groups.get(item.tournament_id);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(item.tournament_id, {
      tournament_id: item.tournament_id,
      name: tournamentNameForJoin(item, tournaments),
      count: 1,
    });
  }
  return [...groups.values()];
}

export function AdminPendingJoins({
  submissions,
  tournaments = [],
  onOpen,
}: {
  submissions: Submission[];
  tournaments?: TournamentSummary[];
  onOpen?: (tournamentId: string) => void;
}) {
  const groups = pendingJoinsByTournament(submissions, tournaments);

  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="admin-pending-joins">
      <div className="kicker">Pending joins</div>
      {groups.length === 0 && <p className="muted">None waiting.</p>}
      {groups.map((group) => (
        <button
          key={group.tournament_id}
          type="button"
          className="pending-join-row"
          data-testid={`admin-pending-open-${group.tournament_id}`}
          onClick={() => onOpen?.(group.tournament_id)}
        >
          <span>{group.name}</span>
          <span className="pending-join-count" data-testid={`admin-pending-count-${group.tournament_id}`}>
            {group.count} pending
          </span>
        </button>
      ))}
    </section>
  );
}
