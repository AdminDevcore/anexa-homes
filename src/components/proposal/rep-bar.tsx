"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  SlidersHorizontal,
  DollarSign,
  PlusCircle,
  Zap,
  Eye,
  PencilRuler,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { repriceProposalAction, setProposalPaymentOptionsAction } from "@/server/modules/solar/proposal-reprice-actions";
import { setProposalComparisonAction } from "@/server/modules/solar/proposal-actions";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * The rep's controls, on the document itself.
 *
 * A rep at a kitchen table gets asked "what would that be at three-fifty a
 * watt" and the honest answer used to be four minutes of walking back through a
 * builder while the homeowner watched. This changes the deal from the page the
 * customer is looking at, reissues the document, and swaps it in underneath
 * them — the link on the table stays live, and the conversation does not stop.
 *
 * WHAT IT IS NOT: an editor. Nothing on screen is edited. Every save runs the
 * same validated, server-side generation the builder does, supersedes the
 * previous version and keeps its snapshot. The audit trail is identical to
 * pressing Generate; what is different is where the rep was standing.
 *
 * RENDERED FOR NOBODY BUT A REP. The customer's copy of this page never
 * receives the prop at all, so none of this reaches the public bundle's render
 * path — and every action behind it re-checks the permission on the server
 * regardless, because a component that is not rendered is not a guard.
 */

export type RepContext = {
  proposalId: string;
  version: number;
  /** The rate sheet a rep may move this deal onto. */
  programmes: { id: string; label: string; lender: string }[];
  /** The catalogue adders, and which are on the deal now. */
  adders: { id: string; label: string; price: string }[];
  selectedAdderIds: string[];
  grossPpwCents: number;
  lenderProductId: string | null;
  avgMonthlyBillCents: number | null;
  annualUsageKwh: number | null;
  showComparison: boolean;
  showPaymentOptions: boolean;
  /** Back to the builder, for everything this bar deliberately cannot do. */
  designHref: string;
  /** True for a purchase, where a price per watt means anything. */
  isPurchase: boolean;
};

type Panel = "pricing" | "adders" | "consumption" | "presentation";

