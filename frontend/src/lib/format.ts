export function statusLabel(status: string): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "invalidated":
      return "Invalidated";
    case "scheduled":
      return "Scheduled";
    case "active":
      return "Active";
    case "ended":
      return "Ended";
    default:
      return status;
  }
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatWhenUtc(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const day = date.getUTCDate();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${hours}:${minutes} UTC`;
}

export function formatRelative(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const delta = now.getTime() - date.getTime();
  if (delta < 0) return formatWhenUtc(value);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(Number(score))) return "—";
  return Number(score).toFixed(2);
}

export function formatUtcClock(now: Date = new Date()): string {
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}
