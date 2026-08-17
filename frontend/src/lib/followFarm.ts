export type FarmIdentity = {
  farm_id: string;
  name: string;
};

const KEY = "pj007.farmIdentity";
const LEGACY_KEY = "pj007.followFarmId";

function parseIdentity(raw: string | null): FarmIdentity | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FarmIdentity>;
    const farm_id = String(parsed.farm_id || "").trim();
    const name = String(parsed.name || "").trim();
    if (farm_id && name) return { farm_id, name };
    return null;
  } catch {
    return null;
  }
}

export function readFarmIdentity(): FarmIdentity | null {
  try {
    const stored = parseIdentity(localStorage.getItem(KEY));
    if (stored) return stored;
    localStorage.removeItem(LEGACY_KEY);
    return null;
  } catch {
    return null;
  }
}

export function writeFarmIdentity(identity: FarmIdentity): void {
  const farm_id = identity.farm_id.trim();
  const name = identity.name.trim();
  try {
    if (!farm_id || !name) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    localStorage.setItem(KEY, JSON.stringify({ farm_id, name }));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* private mode */
  }
}

export function clearFarmIdentity(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* private mode */
  }
}

export function readFollowedFarm(): string {
  return readFarmIdentity()?.farm_id ?? "";
}

export function writeFollowedFarm(farmId: string, name = ""): void {
  const farm_id = farmId.trim();
  if (!farm_id) {
    clearFarmIdentity();
    return;
  }
  if (!name.trim()) return;
  writeFarmIdentity({ farm_id, name: name.trim() });
}
