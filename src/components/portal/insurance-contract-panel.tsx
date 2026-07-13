"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck, Copy, Trash2, ExternalLink, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createCashBidAction, deleteCashBidAction } from "@/server/modules/cashbid/actions";
import type { CashBidRow } from "@/server/modules/cashbid/queries";

const usd = (dollars: number) => `$${(Math.round(dollars * 100) / 100).toLocaleString()}`;

/** Prefilled from the deal's saved claim (all editable). */
export type ClaimPrefill = {
  carrier: string;
  claimNumber: string;
  deductibleDollars: string;
};

export function InsuranceContractButton({
  leadId,
  bids,
  prefill,
}: {
  leadId: string;
  bids: CashBidRow[];
  prefill: ClaimPrefill;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [desc, setDesc] = React.useState("");
  const [carrier, setCarrier] = React.useState(prefill.carrier);
  const [claimNumber, setClaimNumber] = React.useState(prefill.claimNumber);
  const [deductible, setDeductible] = React.useState(prefill.deductibleDollars);
  const [workYears, setWorkYears] = React.useState("5");
  const [mfrYears, setMfrYears] = React.useState("30");
  const [physical, setPhysical] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function create() {
    if (desc.trim().length < 3) return toast.error("Add a short description of the approved scope of work.");
    const deductibleCents = Math.round((parseFloat(deductible || "0") || 0) * 100);
    setBusy(true);
    const res = await createCashBidAction({
      leadId,
      kind: "insurance",
      workDescription: desc.trim(),
      deductibleCents,
      carrier: carrier.trim() || null,
      claimNumber: claimNumber.trim() || null,
      warrantyWorkmanshipYears: Math.max(0, parseInt(workYears || "5", 10) || 0),
      warrantyManufacturerYears: Math.max(0, parseInt(mfrYears || "30", 10) || 0),
      signatureMode: physical ? "physical" : "digital",
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Insurance contract created — copy the link to send it.");
    setDesc("");
    setPhysical(false);
    router.refresh();
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(`${origin}/bid/${token}`);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy — long-press the Open link instead.");
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this contract?")) return;
    const res = await deleteCashBidAction(id);
    if (!res.ok) return toast.error(res.error);
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <ShieldCheck className="size-4" /> Insurance Contract
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Insurance Contract</DialogTitle>
        </DialogHeader>

        {bids.length > 0 ? (
          <div className="space-y-2">
            {bids.map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">Deductible {usd(b.deductibleCents / 100)}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${
                      b.status === "signed" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {b.status}
                    {b.status === "signed" && b.signerName ? ` · ${b.signerName}` : ""}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{b.workDescription}</p>
                <div className="mt-2 flex items-center gap-3">
                  <button onClick={() => copyLink(b.token)} className="inline-flex items-center gap-1 text-xs font-medium text-gold hover:underline">
                    <Copy className="size-3" /> Copy link
                  </button>
                  <a
                    href={`/bid/${b.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" /> Open
                  </a>
                  {b.status !== "signed" ? (
                    <button onClick={() => remove(b.id)} className="ml-auto inline-flex items-center gap-1 text-xs text-destructive hover:underline">
                      <Trash2 className="size-3" /> Delete
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <div className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">New contract</div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Approved scope of work</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="Full roof replacement per insurance-approved scope — tear-off, new underlayment, architectural shingles, flashing, cleanup."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Insurance carrier</Label>
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="State Farm" />
            </div>
            <div>
              <Label className="text-sm">Claim #</Label>
              <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} placeholder="ABC-12345" />
            </div>
          </div>
          <div>
            <Label className="text-sm">Homeowner deductible ($)</Label>
            <Input type="number" min="0" value={deductible} onChange={(e) => setDeductible(e.target.value)} placeholder="1000" />
            <p className="mt-1 text-xs text-muted-foreground">
              The only amount the homeowner owes — the carrier pays the approved balance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Workmanship warranty (yrs)</Label>
              <Input type="number" min="0" max="99" value={workYears} onChange={(e) => setWorkYears(e.target.value)} />
            </div>
            <div>
              <Label className="text-sm">Manufacturer warranty (yrs)</Label>
              <Input type="number" min="0" max="99" value={mfrYears} onChange={(e) => setMfrYears(e.target.value)} />
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input
              type="checkbox"
              checked={physical}
              onChange={(e) => setPhysical(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Physical (pen &amp; paper) signature</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Replaces the on-screen signature with a printable signature line — for homeowners who prefer to sign in
                person. Leave unchecked for a digital e-signature.
              </span>
            </span>
          </label>
          <Button onClick={create} disabled={busy} className="w-full gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Create contract
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