export function RepBar({
  rep,
  onRepriced,
}: {
  rep: RepContext;
  /** Hands the freshly generated document back so the page can swap it in. */
  onRepriced: (snapshot: SolarProposalSnapshot, version: number) => void;
}) {
  const [panel, setPanel] = React.useState<Panel | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** What the readiness validator refused on, when it refused. */
  const [issues, setIssues] = React.useState<{ message: string; severity: string }[]>([]);

  // Local, so a rep can type without a round trip per keystroke. Nothing here
  // is authoritative — the server recomputes everything from the deal.
  const [ppw, setPpw] = React.useState((rep.grossPpwCents / 100).toFixed(2));
  const [programme, setProgramme] = React.useState(rep.lenderProductId ?? "");
  const [bill, setBill] = React.useState(
    rep.avgMonthlyBillCents == null ? "" : (rep.avgMonthlyBillCents / 100).toFixed(0)
  );
  const [usage, setUsage] = React.useState(rep.annualUsageKwh == null ? "" : String(rep.annualUsageKwh));
  const [adderIds, setAdderIds] = React.useState<string[]>(rep.selectedAdderIds);
  const [comparison, setComparison] = React.useState(rep.showComparison);
  const [menu, setMenu] = React.useState(rep.showPaymentOptions);

  async function apply(changes: Parameters<typeof repriceProposalAction>[0]) {
    if (busy) return;
    setBusy(true);
    setIssues([]);
    try {
      const res = await repriceProposalAction(changes);
      if (!res.ok) {
        // Inline, not just a toast: a rep standing next to a customer needs to
        // know WHICH figure is blocking, and a toast that says "fix the
        // blocking issues" is a dead end they cannot act on from here.
        if (res.issues?.length) setIssues(res.issues);
        toast.error(
          res.dealUpdated
            ? `${res.error} Your change was saved on the deal.`
            : res.error
        );
        return;
      }
      onRepriced(res.snapshot, res.version);
      toast.success(
        res.linkMoved
          ? `Re-priced · v${res.version} · the customer's link now shows this`
          : `Re-priced · v${res.version}`
      );
      setPanel(null);
    } catch {
      toast.error("That did not save. Nothing has been changed.");
    } finally {
      // ALWAYS. A busy flag left stuck on by a thrown action is a form the rep
      // can no longer type into, in front of the customer.
      setBusy(false);
    }
  }

  return (
    <>
      {/* The handle.
          BOTTOM-RIGHT: this only ever renders inside the portal preview, which
          has the app's own sidebar pinned down the left — anchoring left put
          the button on top of it. */}
      <div className="fixed bottom-5 right-5 z-50 print:hidden">
        <button
          type="button"
          onClick={() => setPanel("pricing")}
          className="flex items-center gap-2.5 rounded-full bg-neutral-900 py-3 pl-4 pr-5 text-sm font-semibold text-white shadow-2xl ring-1 ring-white/10 transition hover:bg-neutral-800"
        >
          <SlidersHorizontal className="size-4" />
          Adjust
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] tabular-nums">
            v{rep.version}
          </span>
        </button>
      </div>

      <Sheet open={panel !== null} onOpenChange={(o) => !o && setPanel(null)}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Adjust this proposal</SheetTitle>
            <SheetDescription>
              Saving reissues the document as a new version and, if the customer already has the
              link, moves it onto this one. The previous version is kept.
            </SheetDescription>
          </SheetHeader>

          <nav className="flex flex-wrap gap-1.5 px-4">
            <Tab active={panel === "pricing"} onClick={() => setPanel("pricing")} icon={DollarSign}>
              Pricing
            </Tab>
            <Tab active={panel === "adders"} onClick={() => setPanel("adders")} icon={PlusCircle}>
              Adders
            </Tab>
            <Tab active={panel === "consumption"} onClick={() => setPanel("consumption")} icon={Zap}>
              Consumption
            </Tab>
            <Tab active={panel === "presentation"} onClick={() => setPanel("presentation")} icon={Eye}>
              What they see
            </Tab>
          </nav>

          <div className="space-y-5 px-4 pb-8">
            {issues.length > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-xs font-semibold text-destructive">
                  The document cannot be reissued until these are fixed
                </p>
                <ul className="mt-2 space-y-1.5">
                  {issues.map((i, n) => (
                    <li key={n} className="text-xs leading-relaxed text-foreground">
                      · {i.message}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Your change was saved on the deal — you do not need to type it again.
                </p>
              </div>
            )}

            {panel === "pricing" && (
              <>
                {rep.isPurchase ? (
                  <Field
                    label="Price per watt"
                    hint="The sticker the customer is quoted, dealer fee included. What it leaves you after that fee has to sit inside Solar Settings' range, and above this lender's own minimum if it sets one."
                  >
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={ppw}
                      onChange={(e) => setPpw(e.target.value)}
                    />
                  </Field>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    A lease and a PPA sell electricity rather than a system, so there is no price
                    per watt to move. The programme below is what changes the payment.
                  </p>
                )}

                {rep.programmes.length > 0 && (
                  <Field
                    label="Financing programme"
                    hint="The rate sheet's own terms win — APR, term and dealer fee come from the row, not from this screen."
                  >
                    <select
                      value={programme}
                      onChange={(e) => setProgramme(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <option value="">No programme (use the deal&rsquo;s own terms)</option>
                      {rep.programmes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.lender} · {p.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}

                <Save
                  busy={busy}
                  onClick={() =>
                    apply({
                      proposalId: rep.proposalId,
                      ...(rep.isPurchase && ppw.trim() !== ""
                        ? { grossPpwCents: Math.round(Number(ppw) * 100) }
                        : {}),
                      lenderProductId: programme || null,
                    })
                  }
                />
              </>
            )}

            {panel === "adders" && (
              <>
                {rep.adders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing in the adder catalogue yet. Settings → Solar equipment.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {rep.adders.map((a) => {
                      const on = adderIds.includes(a.id);
                      return (
                        <li key={a.id}>
                          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-muted/50">
                            <span className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() =>
                                  setAdderIds((prev) =>
                                    on ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                                  )
                                }
                                className="size-4 accent-foreground"
                              />
                              {a.label}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{a.price}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  One-off lines typed on this deal are not shown here and are never removed by
                  this screen.
                </p>
                <Save
                  busy={busy}
                  onClick={() =>
                    apply({ proposalId: rep.proposalId, adderEquipmentIds: adderIds })
                  }
                />
              </>
            )}

            {panel === "consumption" && (
              <>
                <Field
                  label="Average monthly bill ($)"
                  hint="What the customer pays today. Every savings figure on the document is measured against this."
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={bill}
                    onChange={(e) => setBill(e.target.value)}
                  />
                </Field>
                <Field
                  label="Annual usage (kWh)"
                  hint="Leave blank on a deal captured from the bill and it is re-derived from the bill and the rate."
                >
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={usage}
                    onChange={(e) => setUsage(e.target.value)}
                  />
                </Field>
                <Save
                  busy={busy}
                  onClick={() =>
                    apply({
                      proposalId: rep.proposalId,
                      avgMonthlyBillCents:
                        bill.trim() === "" ? null : Math.round(Number(bill) * 100),
                      ...(usage.trim() === "" ? {} : { annualUsageKwh: Math.round(Number(usage)) }),
                    })
                  }
                />
              </>
            )}

            {panel === "presentation" && (
              <>
                {/* These two do NOT reissue the document. The options and the
                    table are frozen into the snapshot either way; this is only
                    about what gets put in front of this household. */}
                <Toggle
                  label="Offer the payment menu"
                  hint="Lets the customer switch between the ways of paying that were frozen into this version. Off shows only what the deal was quoted on."
                  checked={menu}
                  onChange={async (v) => {
                    setMenu(v);
                    const res = await setProposalPaymentOptionsAction(rep.proposalId, v);
                    if (!res.ok) {
                      setMenu(!v);
                      toast.error(res.error);
                    }
                  }}
                />
                <Toggle
                  label="Show the year-by-year comparison"
                  hint="Some households read the table as the proof and some read it as a wall of numbers."
                  checked={comparison}
                  onChange={async (v) => {
                    setComparison(v);
                    const res = await setProposalComparisonAction(rep.proposalId, v);
                    if (!res.ok) {
                      setComparison(!v);
                      toast.error(res.error);
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Both take effect on the customer&rsquo;s copy the next time it loads. Neither
                  reissues the document or changes a single figure in it.
                </p>
              </>
            )}

            {/* Everything this bar deliberately cannot do. Changing the product,
                the equipment or the array is a decision with validation behind
                it, and it belongs where that validation lives. */}
            <div className="border-t border-border pt-5">
              <Link
                href={rep.designHref}
                className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                <PencilRuler className="size-4" />
                Redraw the array, or change the equipment
              </Link>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Tab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70"
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div id={id}>{children}</div>
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function Save({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <Button onClick={onClick} disabled={busy} className="w-full">
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin" /> Reissuing…
        </>
      ) : (
        "Save and reissue"
      )}
    </Button>
  );
}
