import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm, fetchTournamentFarm } from "../api/public";
import { FarmResult, FarmResultFallback } from "../components/FarmResult";
import { farmBackTarget } from "../lib/backTarget";

export function FarmPage() {
  const { farmId = "", tournamentId } = useParams();
  const overall = !tournamentId;
  const query = useQuery({
    queryKey: tournamentId ? ["farm", tournamentId, farmId] : ["farm", farmId],
    queryFn: () =>
      tournamentId ? fetchTournamentFarm(tournamentId, farmId) : fetchFarm(farmId),
    enabled: Boolean(farmId),
  });

  const farm = query.data;
  const back = farmBackTarget(tournamentId);
  const hasRecord = farm?.recorded_average_per_day != null;

  return (
    <div className="card farm-sheet">
      <div className="kicker">{overall ? "Overall record" : "Personal result"}</div>
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
      {farm && overall && !hasRecord ? (
        <FarmResultFallback
          name={farm.name || "Unnamed farm"}
          farmId={farm.farm_id}
          avatarFields={farm}
        />
      ) : null}
      {farm && (!overall || hasRecord) ? (
        <FarmResult farm={farm} variant={overall ? "overall" : "event"} />
      ) : null}
    </div>
  );
}
