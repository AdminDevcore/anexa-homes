"use client";

import * as React from "react";
import { Check, Loader2, Printer } from "lucide-react";
import { signCashBidAction } from "@/server/modules/cashbid/actions";
import type { PublicCashBid } from "@/server/modules/cashbid/queries";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function CashBidSignature({ bid }: { bid: PublicCashBid }) {
  const [signed, setSigned] = React.useState(bid.status === "signed");
  const [signerName, setSignerName] = React.useState(bid.signerName ?? "");
  const [signedAt, setSignedAt] = React.useState(bid.signedAt);
  const [name, setName] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function sign() {
    setErr("");
    if (name.trim().length < 2) return setErr("Please type your full name.");
    if (!agree) return setErr("Please check the box to accept.");
    setBusy(true);
    const res = await signCashBidAction({ token: bid.token, signerName: name.trim() });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setSignerName(name.trim());
    setSignedAt(new Date().toISOString());
    setSigned(true);
  }

  if (signed) {
    return (
      <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-5 print:border-neutral-300 print:bg-white">
        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 print:text-neutral-900">
          <Check className="size-4" /> Accepted
        </div>
        <p className="mt-1 text-sm text-neutral-700">
          Signed by <span className="font-semibold">{signerName || "the homeowner"}</span>
          {signedAt ? ` on ${fmtDate(signedAt)}` : ""}.
        </p>
        <button
          type="button"
          onClick={() => window.print()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 print:hidden"
        >
          <Printer className="size-4" /> Print / Save PDF
        </button>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-xl border border-neutral-200 p-5 print:hidden">
      <h2 className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">Signature</h2>
      <label className="mt-3 flex items-start gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 size-4" />
        <span>
          I, <span className="font-semibold">{name.trim() || "the homeowner"}</span>, accept this agreement and authorize{" "}
          {bid.company.name} to perform the work described above under the terms, warranty, and payment schedule shown.
        </span>
      </label>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="text-xs font-medium text-neutral-500">Full legal name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Homeowner"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={sign}
          disabled={busy}
          style={{ backgroundColor: bid.company.primaryColor }}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} {busy ? "Signing…" : "Sign & Accept"}
        </button>
      </div>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <p className="mt-3 text-xs text-neutral-400">
        By signing, you agree this is a binding agreement and that your typed name is your electronic signature.
      </p>
    </section>
  );
}
