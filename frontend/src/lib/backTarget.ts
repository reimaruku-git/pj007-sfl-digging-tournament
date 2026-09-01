export type BackTarget = {
  to: string;
  label: string;
};

export function farmBackTarget(tournamentId?: string | null): BackTarget {
  if (tournamentId) {
    return {
      to: `/tournaments/${encodeURIComponent(tournamentId)}`,
      label: "Back to tournament",
    };
  }
  return { to: "/", label: "Back to home" };
}

export function tournamentBackTarget(from?: string | null): BackTarget {
  if (from === "tournaments") {
    return { to: "/tournaments", label: "Back to tournaments" };
  }
  return { to: "/", label: "Back to home" };
}

export function profileBackTarget(fromPath?: string | null): BackTarget {
  const match = String(fromPath || "").match(/^\/tournaments\/([^/]+)/);
  if (match) {
    return { to: `/tournaments/${encodeURIComponent(match[1])}`, label: "Back" };
  }
  return { to: "/", label: "Back" };
}
