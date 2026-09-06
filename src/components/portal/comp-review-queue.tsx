"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { establishHistoricalCompAction } from "@/server/modules/solar/comp-actions";

/**
 * Signed deals whose pay terms cannot be read — and the only way to free one.
 *
 * ── WHY A DEAL LANDS HERE ──────────────────────────────────────────────────
 * A solar deal freezes its compensation terms at signing. When that could not
 * be resolved — legacy data from before the snapshot existed, a rep with no
 * configured basis at the moment of signature, an earlier failure — the deal is
 * flagged instead of being quietly left blank.
 *
 * ── WHAT THE FLAG DOES ─────────────────────────────────────────────────────
 * Payroll REFUSES it. Not the rep's line and not any manager override on it.
 * The engine will not price a signed sale off the rep's settings as they stand
 * today, because those are not the terms it was sold under: a raise granted
 * last month would silently reprice a deal closed last year, in whichever
 * direction happened to favour nobody in particular.
 *
 * ── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 * That refusal is correct and it is also a dead end. Without a way in, a
 * flagged deal could only ever be freed by writing SQL against production. Here
 * an authorised admin states the terms the deal was actually sold under, in
 * writing, and the action logs who said so and why.
 */

export type CompReviewRow = {
  leadId: string;
  customerName: string;
  address: string | null;
  repName: string;
  signedAt: string | null;
};

const BASES = [
  { value: "redline", label: "Redline — $/W above the rep's floor", unit: "$/W", step: "0.01" },
  { value: "per_watt", label: "Fixed rate — $/W", unit: "$/W", step: "0.01" },
  { value: "battery_redline", label: "Battery redline — $/battery", unit: "$/battery", step: "100" },
  { value: "battery_flat", label: "Battery flat — $/battery", unit: "$/battery", step: "100" },
] as const;

type Basis = (typeof BASES)[number]["value"];

export function CompReviewQueue({ rows }: { rows: CompReviewRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
      <h3 className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle className="size-4" /> Compensation terms needed ({rows.length})
      </h3>
      <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
        These deals were signed without readable pay terms, so payroll will not generate a
        commission for them — for the rep or for any manager override. Establish the terms the deal
        was actually sold under. Nothing is guessed from today&rsquo;s Team settings.
      </p>
      <ul className="divide-y divide-amber-500/20">
        {rows.map((r) => (
          <li key={r.leadId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
            <div className="min-w-0">
              <Link href={`/portal/leads/${r.leadId}`} className="font-medium hover:underline">
                {r.customerName}
              </Link>
              <div className="text-[11px] text-muted-foreground">
                {r.repName}
                {r.address ? ` · ${r.address}` : ""}
                {r.signedAt ? ` · signed ${new Date(r.signedAt).toLocaleDateString()}` : ""}
              </div>
            </div>
            <EstablishTerms row={r} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EstablishTerms({ row }: { row: CompReviewRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [basis, setBasis] = React.useState<Basis>("redline");
  const [rate, setRate] = React.useState("");
  const [note, setNote] = React.useState("");

  const chosen = BASES.find((b) => b.value === basis)!;

  async function save() {
    const n = Number(rate);
    if (!(n >= 0) || rate.trim() === "") return toast.error("Enter the rate for the basis you chose.");
    if (note.trim().length < 3) return toast.error("Say what these terms are based on.");
    setBusy(true);
    try {
      // Each basis stores in its own unit — cents for the two redlines and the
      // flat per-battery rate, mills for the fixed $/W. Sending the wrong one
      // is a factor-of-ten error in somebody's pay, so the conversion lives
      // beside the picker that chose the basis.
      const res = await establishHistoricalCompAction({
        leadId: row.leadId,
        note: note.trim(),
        basis,
        redlineCentsPerWatt: basis === "redline" ? Math.round(n * 100) : null,
        millsPerWatt: basis === "per_watt" ? Math.round(n * 1000) : null,
        redlinePerBatteryCents: basis === "battery_redline" ? Math.round(n * 100) : null,
        perBatteryFlatCents: basis === "battery_flat" ? Math.round(n * 100) : null,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Terms established — this deal can now generate commission");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Establish terms</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Establish terms — {row.customerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-muted p-2.5 text-[11px] text-muted-foreground">
            Enter the terms <span className="font-medium text-foreground">{row.repName}</span> sold
            this deal under, not their current settings. This is recorded against your name with the
            reason you give, and it cannot overwrite terms that resolved correctly at signing.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs">Basis</Label>
            <Select value={basis} onValueChange={(v) => setBasis(v as Basis)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BASES.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Rate ({chosen.unit})</Label>
            <Input
              type="number"
              inputMode="decimal"
              step={chosen.step}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder={basis.startsWith("battery") ? "9,000" : "2.50"}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">What these are based on</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Signed comp plan on file, 12 Mar 2026"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
            {busy && <Loader2 className="size-4 animate-spin" />} Establish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
