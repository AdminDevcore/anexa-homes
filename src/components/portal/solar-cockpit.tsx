"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Check, DollarSign, Pencil, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  postDealFeedAction,
  upsertSolarCommissionAction,
} from "@/server/modules/solar/cockpit-actions";
import {
  FinancingTermsPanel,
  type FinancingTerms,
} from "@/components/portal/solar/financing-terms";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdc = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

// The stage bar used to live here. Nothing about it was solar-specific, so it
// now serves both verticals from `deal-stage-bar.tsx` (DealStageBar).

// ---------------------------------------------------------------------------
// 1 · System & money
// ---------------------------------------------------------------------------

/** What the rep is owed on this deal. One row, because it pays once. */
export type CommissionLite = {
  amountCents: number;
  trigger: string | null;
  expectedAt: string | null;
  paidAt: string | null;
};

/** What the commission pays on, unless somebody types something else. */
const DEFAULT_TRIGGER = "M1 funding";

export type SystemMoney = {
  sizeKwDc: number;
  year1ProductionKwh: number;
  offsetPct: number;
  moduleLabel: string | null;
  moduleQty: number;
  inverterLabel: string | null;
  batteryLabel: string | null;
  product: string | null;
  systemWatts: number;
  basePpwCents: number;
  adderPpwCents: number;
  adderTotalCents: number;
  grossPpwCents: number;
  grossPriceCents: number;
  dealerFeePct: number;
  dealerFeeCents: number;
  dealerFeePpwCents: number;
  finalPpwCents: number;
  contractPriceCents: number;
  /** The partner's stated final $/W, cents. Null when it publishes none. */
  maxFinalPpwCents: number | null;
  /** Whether that figure is a ceiling or this partner's flat price. */
  finalPpwMode: "cap" | "flat";
  /** True when that rule is what set this price, rather than the base. */
  cappedByLender: boolean;
  lenderName: string | null;
};

/**
 * The money on a solar deal: what is being sold, at what price, financed by
 * whom, and what the rep makes on it.
 *
 * TWO COLUMNS, NOT ONE STACK. This ran four blocks deep — stat tiles, a spec
 * list, the price ladder, two payment schedules — and then the page added the
 * lender's terms underneath, so the slide was close to two screens tall and
 * the lender's decision (what a coordinator opens it for) sat well below the
 * price (what a rep opens it for). Neither half is long on its own; side by
 * side the whole thing lands in one view.
 */
