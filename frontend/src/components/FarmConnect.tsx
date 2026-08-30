import { FormEvent, useState } from "react";
import { identifyFarm } from "../api/public";
import { useFarmSession } from "../lib/farmSession";
import { useActivity } from "./LoadingPopup";

export function FarmConnect() {
  const { identity, setIdentity } = useFarmSession();
  const { setLabel } = useActivity();
  const [farmId, setFarmId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (identity) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    setLabel("Connecting farm…");
    try {
      const next = await identifyFarm(farmId.trim());
      setIdentity({ farm_id: next.farm_id, name: next.name });
      setFarmId("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLabel(null);
    }
  }

  return (
    <div className="farm-connect-wrap">
      <form
        className="farm-connect"
        data-testid="farm-connect"
        onSubmit={(event) => void onSubmit(event)}
      >
        <input
          className="farm-connect-input"
          value={farmId}
          onChange={(event) => setFarmId(event.target.value)}
          placeholder="Farm ID"
          aria-label="Farm ID"
          autoComplete="off"
          required
          data-testid="farm-id-input"
        />
        <button
          className="btn primary farm-connect-btn"
          type="submit"
          disabled={busy}
          data-testid="farm-id-submit"
        >
          {busy ? "…" : "Connect"}
        </button>
      </form>
      {error && (
        <p className="farm-connect-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
