import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { fetchSlogans } from "../api/public";
import { useFarmSession } from "../lib/farmSession";
import {
  copyText,
  DONATION_WALLET,
  OPERATOR_FARM_NAME,
  OPERATOR_FARM_URL,
  OPERATOR_X_URL,
  truncatedDonationWallet,
} from "../lib/operator";
import { pickDailySlogan, SEED_SLOGANS, todayPickFrom } from "../lib/slogans";
import { SITE_VERSION } from "../siteVersion";
import { AdminSlogansPanel } from "./AdminSlogansPanel";
import { ColorCanvas } from "./ColorCanvas";
import { FarmConnect } from "./FarmConnect";
import { IdentifiedFarmsPanel } from "./IdentifiedFarmsPanel";
import { SyncCountdown } from "./SyncCountdown";

export { formatWhen, statusLabel } from "../lib/format";

type AdminHeaderActions = {
  onSignOut?: () => void;
};

type AdminHeaderActionsContextValue = {
  actions: AdminHeaderActions;
  setActions: (next: AdminHeaderActions) => void;
};

const AdminHeaderActionsContext = createContext<AdminHeaderActionsContextValue | null>(null);

/** Let the authed admin dashboard park Sign out in the burger menu. */
export function useAdminHeaderActions(actions: AdminHeaderActions) {
  const ctx = useContext(AdminHeaderActionsContext);
  const setActions = ctx?.setActions;
  const onSignOut = actions.onSignOut;
  useEffect(() => {
    if (!setActions) return;
    setActions({ onSignOut });
    return () => setActions({});
  }, [setActions, onSignOut]);
}

function AdminHeaderActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<AdminHeaderActions>({});
  const setActions = useCallback((next: AdminHeaderActions) => {
    setActionsState((prev) => (prev.onSignOut === next.onSignOut ? prev : next));
  }, []);
  const value = useMemo(() => ({ actions, setActions }), [actions, setActions]);
  return (
    <AdminHeaderActionsContext.Provider value={value}>
      {children}
    </AdminHeaderActionsContext.Provider>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  if (isAdmin) {
    return (
      <AdminHeaderActionsProvider>
        <div className="app-frame admin-frame">
          <AdminHeader />
          <div className="shell">{children}</div>
          <PublicFooter />
        </div>
      </AdminHeaderActionsProvider>
    );
  }
  return (
    <div className="app-frame">
      <PublicHeader />
      <div className="shell public-shell">{children}</div>
      <PublicFooter />
    </div>
  );
}

function SiteBrand({ testId }: { testId: string }) {
  return (
    <Link to="/" className="brand" data-testid={testId}>
      <div className="brand-mark" aria-hidden>
        <img src="/shovel.png" alt="" />
      </div>
      <div>
        <h1>Bumpkin Clash: Digging</h1>
        <p>Sunflower Land Digging Tournament</p>
      </div>
    </Link>
  );
}