export function SolarSystemMoneyPanel({
  leadId,
  money,
  financing,
  commission,
  canEdit,
}: {
  leadId: string;
  money: SystemMoney | null;
  /** The lender's own terms. Rendered here rather than as a section below. */
  financing: FinancingTerms | null;
  commission: CommissionLite | null;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Hairline grid rather than four floating tiles: gap-px over a
          border-coloured backdrop draws one strip on any number of rows, so
          the wrapped 2×2 on a phone reads as the same object as the 1×4. */}
      {money && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          <Metric label="System size" value={`${money.sizeKwDc.toFixed(2)} kW`} />
          <Metric
            label="Year-1 production"
            value={`${money.year1ProductionKwh.toLocaleString()} kWh`}
          />
          <Metric label="Offset" value={`${Math.round(money.offsetPct)}%`} />
          <Metric label="System cost" value={usd(money.contractPriceCents)} accent />
        </div>
      )}

      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="space-y-5">
          {money ? (
            <>
              <Block label="System">
                <dl className="divide-y divide-border text-sm">
                  {money.moduleLabel && (
                    <SpecRow k="Modules" v={`${money.moduleQty} × ${money.moduleLabel}`} />
                  )}
                  {money.inverterLabel && <SpecRow k="Inverter" v={money.inverterLabel} />}
                  {money.batteryLabel && <SpecRow k="Battery" v={money.batteryLabel} />}
                </dl>
              </Block>

              {/*
                The price ladder, rung by rung. Every figure derives from what
                is already stored on the design and finance rows — nothing new
                is entered here.

                BASE + ADDERS = GROSS is what the company keeps; the dealer fee
                grosses that up to the FINAL price the customer signs. The fee
                is a percentage OF THE FINAL, which is why gross → final divides
                rather than multiplies: a 30% programme on a $100,000 system
                leaves $70,000.
              */}
              <Block label="Pricing breakdown">
                <dl data-testid="pricing-breakdown" className="divide-y divide-border text-sm">
                  <SpecRow k="Base price" v={`${usdc(money.basePpwCents)}/W`} />
                  <SpecRow
                    k="Adders"
                    v={`${usdc(money.adderPpwCents)}/W${money.adderTotalCents > 0 ? ` · ${usd(money.adderTotalCents)}` : ""}`}
                  />
                  <SpecRow
                    k="Gross price"
                    v={`${usdc(money.grossPpwCents)}/W · ${usd(money.grossPriceCents)}`}
                  />
                  <SpecRow
                    k={money.dealerFeePct > 0 ? `Dealer fee · ${money.dealerFeePct}%` : "Dealer fee"}
                    v={
                      money.dealerFeeCents > 0
                        ? `${usdc(money.dealerFeePpwCents)}/W · ${usd(money.dealerFeeCents)}`
                        : "None"
                    }
                  />
                  <div className="flex items-center justify-between gap-4 py-1.5 font-semibold">
                    <dt>Final price</dt>
                    <dd className="tabular-nums text-solar">
                      {usdc(money.finalPpwCents)}/W · {usd(money.contractPriceCents)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Gross is what Anexa keeps — base plus adders, before the lender&rsquo;s cut. The
                  dealer fee is a share of the final price, so the adders carry it too.
                </p>
                {/* A LADDER THE PARTNER SET HAS TO SAY SO. Once the partner's
                    figure decides the price, the base is solved backwards out of
                    it — a rep who typed $3.00/W in the builder reads $1.93/W
                    here. Unexplained that looks like the page has lost the
                    price; named, it is the partner's own rate doing exactly what
                    it was set to do.

                    A FLAT partner is not "held" at anything, it simply sells at
                    one number, and a notice that says "held" invites a rep to go
                    looking for the price it was held down FROM. */}
                {money.cappedByLender && money.maxFinalPpwCents != null && (
                  <p className="mt-1 text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-500">
                    {money.finalPpwMode === "flat" ? (
                      <>
                        {money.lenderName ?? "This lender"} sells at a flat{" "}
                        {usdc(money.maxFinalPpwCents)}/W, fee and adders included — the base above
                        is what is left of it, not a price typed on this deal.
                      </>
                    ) : (
                      <>
                        Held at {money.lenderName ?? "this lender"}&rsquo;s ceiling of{" "}
                        {usdc(money.maxFinalPpwCents)}/W, fee and adders included. The base above
                        is what survives it — not the price typed on the deal.
                      </>
                    )}
                  </p>
                )}
              </Block>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a system design and financing with <strong>Build Proposal</strong> and the
              numbers appear here.
            </p>
          )}
        </div>

        <div className="space-y-5">
          {financing && (
            <Block label="Financing & lender">
              <FinancingTermsPanel terms={financing} />
            </Block>
          )}
          <Block label="Rep commission">
            <RepCommission leadId={leadId} row={commission} canEdit={canEdit} />
          </Block>
        </div>
      </div>
    </div>
  );
}

/** A titled run of rows. Small caps, no rule — the rows carry the structure. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * What the rep makes on this deal.
 *
 * ONE FIGURE. This was two M1/M2 tranches beside two financier draws — four
 * slots, on the assumption that a solar rep is paid down as the lender funds.
 * He is not: he is paid out in full, once. Three of the four were a schedule
 * with nothing to put in it, and every deal in production had all four empty,
 * which made a finished deal look permanently half-entered.
 *
 * The financier's side is not typed here at all. When the lender pays is
 * already the pipeline stage the payroll gate reads (M1 Funding); a second,
 * hand-kept copy of it could only ever disagree with the one that releases the
 * money.
 */
