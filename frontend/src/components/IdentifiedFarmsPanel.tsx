import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listIdentities, type IdentifiedFarm } from "../api/admin";

/** Matching name or id rows first; everyone else stays below. */
export function rankIdentitiesBySearch(items: IdentifiedFarm[], query: string): IdentifiedFarm[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  const matches: IdentifiedFarm[] = [];
  const rest: IdentifiedFarm[] = [];
  for (const item of items) {
    const name = (item.name || "").toLowerCase();
    const id = item.farm_id.toLowerCase();
    if (name.includes(needle) || id.includes(needle)) matches.push(item);
    else rest.push(item);
  }
  return [...matches, ...rest];
}

export function IdentifiedFarmsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const listed = useQuery({
    queryKey: ["admin-identities"],
    queryFn: listIdentities,
    enabled: open,
  });
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => rankIdentitiesBySearch(listed.data ?? [], query),
    [listed.data, query],
  );

  if (!open) return null;

  return (
    <div
      className="create-overlay"
      data-testid="identified-farms-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="create-window identified-farms-window">
        <div className="identified-farms-head">
          <div className="kicker">Identified farms</div>
          <input
            className="identified-farms-search"
            data-testid="identified-farms-search"
            placeholder="Search name or ID"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search identified farms"
          />
          <button className="btn ghost" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {listed.isLoading && <p className="muted">Loading farms…</p>}
        {!listed.isLoading && rows.length === 0 && <p className="muted">None yet.</p>}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="identified-farms-table" data-testid="identified-farms-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.farm_id} data-testid={`identified-farm-${item.farm_id}`}>
                    <td>{item.name || "Unnamed"}</td>
                    <td className="farm-id">{item.farm_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
