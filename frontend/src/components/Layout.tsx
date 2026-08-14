import { NavLink } from "react-router-dom";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <div className="brand-mark" aria-hidden>
            ✿
          </div>
          <div>
            <h1>SFL Digging Tournament</h1>
            <p>3 Otter Pebbles · fewest digs wins</p>
          </div>
        </NavLink>
        <nav className="nav">
          <NavLink to="/" end>
            Leaderboard
          </NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
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
