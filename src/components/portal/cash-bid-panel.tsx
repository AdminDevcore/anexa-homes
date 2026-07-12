"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Copy, Trash2, ExternalLink, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createCashBidAction, deleteCashBidAction } from "@/server/modules/cashbid/actions";
import type { CashBidRow } from "@/server/modules/cashbid/queries";

const usd = (dollars: number) => `$${(Math.round(dollars * 100) / 100).toLocaleString()}`;

export function CashBidButton({ leadId, bids }: { leadId: string; bids: CashBidRow[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [desc, setDesc] = React.useState("");
  const [dollars, setDollars] = React.useState("");
  const [deposit, setDeposit] = React.useState("50");
  const [busy, setBusy] = React.useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const total = parseFloat(dollars || "0") || 0;
  const pct = Math.min(100, Math.max(0, parseInt(deposit || "50", 10) || 0));

  async function create() {
    const totalCents = Math.round(total * 100);
    if (desc.trim().length < 3) return toast.error("Add a short description of the work.");
    if (totalCents <= 0) return toast.error("Enter a total price.");
    setBusy(true);
    const res = await createCashBidAction({ leadId, workDescription: desc.trim(), totalCents, depositPercent: pct });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Cash bid created — copy the link to send it.");
    setDesc("");
    setDollars("");
    setDeposit("50");
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
    if (!confirm("Delete this bid?")) return;
    const res = await deleteCashBidAction(id);
    if (!res.ok) return toast.error(res.error);
    toast.success("Deleted");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="size-4" /> Simple Cash Bid
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Simple Cash Bid</DialogTitle>
        </DialogHeader>

        {bids.length > 0 ? (
          <div className="space-y-2">
            {bids.map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{usd(b.totalCents / 100)}</span>
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
            <div className="border-t border-border pt-2 text-xs font-medium text-muted-foreground">New bid</div>
          </div>
        ) : null}

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Work description</Label>
            <Textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="Full roof replacement — architectural shingles, tear-off & haul-away, new underlayment, cleanup."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Total price ($)</Label>
              <Input type="number" min="0" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="18500" />
            </div>
            <div>
              <Label className="text-sm">Deposit %</Label>
              <Input type="number" min="0" max="100" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </div>
          </div>
          {total > 0 ? (
            <p className="text-xs text-muted-foreground">
              Upfront {usd((total * pct) / 100)} · on completion {usd(total - (total * pct) / 100)}
            </p>
          ) : null}
          <Button onClick={create} disabled={busy} className="w-full gap-1.5">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Create bid
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
