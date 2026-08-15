import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [farmQuery, setFarmQuery] = useState("");
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

  function findFarm(event: FormEvent) {
    event.preventDefault();
    const farmId = farmQuery.trim();
    if (!farmId) return;
    setOpen(false);
    setFarmQuery("");
    navigate(`/farm/${encodeURIComponent(farmId)}`);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <div className="brand-mark" aria-hidden>
            ✿
          </div>
          <div>
            <h1>SFL Digging Tournament</h1>
            <p>3 Otter Pebbles · fewest digs wins</p>
          </div>
        </Link>
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
                Join the tournament
              </button>
              <form className="menu-find" onSubmit={findFarm}>
                <label>
                  Find a farm
                  <input
                    value={farmQuery}
                    onChange={(event) => setFarmQuery(event.target.value)}
                    placeholder="Farm ID"
                    autoComplete="off"
                  />
                </label>
                <button className="btn" type="submit">
                  Go
                </button>
              </form>
            </div>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

export function statusLabel(status: string): string {
  switch (status) {
    case "not_started":
      return "Not started";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "invalidated":
      return "Invalidated";
    case "scheduled":
      return "Scheduled";
    case "active":
      return "Active";
    case "ended":
      return "Ended";
    default:
      return status;
  }
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
