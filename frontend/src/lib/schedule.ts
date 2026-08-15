/** Full-sweep hours in UTC. 23:00 is the last counted sync of that UTC day. */
export const SYNC_HOURS_UTC = [14, 16, 18, 20, 23] as const;

export function nextSyncAt(now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  for (const hour of SYNC_HOURS_UTC) {
    const slot = new Date(Date.UTC(year, month, day, hour, 0, 0, 0));
    if (slot.getTime() > now.getTime()) return slot;
  }
  return new Date(Date.UTC(year, month, day + 1, SYNC_HOURS_UTC[0], 0, 0, 0));
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function msUntilNextSync(now: Date = new Date()): number {
  return nextSyncAt(now).getTime() - now.getTime();
}
