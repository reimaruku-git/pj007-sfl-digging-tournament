import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ActivityProvider } from "../components/LoadingPopup";
import {
  clearFarmIdentity,
  readFarmIdentity,
  writeFarmIdentity,
  type FarmIdentity,
} from "./followFarm";

type FarmSessionValue = {
  identity: FarmIdentity | null;
  setIdentity: (identity: FarmIdentity) => void;
  disconnect: () => void;
};

const FarmSessionContext = createContext<FarmSessionValue | null>(null);

export function FarmSessionProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentityState] = useState<FarmIdentity | null>(() => readFarmIdentity());

  const setIdentity = useCallback((next: FarmIdentity) => {
    writeFarmIdentity(next);
    setIdentityState(next);
  }, []);

  const disconnect = useCallback(() => {
    clearFarmIdentity();
    setIdentityState(null);
  }, []);

  const value = useMemo(
    () => ({ identity, setIdentity, disconnect }),
    [identity, setIdentity, disconnect],
  );

  return (
    <FarmSessionContext.Provider value={value}>
      <ActivityProvider>{children}</ActivityProvider>
    </FarmSessionContext.Provider>
  );
}

export function useFarmSession(): FarmSessionValue {
  const ctx = useContext(FarmSessionContext);
  if (!ctx) {
    return {
      identity: readFarmIdentity(),
      setIdentity: writeFarmIdentity,
      disconnect: clearFarmIdentity,
    };
  }
  return ctx;
}
