import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm, fetchTournamentFarm } from "../api/public";
import { FarmResult } from "../components/FarmResult";
import { farmBackTarget } from "../lib/backTarget";

export function FarmPage() {
  const { farmId = "", tournamentId } = useParams();
  const query = useQuery({
    queryKey: tournamentId ? ["farm", tournamentId, farmId] : ["farm", farmId],
    queryFn: () =>
      tournamentId ? fetchTournamentFarm(tournamentId, farmId) : fetchFarm(farmId),
    enabled: Boolean(farmId),
  });

  const farm = query.data;
  const back = farmBackTarget(tournamentId);

  return (
    <div className="card farm-sheet">
      <div className="kicker">Personal result</div>
      <p className="meta">
        <Link to={back.to} data-testid="back-link">
          ← {back.label}
        </Link>
      </p>
      {query.isLoading && (
        <div className="skeleton-stack" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {query.isError && <p className="flash err">{(query.error as Error).message}</p>}
      {farm && <FarmResult farm={farm} />}
    </div>
  );
}
