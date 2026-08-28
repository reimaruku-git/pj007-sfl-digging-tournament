import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addSlogan, fetchAdminSlogans, saveSlogans } from "../api/admin";
import type { Slogan } from "../api/public";
import { utcDayKey } from "../lib/slogans";
import { ConfirmDialog, useConfirm } from "./ConfirmDialog";

export function AdminSlogansPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const listed = useQuery({
    queryKey: ["admin-slogans"],
    queryFn: fetchAdminSlogans,
    enabled: open,
  });
  const [drafts, setDrafts] = useState<string[]>([]);
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slogans = listed.data?.slogans ?? [];
  const todayKey = utcDayKey(new Date());
  const pinned =
    listed.data?.today_day === todayKey ? (listed.data.today_text ?? "").trim() : "";

  useEffect(() => {
    if (!open) return;
    setDrafts((listed.data?.slogans ?? []).map((row) => row.text));
  }, [open, listed.data]);

  async function persist(next: Slogan[], todayText: string | null) {
    setBusy(true);
    setError(null);
    try {
      await saveSlogans(next, { today_text: todayText });
      await queryClient.invalidateQueries({ queryKey: ["admin-slogans"] });
      await queryClient.invalidateQueries({ queryKey: ["slogans"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to save slogans");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    const text = newText.trim();
    if (!text) {
      setError("Text is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addSlogan({ text });
      setNewText("");
      await queryClient.invalidateQueries({ queryKey: ["admin-slogans"] });
      await queryClient.invalidateQueries({ queryKey: ["slogans"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add slogan");
    } finally {
      setBusy(false);
    }
  }

  async function onEdit(index: number) {
    const text = (drafts[index] ?? "").trim();
    if (!text || text === slogans[index]?.text) return;
    const next = slogans.map((row, i) => (i === index ? { text } : row));
    const todayText = pinned === slogans[index]?.text ? text : pinned || null;
    await persist(next, todayText);
  }

  function requestDelete(index: number) {
    const row = slogans[index];
    if (!row) return;
    confirm.ask("Are you sure to do this?", `Delete “${row.text}”?`, () => {
      const next = slogans.filter((_, i) => i !== index);
      const todayText = pinned === row.text ? null : pinned || null;
      return persist(next, todayText);
    });
  }

  async function onShowToday(text: string) {
    await persist(slogans, text);
  }

  if (!open) return null;

  return (
    <div className="create-overlay" data-testid="admin-slogans-panel" role="dialog" aria-modal="true">
      <div className="create-window">
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <div>
            <div className="kicker">Header slogans</div>
            <p className="meta">
              Edit the full line (put emoji in the text). The public header still rotates by UTC
              day; pick one to pin today.
            </p>
          </div>
          <button className="btn ghost" type="button" data-testid="admin-slogans-close" onClick={onClose}>
            Close
          </button>
        </div>
        {listed.isLoading && <p className="muted">Loading slogans…</p>}
        {error && <div className="flash err">{error}</div>}
        <ul className="slogan-editor-list" data-testid="admin-slogan-list">
          {drafts.map((text, index) => (
            <li key={`${slogans[index]?.text ?? "new"}-${index}`} className="slogan-editor-row">
              <input
                value={text}
                maxLength={80}
                aria-label={`Slogan ${index + 1}`}
                data-testid={`admin-slogan-edit-${index}`}
                onChange={(event) => {
                  const value = event.target.value;
                  setDrafts((current) => current.map((row, i) => (i === index ? value : row)));
                }}
              />
              <button
                className="btn"
                type="button"
                disabled={busy || !slogans[index]}
                data-testid={`admin-slogan-save-${index}`}
                onClick={() => void onEdit(index)}
              >
                Save
              </button>
              <button
                className={`btn${pinned === slogans[index]?.text ? " primary" : ""}`}
                type="button"
                disabled={busy || !slogans[index]}
                data-testid={`admin-slogan-today-${index}`}
                onClick={() => void onShowToday(slogans[index].text)}
              >
                {pinned === slogans[index]?.text ? "Today" : "Show today"}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy}
                data-testid={`admin-slogan-delete-${index}`}
                onClick={() => requestDelete(index)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        {!listed.isLoading && drafts.length === 0 && <p className="muted">None yet.</p>}
        <form className="form-grid" onSubmit={(event) => void onAdd(event)}>
          <label>
            New text
            <input
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              maxLength={80}
              data-testid="admin-slogan-text"
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy} data-testid="admin-slogan-add">
            {busy ? "Saving…" : "Add slogan"}
          </button>
        </form>
      </div>
      <ConfirmDialog pending={confirm.pending} onYes={() => void confirm.accept()} onNo={confirm.cancel} />
    </div>
  );
}
