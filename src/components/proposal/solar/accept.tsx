"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { acceptSolarProposalAction } from "@/server/modules/solar/proposal-sign-action";

export function AcceptForm({ token, onSigned }: { token: string; onSigned: () => void }) {
  const [name, setName] = React.useState("");
  const [agreed, setAgreed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!name.trim()) return toast.error("Please type your full name.");
    if (!agreed) return toast.error("Please confirm you have read the proposal.");
    setBusy(true);
    try {
      const res = await acceptSolarProposalAction(token, name.trim());
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success("Proposal accepted");
      onSigned();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      // Always released, whatever the action did. A busy flag left latched on a
      // throw is a form the customer can no longer submit and cannot see why.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl bg-white p-6 text-neutral-900 shadow-xl sm:p-7">
      <div className="space-y-1.5">
        <label htmlFor="sig" className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">
          Type your full name to accept
        </label>
        <input
          id="sig"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your full name"
          autoComplete="name"
          className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 font-display text-xl outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
        />
      </div>
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-neutral-500">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-neutral-900"
        />
        I have read this proposal and understand the figures are estimates, not a guarantee, and
        that financing is subject to credit approval.
      </label>
      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        Accept this proposal
      </button>
    </div>
  );
}
