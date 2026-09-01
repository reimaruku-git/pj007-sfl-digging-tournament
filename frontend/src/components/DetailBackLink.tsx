import { Link } from "react-router-dom";

export function DetailBackLink({
  to,
  label,
  state,
}: {
  to: string;
  label: string;
  state?: unknown;
}) {
  return (
    <Link to={to} state={state} className="detail-crumb" data-testid="back-link">
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
      {label}
    </Link>
  );
}
