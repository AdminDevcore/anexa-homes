"use client";

import * as React from "react";
import { requestChangesAction, askQuestionAction } from "@/server/modules/proposals/actions";

type Mode = "public" | "preview";

export function NextStepActions({ token, mode, signUrl }: { token: string; mode: Mode; signUrl: string | null }) {
  const [open, setOpen] = React.useState<null | "changes" | "question">(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  const disabled = mode === "preview";

  async function submit() {
    if (!message.trim() || disabled) return;
    setBusy(true);
    const fn = open === "changes" ? requestChangesAction : askQuestionAction;
    const res = await fn({ token, message });
    setBusy(false);
    if (res.ok) {
      setDone(open === "changes" ? "Your change request was sent to your rep." : "Your question was sent to your rep.");
      setOpen(null);
      setMessage("");
    } else {
      setDone(res.error);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 print:hidden">
      {signUrl ? (
        <a
          href={disabled ? undefined : signUrl}
          className="rounded-xl bg-[var(--proposal-accent)] px-6 py-4 text-center text-base font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          Review &amp; Sign Documents
        </a>
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-4 text-center text-sm text-neutral-500">
          Your documents will be sent by your rep for signing.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => { setOpen(open === "changes" ? null : "changes"); setDone(null); }}
          className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50"
        >
          Request Changes
        </button>
        <button
          type="button"
          onClick={() => { setOpen(open === "question" ? null : "question"); setDone(null); }}
          className="rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50"
        >
          Ask a Question
        </button>
      </div>

      {open && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            autoFocus
            placeholder={open === "changes" ? "What would you like changed?" : "What would you like to ask?"}
            className="w-full resize-none rounded-lg border border-neutral-300 p-2 text-sm outline-none focus:border-neutral-500"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(null)} className="px-3 py-1.5 text-sm text-neutral-500">Cancel</button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !message.trim() || disabled}
              className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : disabled ? "Preview only" : "Send"}
            </button>
          </div>
        </div>
      )}

      {done && <p className="text-center text-sm text-emerald-600">{done}</p>}
    </div>
  );
}
