import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchFarm, fetchFarmProfile } from "../api/public";
import { DetailBackLink } from "../components/DetailBackLink";
import { FarmResult, FarmResultFallback } from "../components/FarmResult";
import { profileBackTarget } from "../lib/backTarget";
import { useFarmSession } from "../lib/farmSession";

type ProfileLocationState = {
  from?: string;
};

export function ProfilePage() {
  const { identity } = useFarmSession();
  const farmId = identity?.farm_id ?? "";
  const location = useLocation();
  const from = (location.state as ProfileLocationState | null)?.from;
  const back = profileBackTarget(from);

  const profileQuery = useQuery({
    queryKey: ["profile", farmId],
    queryFn: () => fetchFarmProfile(farmId),
    enabled: Boolean(farmId),
  });
  const farmQuery = useQuery({
    queryKey: ["farm", farmId],
    queryFn: () => fetchFarm(farmId),
    enabled: Boolean(farmId),
    retry: false,
  });

  if (!identity) {
    return <Navigate to="/" replace />;
  }

  const farm = farmQuery.data;
  const profile = profileQuery.data;
  const pictureState = { from };

  return (
    <div className="card farm-sheet" data-testid="profile-page">
      <div className="kicker">Personal result</div>
      <div className="detail-chrome">
        <DetailBackLink to={back.to} label={back.label} />
      </div>
      {farmQuery.isLoading && (
        <div className="skeleton-stack" aria-hidden>
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}
      {farm ? (
        <FarmResult
          farm={farm}
          avatarTo="/profile/picture"
          avatarState={pictureState}
          shareUrl={
            typeof window !== "undefined"
              ? `${window.location.origin}/farm/${encodeURIComponent(farm.farm_id)}`
              : `/farm/${farm.farm_id}`
          }
        />
      ) : farmQuery.isError ? (
        <FarmResultFallback
          name={profile?.name || identity.name}
          farmId={identity.farm_id}
          avatarFields={profile}
          avatarTo="/profile/picture"
          avatarState={pictureState}
        />
      ) : null}
    </div>
  );
}
