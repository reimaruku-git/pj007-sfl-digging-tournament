import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useFarmSession } from "../lib/farmSession";
import { ColorCanvas } from "./ColorCanvas";
import { FarmConnect } from "./FarmConnect";
import { SyncCountdown } from "./SyncCountdown";

export { formatWhen, statusLabel } from "../lib/format";

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith("/admin");
  if (isAdmin) {
    return (
      <div className="shell">
        <AdminHeader />
        {children}
      </div>
    );
  }
  return (
    <div className="app-frame">
      <PublicHeader />
      <div className="shell public-shell">{children}</div>
    </div>
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
      <Link to="/" className="brand">
        <div className="brand-mark" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div>
          <h1>The Dig</h1>
          <p>SFL Tournament</p>
        </div>
      </Link>
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
        {identity ? (
          <div className="connected-chip-wrap" ref={chipRef}>
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
    </header>
  );
}

function navClass(isActive: boolean) {
  return ["site-nav-link", isActive ? "active" : ""].filter(Boolean).join(" ");
}

function AdminHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
    <header className="topbar">
      <Link to="/" className="brand">
        <div className="brand-mark" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div>
          <h1>SFL Digging Tournament</h1>
          <p>3 Otter Pebbles · fewest digs wins</p>
        </div>
      </Link>
      <div className="topbar-tools">
        <SyncCountdown compact />
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
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
