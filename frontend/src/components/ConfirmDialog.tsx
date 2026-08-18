import { useState } from "react";

export type ConfirmAsk = {
  title: string;
  message: string;
  run: () => void | Promise<void>;
};

export function useConfirm() {
  const [pending, setPending] = useState<ConfirmAsk | null>(null);

  function ask(title: string, message: string, run: () => void | Promise<void>) {
    setPending({ title, message, run });
  }

  function cancel() {
    setPending(null);
  }

  async function accept() {
    const next = pending;
    setPending(null);
    if (next) await next.run();
  }

  return { pending, ask, cancel, accept };
}

export function ConfirmDialog({
  pending,
  onYes,
  onNo,
}: {
  pending: ConfirmAsk | null;
  onYes: () => void;
  onNo: () => void;
}) {
  if (!pending) return null;
  return (
    <div className="confirm-overlay" data-testid="confirm-dialog" role="dialog" aria-modal="true">
      <div className="confirm-card">
        <p className="confirm-title">{pending.title}</p>
        <p className="confirm-message">{pending.message}</p>
        <div className="toolbar confirm-actions">
          <button className="btn" type="button" data-testid="confirm-no" onClick={onNo}>
            No
          </button>
          <button className="btn primary" type="button" data-testid="confirm-yes" onClick={onYes}>
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}
