import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type ActivityContextValue = {
  label: string | null;
  setLabel: (label: string | null) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

/** One small activity popup for connect, join, and tournament-detail load. */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const [label, setLabelState] = useState<string | null>(null);
  const setLabel = useCallback((next: string | null) => {
    setLabelState(next);
  }, []);
  const value = useMemo(() => ({ label, setLabel }), [label, setLabel]);
  return (
    <ActivityContext.Provider value={value}>
      {children}
      <LoadingPopup label={label} />
    </ActivityContext.Provider>
  );
}

export function useActivity(): ActivityContextValue {
  const ctx = useContext(ActivityContext);
  if (ctx) return ctx;
  return { label: null, setLabel: () => undefined };
}

export function LoadingPopup({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <div className="loading-popup" data-testid="loading-popup" role="status" aria-live="polite">
      <div className="loading-popup-card">{label}</div>
    </div>
  );
}