function RepCommission({
  leadId,
  row,
  canEdit,
}: {
  leadId: string;
  row: CommissionLite | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = React.useState(false);

  if (editing) {
    return <CommissionForm leadId={leadId} existing={row} onDone={() => setEditing(false)} />;
  }

  const paid = !!row?.paidAt;
  const trigger = row?.trigger?.trim() || DEFAULT_TRIGGER;
  const sub = paid
    ? `Paid ${new Date(row!.paidAt!).toLocaleDateString()}`
    : row?.expectedAt
      ? `Due ${new Date(row.expectedAt).toLocaleDateString()} · pays on ${trigger}`
      : `Pays on ${trigger}`;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          paid ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
        )}
      >
        {paid ? <Check className="size-3.5" /> : <DollarSign className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-sm font-semibold tabular-nums",
            !row?.amountCents && "font-medium text-muted-foreground"
          )}
        >
          {row?.amountCents ? usd(row.amountCents) : "Not set"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
      </div>
      {canEdit && (
        <button
          onClick={() => setEditing(true)}
          aria-label="Edit commission"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function CommissionForm({
  leadId,
  existing,
  onDone,
}: {
  leadId: string;
  existing: CommissionLite | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [amount, setAmount] = React.useState(
    existing?.amountCents ? (existing.amountCents / 100).toString() : ""
  );
  const [trigger, setTrigger] = React.useState(existing?.trigger ?? DEFAULT_TRIGGER);
  const [expected, setExpected] = React.useState(
    existing?.expectedAt ? existing.expectedAt.slice(0, 10) : ""
  );
  const [paid, setPaid] = React.useState(!!existing?.paidAt);

  async function save() {
    setBusy(true);
    // The flag is cleared in a finally: a server action that throws used to
    // leave it latched on, and the form stayed dead until a reload.
    try {
      const res = await upsertSolarCommissionAction({
        leadId,
        amountCents: Math.round(Number(amount || 0) * 100),
        trigger: trigger.trim() || null,
        expectedAt: expected ? new Date(expected).toISOString() : null,
        paid,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Commission saved");
      onDone();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border border-border p-3" data-testid="commission-form">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Amount ($)</span>
          <input
            aria-label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Expected date</span>
          <input
            aria-label="Expected date"
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
      </div>
      <label className="block space-y-0.5">
        <span className="text-[11px] text-muted-foreground">Pays when</span>
        <input
          aria-label="Pays when"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          aria-label="Paid"
          checked={paid}
          onChange={(e) => setPaid(e.target.checked)}
          className="size-4"
        />
        Paid
        <span className="text-muted-foreground">
          — stamps today&rsquo;s date; unticking clears it, so the two never drift
        </span>
      </label>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div
        className={cn(
          "font-display text-base font-semibold tabular-nums",
          accent && "text-solar"
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Activity feed
// ---------------------------------------------------------------------------

export type FeedPost = {
  id: string;
  body: string;
  author: string;
  createdAt: string;
};

/**
 * One stream, like roofing's notes.
 *
 * This feed used to be split three ways — Internal / External / Customer —
 * with a picker on the composer and a filter row above the list. Two of those
 * audiences do not exist: there is no customer portal, so nothing here was ever
 * shown to a homeowner, and "external" and "customer" only ever differed in the
 * colour of their badge. Three tabs to say one thing made every post a small
 * decision with no consequence, and made the feed read as a place you could
 * accidentally publish something. Everything posted here is staff-only.
 *
 * Rows written under the old channels keep their value in the database and
 * still appear in the stream; the column simply stopped being a UI concept.
 */
export function SolarActivityFeed({
  leadId,
  posts,
  canPost,
}: {
  leadId: string;
  posts: FeedPost[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await postDealFeedAction({ leadId, body: body.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.mentioned ? `Posted · ${res.mentioned} notified` : "Posted");
    setBody("");
    router.refresh();
  }

  return (
    <div className="space-y-4" data-testid="solar-activity-feed">
      {canPost && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write an update. Use @Name to notify someone by email."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">Staff only — notes never leave the portal.</p>
            <Button size="sm" onClick={post} disabled={busy || !body.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Post
            </Button>
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{p.author}</span>
                <span className="text-muted-foreground">
                  {new Date(p.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{p.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The quick-action pill row that used to sit here is gone.
//
// Five pills under the header (View proposal / Edit design / Upload files /
// Tasks / Invite homeowner) each duplicated a control that already lives with
// the thing it acts on, one screen further down: the System Design card, the
// Contracts & documents card, the Review & send card, the activity feed's
// follow-up. Two entry points to one action is a maintenance tax and a reading
// tax. "Invite homeowner" was not moved but DELETED, along with its server
// action — this product has no customer-facing portal, so there is nowhere to
// invite a homeowner to.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The "Deferred" panel is gone.
//
// It held one card, "Project AI assistant — Coming soon", which described work
// belonging to a different programme. A coming-soon tile on a deal page is a
// permanent advert for something a rep cannot use: it takes up the same room as
// working tools and trains people to skip that part of the page. If the
// assistant ships, it earns its place then.
// ---------------------------------------------------------------------------
