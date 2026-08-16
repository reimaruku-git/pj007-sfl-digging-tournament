import { useEffect, useState } from "react";
import { formatCountdown, nextSyncAt } from "../lib/schedule";
import { formatUtcClock } from "../lib/format";

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SyncCountdown({
  compact = false,
  variant = "block",
}: {
  compact?: boolean;
  variant?: "block" | "chip" | "card";
}) {
  const now = useNow(1000);
  const next = nextSyncAt(now);
  const label = formatCountdown(next.getTime() - now.getTime());
  const hour = String(next.getUTCHours()).padStart(2, "0");
  const mode = compact ? "chip" : variant;

  if (mode === "card") {
    return (
      <div
        className="tourney-next"
        data-testid="tourney-next-refresh"
        title={`Next score refresh ${hour}:00 UTC`}
      >
        <span>Next refresh</span>
        <b>{label}</b>
      </div>
    );
  }

  if (mode === "chip") {
    return (
      <div className="utc-chip" title={`Next score refresh ${hour}:00 UTC`}>
        <span className="utc-clock">{formatUtcClock(now)}</span>
        <span className="utc-next">next {label}</span>
      </div>
    );
  }

  return (
    <div className="stat">
      <span className="muted">Next refresh</span>
      <b>
        {label}
        <span className="stat-sub">{hour}:00 UTC</span>
      </b>
    </div>
  );
}
