import { FormEvent, useState } from "react";
import type { Slogan } from "../api/public";
import { sloganGlyph } from "../lib/slogans";

const ICON_CHOICES = [
  { value: "hand", label: "hand" },
  { value: "banana", label: "banana" },
  { value: "orange", label: "orange" },
  { value: "poop", label: "poop" },
  { value: "smiley", label: "greening smiley" },
  { value: "statue", label: "statue" },
];

export function AdminSlogans({
  slogans,
  loading,
  onAdd,
}: {
  slogans: Slogan[];
  loading?: boolean;
  onAdd: (input: { text: string; icon: string }) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [icon, setIcon] = useState("hand");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const nextText = text.trim();
    if (!nextText) {
      setError("Text is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAdd({ text: nextText, icon });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add slogan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ marginBottom: 16 }} data-testid="admin-slogans">
      <div className="kicker">Header slogans</div>
      <p className="meta">
        Public header picks one line per UTC day, in this order, then starts over. New texts are
        appended.
      </p>
      {loading && <p className="muted">Loading slogans…</p>}
      {!loading && slogans.length === 0 && <p className="muted">None yet.</p>}
      <ol className="slogan-admin-list" data-testid="admin-slogan-list">
        {slogans.map((row, index) => (
          <li key={`${row.text}-${index}`}>
            {row.text}
            {row.icon ? ` ${sloganGlyph(row.icon)}` : ""}
          </li>
        ))}
      </ol>
      {error && <div className="flash err">{error}</div>}
      <form className="form-grid" onSubmit={(event) => void onSubmit(event)}>
        <label>
          New text
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={80}
            required
            data-testid="admin-slogan-text"
          />
        </label>
        <label>
          Icon
          <select
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            data-testid="admin-slogan-icon"
          >
            {ICON_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label} {sloganGlyph(choice.value)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={busy} data-testid="admin-slogan-add">
          {busy ? "Adding…" : "Add slogan"}
        </button>
      </form>
    </section>
  );
}
