const KEY = "pj007.followFarmId";

export function readFollowedFarm(): string {
  try {
    return (localStorage.getItem(KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writeFollowedFarm(farmId: string): void {
  const value = farmId.trim();
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
