import { useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFarmSession } from "../lib/farmSession";
import { SyncCountdown } from "./SyncCountdown";

export { formatWhen, statusLabel } from "../lib/format";

export function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { identity, disconnect } = useFarmSession();

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

  function goJoin() {
    setOpen(false);
    navigate("/");
    window.requestAnimationFrame(() => {
      document.getElementById("join")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  function goRules() {
    setOpen(false);
    navigate("/");
    window.requestAnimationFrame(() => {
      document.getElementById("rules")?.scrollIntoView({ behavior: "smooth" });
    });
  }

  function onDisconnect() {
    disconnect();
    setOpen(false);
    navigate("/");
  }

  return (
    <div className="shell">
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
              <div className="menu-panel" id={menuId} role="menu">
                <button type="button" role="menuitem" onClick={goRules}>
                  Rules
                </button>
                <button type="button" role="menuitem" onClick={goJoin}>
                  Join a tournament
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
                {identity && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="disconnect-farm"
                    onClick={onDisconnect}
                  >
                    Disconnect {identity.name}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
