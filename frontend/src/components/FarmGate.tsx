import { FormEvent, useState } from "react";
import { Outlet } from "react-router-dom";
import { identifyFarm } from "../api/public";
import { useFarmSession } from "../lib/farmSession";

export function FarmGate() {
  const { identity, setIdentity } = useFarmSession();
  if (!identity) {
    return <IdentifyForm onIdentified={setIdentity} />;
  }
  return <Outlet />;
}

function IdentifyForm({
  onIdentified,
}: {
  onIdentified: (identity: { farm_id: string; name: string }) => void;
}) {
  const [farmId, setFarmId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const identity = await identifyFarm(farmId.trim());
      onIdentified({ farm_id: identity.farm_id, name: identity.name });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card login" data-testid="farm-id-gate">
      <div className="kicker">Farm login</div>
      <h2>Enter your Farm ID</h2>
      <p className="meta">
        That ID is how you browse the site. We look up your Sunflower Land farm name and remember
        both in this browser.
      </p>
      {error && <div className="flash err">{error}</div>}
      <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
        <label>
          Farm ID
          <input
            className="search"
            value={farmId}
            onChange={(event) => setFarmId(event.target.value)}
            placeholder="Farm ID"
            autoComplete="off"
            required
            data-testid="farm-id-input"
          />
        </label>
        <button className="btn primary" type="submit" disabled={busy} data-testid="farm-id-submit">
          {busy ? "Looking up…" : "Continue"}
        </button>
      </form>
    </section>
  );
}
