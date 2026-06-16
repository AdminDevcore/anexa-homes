"use client";

import * as React from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";
import { confirmWelcomeCallAction } from "@/server/modules/welcome-call/actions";
import { CALL_KIND_LABELS, type CallKind } from "@/server/modules/welcome-call/types";

type Item = { id: string; title: string; body: string };
type Snapshot = { intro: string; closing: string; items: Item[] };

export function WelcomeCallExperience({
  token,
  customerName,
  kind,
  snapshot,
  initialAcked,
}: {
  token: string;
  customerName: string;
  kind: CallKind;
  snapshot: Snapshot;
  initialAcked: string[];
}) {
  const firstName = customerName.split(" ")[0] || "there";
  const heading = kind === "completion" ? `Thank you, ${firstName}!` : `Welcome, ${firstName}!`;
  const [checked, setChecked] = React.useState<Set<string>>(new Set(initialAcked));
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const allChecked = snapshot.items.every((it) => checked.has(it.id));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (!allChecked) return toast.error("Please check each item to confirm it's correct.");
    setSubmitting(true);
    const res = await confirmWelcomeCallAction(token, [...checked]);
    setSubmitting(false);
    if (!res.ok) return toast.error(res.error);
    setDone(true);
  }

  if (done) {
    return (
      <div className="flex min-h-screen flex-col bg-[#f6f3ee]">
        <header className="border-b border-border bg-white px-6 py-4"><Logo /></header>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <CheckCircle2 className="size-16 text-emerald-600" />
            <h1 className="font-display text-3xl font-semibold">All set — thank you!</h1>
            <p className="text-neutral-600">{snapshot.closing || "You've confirmed your project details. We'll be in touch shortly."}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f3ee] text-neutral-900">
      <header className="border-b border-border bg-white px-6 py-4"><Logo /></header>

      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gold-muted">{CALL_KIND_LABELS[kind]}</p>
        <h1 className="mt-3 font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {heading}
        </h1>
        {snapshot.intro && <p className="mt-4 text-lg leading-relaxed text-neutral-700">{snapshot.intro}</p>}
        <p className="mt-4 text-sm text-neutral-500">Please review each item below and check it to confirm it&apos;s correct.</p>

        <div className="mt-8 space-y-3">
          {snapshot.items.map((it, i) => {
            const on = checked.has(it.id);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => toggle(it.id)}
                className={`flex w-full items-start gap-4 rounded-2xl border bg-white p-5 text-left transition-all ${on ? "border-emerald-400 ring-1 ring-emerald-200" : "border-neutral-200 hover:border-gold/40"}`}
              >
                <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${on ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-300 text-transparent"}`}>
                  <CheckCircle2 className="size-4" />
                </span>
                <span className="min-w-0">
                  {it.title && <span className="block font-semibold">{i + 1}. {it.title}</span>}
                  {it.body && <span className="mt-1 block leading-relaxed text-neutral-700">{it.body}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="sticky bottom-0 mt-8 -mx-5 border-t border-neutral-200 bg-[#f6f3ee]/90 px-5 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:bg-white sm:px-6">
          <Button
            onClick={confirm}
            disabled={!allChecked || submitting}
            className="w-full bg-gold py-6 text-base text-gold-foreground hover:bg-gold/90"
          >
            {submitting ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />}
            I confirm everything is correct
          </Button>
          {!allChecked && <p className="mt-2 text-center text-xs text-neutral-500">Check all {snapshot.items.length} items above to continue.</p>}
        </div>
      </div>
    </div>
  );
}