function PublicHeader() {
  const [chipOpen, setChipOpen] = useState(false);
  const chipRef = useRef<HTMLDivElement>(null);
  const { identity, disconnect } = useFarmSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!chipOpen) return;
    function onPointer(event: MouseEvent) {
      if (chipRef.current && !chipRef.current.contains(event.target as Node)) {
        setChipOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setChipOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [chipOpen]);

  function onDisconnect() {
    disconnect();
    setChipOpen(false);
    navigate("/");
  }

  return (
    <header className="topbar public-topbar">
      <SiteBrand testId="public-brand" />
      <nav className="site-nav" data-testid="public-nav" aria-label="Primary">
        <NavLink to="/" end className={({ isActive }) => navClass(isActive)} data-testid="nav-live">
          Live
        </NavLink>
        <NavLink
          to="/tournaments"
          className={({ isActive }) => navClass(isActive)}
          data-testid="nav-tournaments"
        >
          Tournaments
        </NavLink>
      </nav>
      <div className="topbar-tools">
        <CreatorChip />
        <div className="topbar-session" ref={chipRef}>
          {identity ? (
            <div className="connected-chip-wrap">
              <button
                type="button"
                className="connected-chip"
                data-testid="farm-connected"
                aria-expanded={chipOpen}
                onClick={() => setChipOpen((value) => !value)}
              >
                <ColorCanvas tone="avatar" className="connected-avatar" />
                <span className="connected-copy">
                  <span className="farm-connected-kicker">Connected</span>
                  <span className="farm-connected-name">{identity.name}</span>
                </span>
              </button>
              {chipOpen && (
                <div className="connected-menu" data-testid="menu-options">
                  <Link to={`/farm/${identity.farm_id}`} onClick={() => setChipOpen(false)}>
                    View farm
                  </Link>
                  <button type="button" data-testid="disconnect-farm" onClick={onDisconnect}>
                    Disconnect {identity.name}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <FarmConnect />
          )}
        </div>
      </div>
    </header>
  );
}

function CreatorChip() {
  const slogansQuery = useQuery({
    queryKey: ["slogans"],
    queryFn: fetchSlogans,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const slogans = slogansQuery.data?.slogans?.length ? slogansQuery.data.slogans : SEED_SLOGANS;
  const slogan =
    pickDailySlogan(slogans, new Date(), todayPickFrom(slogansQuery.data)) ?? SEED_SLOGANS[0];

  return (
    <div className="creator-chip" data-testid="creator-chip">
      <p className="daily-slogan" data-testid="daily-slogan">
        <span>
          {slogan.text}
          {": "}
        </span>
        <a
          className="operator-farm-link"
          href={OPERATOR_FARM_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="operator-farm-link"
        >
          {OPERATOR_FARM_NAME}
        </a>
      </p>
      <p className="created-by" data-testid="created-by">
        Created by <strong>{OPERATOR_FARM_NAME}</strong>
        <a
          className="x-link"
          href={OPERATOR_X_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={`${OPERATOR_FARM_NAME} on X`}
          data-testid="operator-x-link"
        >
          <XLogo />
        </a>
      </p>
    </div>
  );
}

function PublicFooter() {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyText(DONATION_WALLET);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <footer className="public-footer" data-testid="public-footer">
      <div className="public-footer-inner">
        <p data-testid="public-disclaimer">
          This is an unofficial, third-party site. It is not affiliated with, endorsed by, or
          operated by the official Sunflower Land team.
        </p>
        <div className="public-footer-support" data-testid="public-footer-support">
          <p className="donation-line" data-testid="donation-wallet">
            <strong className="donation-label">Support the tournaments:</strong>{" "}
            <span className="donation-wallet-short" data-testid="donation-wallet-short">
              {truncatedDonationWallet()}
            </span>
            <button
              type="button"
              className={`copy-wallet${copied ? " copied" : ""}`}
              aria-label={copied ? "Wallet address copied" : "Copy wallet address"}
              title={copied ? "Copied" : "Copy address"}
              data-testid="copy-wallet"
              onClick={() => void onCopy()}
            >
              <CopyIcon />
            </button>
          </p>
          <p className="site-version" data-testid="site-version">
            v{SITE_VERSION}
          </p>
        </div>
      </div>
    </footer>
  );
}

function XLogo() {
  return (
    <svg className="x-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="copy-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="8"
        y="8"
        width="12"
        height="14"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function navClass(isActive: boolean) {
  return ["site-nav-link", isActive ? "active" : ""].filter(Boolean).join(" ");
}

function AdminHeader() {
  const [open, setOpen] = useState(false);
  const [slogansOpen, setSlogansOpen] = useState(false);
  const [identitiesOpen, setIdentitiesOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const actionsCtx = useContext(AdminHeaderActionsContext);
  const onSignOut = actionsCtx?.actions.onSignOut;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="topbar admin-topbar" data-testid="admin-topbar">
      <SiteBrand testId="admin-brand" />
      <div className="admin-topbar-timer" data-testid="admin-next-refresh">
        <SyncCountdown compact />
      </div>
      <div className="topbar-tools">
        <div className="menu-wrap" ref={rootRef}>
          <button
            type="button"
            className="burger"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden />
            <span aria-hidden />
            <span aria-hidden />
          </button>
          {open && (
            <div className="menu-panel" id={menuId}>
              <div className="menu-options" role="menu" data-testid="menu-options">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate("/");
                  }}
                >
                  Live
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    navigate("/tournaments");
                  }}
                >
                  Tournaments
                </button>
                {onSignOut ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="admin-menu-identities"
                    onClick={() => {
                      setOpen(false);
                      setIdentitiesOpen(true);
                    }}
                  >
                    Identified farms
                  </button>
                ) : null}
                {onSignOut ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="admin-menu-slogans"
                    onClick={() => {
                      setOpen(false);
                      setSlogansOpen(true);
                    }}
                  >
                    Header slogans
                  </button>
                ) : null}
                {onSignOut ? (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="admin-sign-out"
                    onClick={() => {
                      setOpen(false);
                      onSignOut();
                    }}
                  >
                    Sign out
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
      {onSignOut ? (
        <AdminSlogansPanel open={slogansOpen} onClose={() => setSlogansOpen(false)} />
      ) : null}
      {onSignOut ? (
        <IdentifiedFarmsPanel open={identitiesOpen} onClose={() => setIdentitiesOpen(false)} />
      ) : null}
    </header>
  );
}
