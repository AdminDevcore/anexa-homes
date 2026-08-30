"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Archive, RotateCcw, Pencil, Check, X, ExternalLink, Upload, Globe, ImageOff, ImagePlus } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LenderMark } from "@/components/ui/lender-mark";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatFactor } from "@/lib/solar-loan";
import { basePpwFromSticker } from "@/lib/solar-money";
import {
  reconcileContract,
  DISCLOSURE_TOKENS,
  DISCLOSURE_TEMPLATE_SUGGESTION,
} from "@/lib/solar-contract-adjustment";
import {
  upsertSolarLenderProductAction,
  setSolarLenderProductActiveAction,
  deleteSolarLenderProductAction,
} from "@/server/modules/solar/lender-product-actions";
import {
  lenderProductLabel,
  LENDER_PRODUCT_KINDS,
  PRODUCT_LABEL,
  type LenderProductKind,
} from "@/lib/solar-lender-product";
import {
  upsertSolarLenderAction,
  setSolarLenderActiveAction,
  deleteSolarLenderAction,
  setLenderAdderRulesAction,
} from "@/server/modules/solar/actions";
import {
  uploadSolarLenderLogoAction,
  fetchSolarLenderLogoAction,
  removeSolarLenderLogoAction,
} from "@/server/modules/solar/lender-logo-actions";

export type LenderRow = {
  id: string;
  name: string;
  isActive: boolean;
  rank: number;
  notes: string | null;
  /** Rep-facing dealer portal. Never rendered to a customer. */
  portalUrl: string | null;
  /** Customer-facing application link — the proposal's Qualify button. */
  applyUrl: string | null;
  creditInstructions: string | null;
  /**
   * How reps are paid on this lender's deals: they keep the overage above their
   * own redline, or they earn a flat rate per installed watt.
   */
  repPayMode: "redline" | "per_watt";
  /**
   * The most this partner's paper ever puts in front of a homeowner per watt,
   * cents, dealer fee and adders included. Null — nearly every lender — leaves
   * pricing exactly as it was.
   */
  maxFinalPpwCents: number | null;
  /** Whether that figure is a ceiling or this partner's flat price. */
  finalPpwMode: "cap" | "flat";
  /**
   * The least this partner's deals may leave the company per watt, cents,
   * before its cut. Null — nearly every lender — means no floor.
   */
  minBasePpwCents: number | null;
  minBasePricePerBatteryCents: number | null;
  maxFinalPricePerBatteryCents: number | null;
  finalBatteryPriceMode: "cap" | "flat";
  /**
   * Whether this partner funds an array with no storage on it. `warn` is what
   * every lender did before the column existed.
   */
  batteryRule: "optional" | "warn" | "required";
  /**
   * THE PROGRAMME CONTRIBUTION — the one setting on this screen that makes the
   * contract value and the customer's obligation two different numbers.
   *
   * Off on every lender until somebody turns it on. The label and the
   * disclosure carry no defaults on purpose: what the money is CALLED is a
   * legal characterisation, and the app is not entitled to pick one.
   */
  contractAdjustmentEnabled: boolean;
  contractAdjustmentType: "fixed";
  contractAdjustmentCents: number | null;
  contractAdjustmentLabel: string | null;
  contractAdjustmentDisclosure: string | null;
  /** ISO date (YYYY-MM-DD), or null for "already running". */
  contractAdjustmentEffectiveAt: string | null;
  /** What the household ends up owning, in this partner's own words. */
  ownershipDisclosure: string | null;
  /**
   * This partner's answer, per adder, to "on top of your $/W or out of it?".
   * Keyed by catalogue id. An id that is ABSENT has no rule and falls back to
   * the catalogue — which is a different thing from a rule of `false`.
   */
  adderRules: Record<string, boolean>;
  /** The partner's own mark, when one has been uploaded or fetched. */
  logoUrl: string | null;
  /** How many catalogue items this lender approves. */
  approvedCount: number;
  /** How many designs are being built for it. */
  dealCount: number;
  /** The terms this lender finances on. Empty until somebody enters them. */
  products: LenderProduct[];
};

export type LenderProduct = {
  id: string;
  lenderId: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  financesStorageOnly: boolean;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  /** Payment factors in millionths. Loan only; null when the sheet quotes none. */
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  isActive: boolean;
};

/** One adder the company sells, as a lender is asked to rule on it. */
export type AdderRuleOption = {
  id: string;
  label: string;
  description: string | null;
  /** "$2,700", "$0.05/W" — the RULE, not a resolved amount. */
  rateLabel: string;
  /** What the catalogue says, and therefore what a lender with no rule does. */
  catalogueOnTop: boolean;
};

/**
 * The lenders whose approved-vendor lists constrain what can be sold.
 *
 * One lender is one row, deliberately: "Credit Human" and "credit human" as two
 * rows would split one AVL in half and hide approved equipment from whichever
 * one a rep picked.
 */
export function SolarLenderManager({
  lenders,
  sellableEquipment,
  canEdit,
  targetNetPpwCents,
  adderCatalogue,
}: {
  lenders: LenderRow[];
  sellableEquipment: number;
  canEdit: boolean;
  /** From Solar Settings. Null = the sticker is not derived from a dealer fee. */
  targetNetPpwCents: number | null;
  /** The sellable adders every lender is asked to rule on. */
  adderCatalogue: AdderRuleOption[];
}) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await upsertSolarLenderAction(null, {
      name: name.trim(),
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    setName(""); setNotes("");
    toast.success("Lender added");
    router.refresh();
  }

  const live = lenders.filter((l) => l.isActive);
  const retired = lenders.filter((l) => !l.isActive);

  return (
    <div className="space-y-6">
      {canEdit && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Add a lender</h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="new-lender-name">Name</Label>
              <Input
                id="new-lender-name"
                value={name}
                placeholder="e.g. Credit Human"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="new-lender-notes">Notes (optional)</Label>
              <Input
                id="new-lender-notes"
                value={notes}
                placeholder="Anything worth remembering about this partner"
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button onClick={add} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">
          Financing partners{live.length > 0 ? ` (${live.length})` : ""}
        </h3>
        {live.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            No lenders yet. Add the banks and finance partners you sell through, then tag your
            equipment with the ones that approve it on{" "}
            <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
              Solar Equipment
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((l) => (
              <LenderCard
                key={l.id}
                lender={l}
                sellableEquipment={sellableEquipment}
                canEdit={canEdit}
                adderCatalogue={adderCatalogue}
              />
            ))}
          </div>
        )}
      </section>

      {retired.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Retired ({retired.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            Not offered on new deals. Kept because deals already built for them still point here.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {retired.map((l) => (
              <LenderCard
                key={l.id}
                lender={l}
                sellableEquipment={sellableEquipment}
                canEdit={canEdit}
                adderCatalogue={adderCatalogue}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Rate sheets ─────────────────────────────────────────────────────
          Full width, below the cards, because a rate sheet is a table and a
          third of a grid row is not enough to read one in. The cards above
          answer "who finances us"; this answers "on what terms". */}
      {live.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">Rate sheets</h3>
          <p className="text-xs text-muted-foreground">
            What each lender will finance, and on what terms. A rep picks one of these on a deal and
            the payment is quoted from it — the APR, term and dealer fee come from here, never from
            the deal screen.
            {targetNetPpwCents == null ? (
              <>
                {" "}No target net $/W is set, so the sticker price stays exactly as a rep types it.
                Set one in{" "}
                <Link href="/portal/settings/solar" className="underline underline-offset-2">
                  Solar Settings
                </Link>{" "}
                and it is derived from each product&rsquo;s dealer fee instead, so cheaper money
                raises the price rather than costing you margin.
              </>
            ) : (
              <>
                {" "}Target net{" "}
                <span className="font-medium text-foreground">
                  ${(targetNetPpwCents / 100).toFixed(2)}/W
                </span>
                , so the sticker is derived from the chosen product&rsquo;s dealer fee.
              </>
            )}
          </p>
          {live.map((l) => (
            <RateSheet key={l.id} lender={l} canEdit={canEdit} />
          ))}
        </section>
      )}

      {/* ── Extra work ──────────────────────────────────────────────────────
          Full width and below the cards for the same reason the rate sheets
          are: this is a list as long as the adder catalogue, and a third of a
          grid row cannot hold one.

          It only means anything on a partner with a $/W figure, because "on
          top of the price" needs a price to be on top of — but it is shown for
          every lender rather than hidden, so an admin setting a cap tomorrow
          does not have to discover that a screen appeared. */}
      {live.length > 0 && adderCatalogue.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-semibold">Extra work, lender by lender</h3>
          <p className="text-xs text-muted-foreground">
            On a partner with a fixed or maximum $/W, every adder comes out of that figure by
            default: the homeowner&rsquo;s number does not move and the work is paid for out of what
            you keep. Tick an adder here and this partner funds it{" "}
            <span className="font-medium text-foreground">on top</span>
            {" "}instead, at its own price — a 10&nbsp;kW job at $5.50/W is $55,000, and the same
            job with a $7,000 roof on top is $62,000. Untick one and it goes back inside the price, even if the catalogue puts it on
            top for everybody else.
          </p>
          {live.map((l) => (
            <AdderRuleSheet key={l.id} lender={l} canEdit={canEdit} catalogue={adderCatalogue} />
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * What ONE lender does with each adder: on top of its price, or out of it.
 *
 * Three states in the data and two on the screen, deliberately. The table
 * distinguishes "this partner says on top", "this partner says inside" and "no
 * rule, ask the catalogue" — but a person setting this up is answering a yes/no
 * question about a partner they know, so the checkbox is yes/no and the third
 * state is what it STARTS at. Where a lender has no rule the box shows the
 * catalogue's answer and the row says so; saving turns every row into an
 * explicit rule, which is what makes it possible to say "not for this one"
 * about an adder the catalogue puts on top.
 */
function AdderRuleSheet({
  lender,
  canEdit,
  catalogue,
}: {
  lender: LenderRow;
  canEdit: boolean;
  catalogue: AdderRuleOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  /** The screen's answer per adder: the lender's rule, or the catalogue's. */
  const resolved = React.useCallback(
    () =>
      Object.fromEntries(
        catalogue.map((a) => [a.id, lender.adderRules[a.id] ?? a.catalogueOnTop])
      ) as Record<string, boolean>,
    [catalogue, lender.adderRules]
  );

  const [draft, setDraft] = React.useState<Record<string, boolean>>(resolved);

  /**
   * Re-seed when the server sends something new — DURING RENDER, not in an
   * effect, for the reason the storage panel spells out: an effect that calls
   * setState runs after a paint, so the list would flash the pre-save answers
   * for a frame on every refresh.
   *
   * Compared on a SIGNATURE rather than on the object, because `adderRules`
   * arrives from a server component and is a new object every render — a
   * reference check would re-seed on refreshes that changed nothing and throw
   * away an edit somebody was halfway through.
   */
  const serverKey = catalogue
    .map((a) => `${a.id}:${(lender.adderRules[a.id] ?? a.catalogueOnTop) ? 1 : 0}`)
    .join(",");
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(resolved());
  }

  const dirty = catalogue.some((a) => draft[a.id] !== (lender.adderRules[a.id] ?? a.catalogueOnTop));
  const onTop = catalogue.filter((a) => draft[a.id]);
  /** Rows this lender has never ruled on, so the screen can say whose answer it is showing. */
  const unruled = catalogue.filter((a) => lender.adderRules[a.id] === undefined);

  const priced = lender.maxFinalPpwCents != null || lender.maxFinalPricePerBatteryCents != null;

  async function save() {
    setBusy(true);
    const res = await setLenderAdderRulesAction(
      lender.id,
      catalogue.map((a) => ({ equipmentId: a.id, financedOnTop: !!draft[a.id] }))
    );
    setBusy(false);
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(
      res.count === 0
        ? `Every adder comes out of ${lender.name}'s price.`
        : `${res.count} ${res.count === 1 ? "adder rides" : "adders ride"} on top of ${lender.name}'s price.`
    );
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="sm" />
        <h4 className="font-medium">{lender.name}</h4>
        <span className="text-xs text-muted-foreground">
          {onTop.length === 0
            ? "everything inside the price"
            : `${onTop.length} on top${
                lender.maxFinalPpwCents != null
                  ? ` of $${ppwToDollars(lender.maxFinalPpwCents)}/W`
                  : ""
              }`}
        </span>
      </div>

      {!priced && (
        <p className="rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">
          This partner has no fixed or maximum price, so its adders are quoted the ordinary way and
          nothing here changes a deal. Set one above and these start applying.
        </p>
      )}

      <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
        {catalogue.map((a) => {
          const checked = !!draft[a.id];
          const inherited = lender.adderRules[a.id] === undefined;
          return (
            <li key={a.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 px-3 py-2 text-sm",
                  canEdit ? "hover:bg-muted/40" : "cursor-default"
                )}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={checked}
                  disabled={!canEdit || busy}
                  onChange={(e) => setDraft((d) => ({ ...d, [a.id]: e.target.checked }))}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.label}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {a.rateLabel}
                    {" · "}
                    {checked
                      ? "added to the loan on top, at this price"
                      : "comes out of this partner's price"}
                    {inherited && " · from the catalogue, not set here yet"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
          </Button>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setDraft(resolved())} disabled={busy}>
              <X className="size-4" /> Cancel
            </Button>
          )}
          {!dirty && unruled.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {unruled.length} of these{" "}
              {unruled.length === 1 ? "is showing the catalogue's" : "are showing the catalogue's"}{" "}
              answer. Save to make them this partner&rsquo;s own.
            </span>
          )}
        </div>
      )}

      {/* The one thing that is NOT true of this screen, said before somebody
          assumes otherwise: the flag is copied onto a deal when the adder is
          picked, so this moves the next quote and not the last one. */}
      <p className="text-[11px] text-muted-foreground">
        Applies to work added from now on. A deal already carrying an adder keeps what it was
        quoted at until somebody sets its lender again on the Financing step, which re-reads these.
      </p>
    </div>
  );
}

/**
 * How many adders this lender funds on top of its own price.
 *
 * Counted the way the deal will resolve it — the lender's rule where it has
 * one, the catalogue's answer where it has not — rather than by counting rows
 * in the override table. A partner that has never been opened still puts the
 * roof on top if the catalogue says so, and a summary that read 0 there would
 * be describing a screen rather than a price.
 */
function adderOnTopCount(lender: LenderRow, catalogue: AdderRuleOption[]): number {
  return catalogue.filter((a) => lender.adderRules[a.id] ?? a.catalogueOnTop).length;
}

/** One lender's terms, grouped by the product they price. */
function RateSheet({ lender, canEdit }: { lender: LenderRow; canEdit: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = React.useState<LenderProductKind | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);

  const live = lender.products.filter((p) => p.isActive);
  const retired = lender.products.filter((p) => !p.isActive);
  const done = () => {
    setAdding(null);
    setEditing(null);
    router.refresh();
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="sm" />
        <h4 className="font-medium">{lender.name}</h4>
        <span className="text-xs text-muted-foreground">
          {live.length === 0 ? "no terms yet" : `${live.length} ${live.length === 1 ? "product" : "products"}`}
        </span>
      </div>

      {LENDER_PRODUCT_KINDS.map((kind) => {
        const rows = live.filter((p) => p.product === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {PRODUCT_LABEL[kind]}
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((p) =>
                editing === p.id ? (
                  <li key={p.id} className="p-3">
                    <ProductForm lenderId={lender.id} kind={kind} existing={p} onDone={done} />
                  </li>
                ) : (
                  <ProductRow key={p.id} product={p} canEdit={canEdit} onEdit={() => setEditing(p.id)} />
                )
              )}
            </ul>
          </div>
        );
      })}

      {retired.length > 0 && (
        <details className="rounded-lg border border-dashed border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            {retired.length} retired
          </summary>
          <ul className="divide-y divide-border">
            {retired.map((p) =>
              editing === p.id ? (
                <li key={p.id} className="p-3">
                  <ProductForm
                    lenderId={lender.id}
                    kind={p.product as LenderProductKind}
                    existing={p}
                    onDone={done}
                  />
                </li>
              ) : (
                <ProductRow key={p.id} product={p} canEdit={canEdit} onEdit={() => setEditing(p.id)} />
              )
            )}
          </ul>
        </details>
      )}

      {canEdit && adding && (
        <div className="rounded-lg border border-border p-3">
          <ProductForm lenderId={lender.id} kind={adding} onDone={done} />
        </div>
      )}

      {canEdit && !adding && (
        <div className="flex flex-wrap gap-2">
          {LENDER_PRODUCT_KINDS.map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={() => setAdding(k)}>
              <Plus className="size-4" /> {PRODUCT_LABEL[k]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  product,
  canEdit,
  onEdit,
}: {
  product: LenderProduct;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const act = async (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    // A refusal here explains a data consequence — "12 deals were quoted from
    // this" — so it gets long enough to read.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(res.message ?? "Updated");
    router.refresh();
  };

  return (
    <li className="flex flex-wrap items-center gap-2 p-2.5 text-sm">
      <span className={cn("font-medium", !product.isActive && "text-muted-foreground line-through")}>
        {lenderProductLabel(product)}
      </span>
      {product.name && (
        <span className="text-xs text-muted-foreground">
          {lenderProductLabel({ ...product, name: null })}
        </span>
      )}
      {/* A factor-priced row prices differently from an amortised one, so the
          sheet has to show which this is at a glance. */}
      {product.factorWithPaydownMicros != null && (
        <span className="text-xs text-muted-foreground">
          factor {formatFactor(product.factorWithPaydownMicros)}
          {product.factorWithoutPaydownMicros != null &&
            ` / ${formatFactor(product.factorWithoutPaydownMicros)}`}
          {product.paydownPct != null && ` · ${product.paydownPct}% by mo ${product.paydownMonths}`}
        </span>
      )}
      {canEdit && (
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy} title="Edit these terms">
            <Pencil className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title={
              product.isActive
                ? "Retire — deals already quoted from it keep their terms"
                : "Offer it again"
            }
            onClick={() => act(() => setSolarLenderProductActiveAction(product.id, !product.isActive))}
          >
            {product.isActive ? <Archive className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Delete — refused if any deal was quoted from it"
            onClick={() => act(() => deleteSolarLenderProductAction(product.id))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </li>
  );
}

/** Empty string, not 0 — a real 0% escalator has to stay typeable. */
const str = (n: number | null | undefined, div = 1) => (n == null ? "" : String(n / div));
const intOrNull = (v: string, mul = 1) => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * mul) : null;
};
const floatOrNull = (v: string) => {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * One product's terms.
 *
 * Which fields it asks for is decided by the kind, because a loan and a PPA
 * share nothing but a term. One form of every field would invite an APR onto a
 * PPA — the same defect the deal side already guards against, one level up.
 */
function ProductForm({
  lenderId,
  kind,
  existing,
  onDone,
}: {
  lenderId: string;
  kind: LenderProductKind;
  existing?: LenderProduct;
  onDone: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    name: existing?.name ?? "",
    aprPct: str(existing?.aprPct),
    termMonths: str(existing?.termMonths),
    dealerFeePct: str(existing?.dealerFeePct),
    leaseRate: str(existing?.leaseRateCentsPerKwMonth, 100),
    rate: str(existing?.rateMillsPerKwh, 1000),
    escalatorPct: str(existing?.escalatorPct),
    termYears: str(existing?.termYears),
    factorWithPaydown: formatFactor(existing?.factorWithPaydownMicros),
    factorWithoutPaydown: formatFactor(existing?.factorWithoutPaydownMicros),
    paydownPct: str(existing?.paydownPct),
    paydownMonths: str(existing?.paydownMonths),
  });
  const [financesStorageOnly, setFinancesStorageOnly] = React.useState(
    existing?.financesStorageOnly ?? false
  );
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    const res = await upsertSolarLenderProductAction(existing?.id ?? null, {
      lenderId,
      product: kind,
      name: form.name.trim() || null,
      aprPct: floatOrNull(form.aprPct),
      termMonths: intOrNull(form.termMonths),
      dealerFeePct: floatOrNull(form.dealerFeePct),
      leaseRateCentsPerKwMonth: intOrNull(form.leaseRate, 100),
      rateMillsPerKwh: intOrNull(form.rate, 1000),
      escalatorPct: floatOrNull(form.escalatorPct),
      termYears: intOrNull(form.termYears),
      factorWithPaydown: floatOrNull(form.factorWithPaydown),
      factorWithoutPaydown: floatOrNull(form.factorWithoutPaydown),
      paydownPct: floatOrNull(form.paydownPct),
      paydownMonths: intOrNull(form.paydownMonths),
      financesStorageOnly,
    });
    setBusy(false);
    // The action names the missing field, so the message is worth showing.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(existing ? "Product updated" : "Product added");
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {kind === "loan" && (
          <>
            <NumField label="APR %" step="0.01" value={form.aprPct} onChange={(v) => set("aprPct", v)} />
            <NumField label="Term (months)" value={form.termMonths} onChange={(v) => set("termMonths", v)} />
            <NumField
              label="Dealer fee %"
              step="0.1"
              value={form.dealerFeePct}
              onChange={(v) => set("dealerFeePct", v)}
            />
          </>
        )}
        {kind === "lease" && (
          <NumField
            label="$/kW per month"
            step="0.01"
            value={form.leaseRate}
            onChange={(v) => set("leaseRate", v)}
          />
        )}
        {kind === "ppa" && (
          <NumField label="$/kWh" step="0.001" value={form.rate} onChange={(v) => set("rate", v)} />
        )}
        {kind !== "loan" && (
          <>
            <NumField
              label="Escalator %/yr"
              step="0.1"
              value={form.escalatorPct}
              onChange={(v) => set("escalatorPct", v)}
            />
            <NumField label="Term (years)" value={form.termYears} onChange={(v) => set("termYears", v)} />
          </>
        )}
        <TextField label="Name (optional)" value={form.name} onChange={(v) => set("name", v)} />
      </div>

      {/* The sheet's own payment arithmetic. A factor is NOT the amortised
          figure — it bakes in the fee and the promotional structure — so where
          one exists it outranks anything derived from the APR. Leave these
          blank and the payment is amortised from APR and term as before. */}
      {kind === "loan" && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Payment factors (optional)
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <NumField
              label="PMT factor — with paydown"
              step="0.000001"
              value={form.factorWithPaydown}
              onChange={(v) => set("factorWithPaydown", v)}
            />
            <NumField
              label="PMT factor — without paydown"
              step="0.000001"
              value={form.factorWithoutPaydown}
              onChange={(v) => set("factorWithoutPaydown", v)}
            />
            <NumField
              label="Paydown %"
              step="0.01"
              value={form.paydownPct}
              onChange={(v) => set("paydownPct", v)}
            />
            <NumField
              label="Paydown due by month"
              value={form.paydownMonths}
              onChange={(v) => set("paydownMonths", v)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Monthly payment = amount financed × factor, exactly as the rate sheet prints it. Both
            are shown on the deal, so a customer sees what the payment becomes if the paydown is
            never applied.
          </p>
        </div>
      )}

      {/* Storage-only eligibility. Off by default and per PRODUCT rather than
          per lender: a bank with one storage programme and three PV-only ones
          would otherwise read as funding batteries on all four, and the rep
          finds out at submission.

          Loans only. Cash has no lender paper to be eligible or not — a
          customer writing a cheque for a battery needs nobody's approval. */}
      {kind === "loan" && (
        <label className="flex items-start gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={financesStorageOnly}
            onChange={(e) => setFinancesStorageOnly(e.target.checked)}
          />
          <span>
            Funds storage-only deals
            <span className="block text-[11px] text-muted-foreground">
              Tick only if this paper funds a battery with no array on the roof. Storage deals are
              offered nothing else.
            </span>
          </span>
        </label>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {existing ? "Save" : "Add product"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * A price per watt, between the box a person types in and the cents stored.
 *
 * Blank is a real answer here and means "no ceiling", so it is kept distinct
 * from a bad one: `null` clears the cap, `"invalid"` is a typo to be reported.
 * Collapsing the two would let a mistyped cap silently clear a lender's ceiling
 * and put every deal on that partner back at the ungoverned price.
 */
function ppwToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 50 && cents <= 2000 ? cents : "invalid";
}

const ppwToDollars = (cents: number | null) => (cents == null ? "" : (cents / 100).toFixed(2));

/**
 * A price per BATTERY, typed in whole dollars.
 *
 * Separate from `ppwToCents` because the ranges are three orders of magnitude
 * apart: $0.50–$20.00 a watt against $500–$100,000 a battery. One function
 * covering both would have to accept a range so wide it validates nothing, and
 * a $9.00 typo where $9,000 was meant would sail through it.
 */
function batteryPriceToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 500_00 && cents <= 100_000_00 ? cents : "invalid";
}

const batteryPriceToDollars = (cents: number | null) =>
  cents == null ? "" : String(Math.round(cents / 100));

/**
 * The programme contribution, typed in whole dollars.
 *
 * A third range, for the same reason there is already a second: this figure is
 * $70,000 where a battery is $13,000 and a watt is $5.50, and a validator wide
 * enough to accept all three accepts every typo as well. $1 to $5,000,000.
 *
 * The three-way return matters as much here as on the cap: `null` turns the
 * contribution off, `"invalid"` is a mistake to report. Collapsing them would
 * let a slipped keystroke quietly stop a partner's contract being adjusted at
 * all, and the deals generated afterwards would simply look ordinary.
 */
function adjustmentToCents(s: string): number | null | "invalid" {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return "invalid";
  const cents = Math.round(n * 100);
  return cents >= 100 && cents <= 5_000_000_00 ? cents : "invalid";
}

function TextField({
  label,
  value,
  onChange,
  placeholder = "falls back to the terms",
}: {
  placeholder?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <Label className="text-xs" htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function LinkChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      {label} <ExternalLink className="size-3" />
    </a>
  );
}

/**
 * Giving a lender its logo.
 *
 * Two ways in, because both are the fastest way in different situations. Most
 * partners already publish a perfectly good mark on their own website, so one
 * button reads it off there — and when that fails, or when the marketing team
 * hands you the proper asset, the file picker is right beside it.
 *
 * Lives inside the edit panel rather than on the face of the card: a logo is
 * set once per partner and then never touched, and a permanent upload control
 * on every card would be eight buttons nobody clicks.
 */
function LogoControl({ lender }: { lender: LenderRow }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<null | "upload" | "fetch" | "remove">(null);
  const [site, setSite] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);
  const anyBusy = busy !== null;

  async function upload(file: File) {
    setBusy("upload");
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadSolarLenderLogoAction(lender.id, fd);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Logo updated");
    router.refresh();
  }

  async function grab() {
    setBusy("fetch");
    const res = await fetchSolarLenderLogoAction(lender.id, site.trim() || null);
    setBusy(null);
    // A refusal here explains where we looked and what we found, so it needs
    // long enough to read before it disappears.
    if (!res.ok) return toast.error(res.error, { duration: 9000 });
    toast.success(`Took ${res.source} from ${res.from}`);
    setSite("");
    router.refresh();
  }

  async function remove() {
    setBusy("remove");
    const res = await removeSolarLenderLogoAction(lender.id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Logo removed");
    router.refresh();
  }

  const spinner = (which: typeof busy) =>
    busy === which ? <Loader2 className="size-4 animate-spin" /> : null;

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3">
      <div className="flex items-center gap-3">
        <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">Logo</p>
          <p className="text-[11px] text-muted-foreground">
            {lender.logoUrl
              ? "Shown next to this lender everywhere, including the customer's proposal."
              : "None yet — this lender shows its initials until one is set."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label={`Logo file for ${lender.name}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset first: picking the same file twice must fire onChange twice.
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={anyBusy}
          onClick={() => fileRef.current?.click()}
        >
          {spinner("upload") ?? <Upload className="size-4" />} Upload
        </Button>
        <Button size="sm" variant="outline" disabled={anyBusy} onClick={grab}>
          {spinner("fetch") ?? <Globe className="size-4" />} Grab from website
        </Button>
        {lender.logoUrl && (
          <Button size="sm" variant="ghost" disabled={anyBusy} onClick={remove}>
            {spinner("remove") ?? <ImageOff className="size-4" />} Remove
          </Button>
        )}
      </div>

      <Input
        value={site}
        placeholder="goodleap.com — optional, only if the links above are not the right site"
        aria-label={`Website to take ${lender.name}'s logo from`}
        onChange={(e) => setSite(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void grab();
          }
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        PNG, JPG or WebP, up to 5MB. Left blank, &ldquo;Grab from website&rdquo; uses the
        application link, or the dealer portal if there is no application link.
      </p>
    </div>
  );
}

/** Whole dollars, as this screen writes money everywhere else. */
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/** One line of the disclosure preview's three-figure reconciliation. */
function PreviewRow({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "border-t border-border pt-0.5 font-semibold"
      )}
    >
      <dt className={strong ? "" : "text-muted-foreground"}>{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}

/**
 * The lender edit form, seeded from the row.
 *
 * Every value is a STRING because these are text inputs, and a controlled input
 * handed a null renders React's uncontrolled-component warning and then eats the
 * first keystroke. Parsed back on save, where an empty box means "clear it".
 */
function draftFrom(lender: LenderRow) {
  return {
    name: lender.name,
    notes: lender.notes ?? "",
    portalUrl: lender.portalUrl ?? "",
    applyUrl: lender.applyUrl ?? "",
    creditInstructions: lender.creditInstructions ?? "",
    repPayMode: lender.repPayMode,
    maxFinalPpw: ppwToDollars(lender.maxFinalPpwCents),
    finalPpwMode: lender.finalPpwMode,
    minBasePpw: ppwToDollars(lender.minBasePpwCents),
    maxFinalBattery: batteryPriceToDollars(lender.maxFinalPricePerBatteryCents),
    finalBatteryPriceMode: lender.finalBatteryPriceMode,
    minBaseBattery: batteryPriceToDollars(lender.minBasePricePerBatteryCents),
    batteryRule: lender.batteryRule,
    adjustmentEnabled: lender.contractAdjustmentEnabled,
    adjustmentAmount:
      lender.contractAdjustmentCents == null
        ? ""
        : String(Math.round(lender.contractAdjustmentCents / 100)),
    adjustmentLabel: lender.contractAdjustmentLabel ?? "",
    adjustmentDisclosure: lender.contractAdjustmentDisclosure ?? "",
    adjustmentEffectiveAt: lender.contractAdjustmentEffectiveAt ?? "",
    ownershipDisclosure: lender.ownershipDisclosure ?? "",
  };
}

function LenderCard({
  lender,
  sellableEquipment,
  canEdit,
  adderCatalogue,
}: {
  lender: LenderRow;
  sellableEquipment: number;
  canEdit: boolean;
  /** Only for the summary line — the rules themselves are set below the cards. */
  adderCatalogue: AdderRuleOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  /**
   * The most this lender's own ceiling can leave the company, per watt.
   *
   * Worth spelling out beside the floor box because the two interact in a way
   * that is not obvious from either one: a capped partner funds one number, so
   * whatever base is typed, only `cap × (1 − fee)` survives. Amos caps at
   * $5.50/W on a 65% fee, which is $1.93 — set a $3.00 floor there and every
   * deal on that partner blocks, with nothing on the screen having warned you.
   *
   * Taken against the LOWEST fee on the rate sheet, because that is the
   * programme that leaves the most; a floor above this is unreachable on any of
   * them. Null when there is no cap, or no priced product to read a fee from.
   */
  const capBasePpwCents = React.useMemo(() => {
    if (lender.maxFinalPpwCents == null) return null;
    const fees = lender.products
      .filter((p) => p.isActive && p.dealerFeePct != null)
      .map((p) => p.dealerFeePct as number);
    if (fees.length === 0) return null;
    return basePpwFromSticker(lender.maxFinalPpwCents, Math.min(...fees));
  }, [lender.maxFinalPpwCents, lender.products]);

  const [editing, setEditing] = React.useState(false);
  // ONE definition of what the form is seeded from, used by both the initial
  // state and Cancel. Two copies of this literal is how a field gets added to
  // the form, saves correctly, and then silently fails to come back when
  // somebody cancels out of it.
  const [draft, setDraft] = React.useState(() => draftFrom(lender));
  const resetDraft = () => setDraft(draftFrom(lender));

  /**
   * The disclosure as a homeowner will actually read it, with figures in it.
   *
   * THE POINT OF THE WHOLE BLOCK. An admin typing `{contractValue}` into a
   * textarea has no way to tell what the sentence comes out as, and the
   * sentence with the numbers in it is the thing they are approving — a
   * template that reads fine and renders "A $70,000 reduces…" is a mistake
   * nobody catches until it is on somebody's paper.
   *
   * Worked on THIS partner's own published rate where it has one, because that
   * is what its deals actually price at. A partner that publishes none gets a
   * round, plainly-labelled illustrative price instead: an example that is
   * obviously an example beats one that could be mistaken for a quote.
   */
  const adjustmentPreview = React.useMemo(() => {
    if (!draft.adjustmentEnabled) return null;
    const cents = adjustmentToCents(draft.adjustmentAmount);
    if (cents === "invalid" || cents == null) return null;
    const label = draft.adjustmentLabel.trim();
    const template = draft.adjustmentDisclosure.trim();
    if (!label || !template) return null;

    const EXAMPLE_KW = 8.8;
    const priced = lender.maxFinalPpwCents != null;
    const obligationCents = priced
      ? Math.round(EXAMPLE_KW * 1000 * lender.maxFinalPpwCents!)
      : 100_000_00;

    const r = reconcileContract({
      customerObligationCents: obligationCents,
      adjustment: { enabled: true, fixedCents: cents, label, disclosure: template },
      lenderName: draft.name.trim() || lender.name,
    });
    if (!r) return null;

    return {
      exampleLabel: priced
        ? `${EXAMPLE_KW.toFixed(2)} kW at $${(lender.maxFinalPpwCents! / 100).toFixed(2)}/W`
        : "on an example $100,000 customer price",
      contractValue: money(r.lenderContractValueCents),
      adjustment: money(r.adjustmentCents),
      obligation: money(r.customerObligationCents),
      disclosure: r.disclosure,
    };
  }, [
    draft.adjustmentEnabled,
    draft.adjustmentAmount,
    draft.adjustmentLabel,
    draft.adjustmentDisclosure,
    draft.name,
    lender.name,
    lender.maxFinalPpwCents,
  ]);

  type ActionResult = { ok: boolean; error?: string; message?: string };
  const act = async (fn: () => Promise<ActionResult>, fallback: string): Promise<ActionResult> => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error, { duration: 9000 });
      return res;
    }
    toast.success(res.message ?? fallback);
    router.refresh();
    return res;
  };

  async function save() {
    if (!draft.name.trim()) return toast.error("A lender needs a name.");

    // Caught here rather than left to the server so the message names the box.
    // A cap is the one field on this card that silently rewrites what every
    // deal on this partner quotes, and "Invalid lender." would send somebody
    // looking at the URL fields.
    const maxFinalPpwCents = ppwToCents(draft.maxFinalPpw);
    if (maxFinalPpwCents === "invalid") {
      return toast.error("Max final $/W has to be a price between $0.50 and $20.00, or blank for no cap.");
    }
    const minBasePpwCents = ppwToCents(draft.minBasePpw);
    if (minBasePpwCents === "invalid") {
      return toast.error("Min base $/W has to be a price between $0.50 and $20.00, or blank for no floor.");
    }

    const maxFinalPricePerBatteryCents = batteryPriceToCents(draft.maxFinalBattery);
    if (maxFinalPricePerBatteryCents === "invalid") {
      return toast.error("Max final $/battery has to be between $500 and $100,000, or blank for no cap.");
    }
    const minBasePricePerBatteryCents = batteryPriceToCents(draft.minBaseBattery);
    if (minBasePricePerBatteryCents === "invalid") {
      return toast.error("Min base $/battery has to be between $500 and $100,000, or blank for no floor.");
    }

    // The contribution, in whole dollars. Caught here so the message names the
    // box: this is the one figure on the card that writes itself onto a
    // contract, and a silent NaN would switch the programme on with nothing
    // behind it.
    const contractAdjustmentCents = adjustmentToCents(draft.adjustmentAmount);
    if (contractAdjustmentCents === "invalid") {
      return toast.error(
        "The contract adjustment has to be an amount between $1 and $5,000,000, or blank for none."
      );
    }
    if (draft.adjustmentEnabled) {
      if (contractAdjustmentCents == null) {
        return toast.error("Set the adjustment amount before switching the contract adjustment on.");
      }
      if (!draft.adjustmentLabel.trim()) {
        return toast.error(
          "Give the adjustment the approved customer-facing label — exactly the words the proposal should print."
        );
      }
      if (!draft.adjustmentDisclosure.trim()) {
        return toast.error(
          "Write the customer disclosure — the paragraph that says who is responsible for which amount."
        );
      }
    }

    const res = await act(
      () =>
        upsertSolarLenderAction(lender.id, {
          name: draft.name.trim(),
          notes: draft.notes.trim() || null,
          portalUrl: draft.portalUrl.trim() || null,
          applyUrl: draft.applyUrl.trim() || null,
          creditInstructions: draft.creditInstructions.trim() || null,
          repPayMode: draft.repPayMode,
          maxFinalPpwCents,
          finalPpwMode: draft.finalPpwMode,
          minBasePpwCents,
          maxFinalPricePerBatteryCents,
          finalBatteryPriceMode: draft.finalBatteryPriceMode,
          minBasePricePerBatteryCents,
          batteryRule: draft.batteryRule,
          contractAdjustmentEnabled: draft.adjustmentEnabled,
          contractAdjustmentType: "fixed",
          contractAdjustmentCents,
          contractAdjustmentLabel: draft.adjustmentLabel.trim() || null,
          contractAdjustmentDisclosure: draft.adjustmentDisclosure.trim() || null,
          contractAdjustmentEffectiveAt: draft.adjustmentEffectiveAt.trim() || null,
          ownershipDisclosure: draft.ownershipDisclosure.trim() || null,
        }),
      "Saved"
    );
    if (res.ok) setEditing(false);
  }

  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        lender.isActive ? "border-border" : "border-dashed border-border opacity-70"
      }`}
    >
      {editing ? (
        <div className="space-y-2">
          <LogoControl lender={lender} />
          <TextField
            label="Lender name"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          />
          <TextField
            label="Notes"
            value={draft.notes}
            onChange={(v) => setDraft((d) => ({ ...d, notes: v }))}
          />
          {/* Two links, never one. The portal is your dealer login; the apply
              link is what a homeowner opens from the proposal. One shared
              field is how a back office ends up in front of a customer. */}
          <TextField
            label="Dealer portal — where your team runs credit"
            value={draft.portalUrl}
            onChange={(v) => setDraft((d) => ({ ...d, portalUrl: v }))}
          />
          <TextField
            label="Customer application link — the proposal's Qualify button"
            value={draft.applyUrl}
            onChange={(v) => setDraft((d) => ({ ...d, applyUrl: v }))}
          />
          {/* Pay mode is a property of the PARTNER, not of the rep — a fixed-pay
              lender pays a flat rate to everyone, and the alternative is that
              somebody hardcodes a name check on "Amos" that a rename breaks. */}
          <div className="space-y-1 rounded-lg border border-gold/30 bg-gold/5 p-2.5">
            <Label className="text-xs">How reps are paid on this lender</Label>
            <Select
              value={draft.repPayMode}
              onValueChange={(v) => setDraft((d) => ({ ...d, repPayMode: v as LenderRow["repPayMode"] }))}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="redline">Redline — rep keeps everything above their own net $/W</SelectItem>
                <SelectItem value="per_watt">Fixed $/W — rep earns their flat rate per installed watt</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Each rep&rsquo;s own redline and fixed rate live on their{" "}
              <Link href="/portal/team" className="underline underline-offset-2">team profile</Link>.
              Changing this only affects deals whose commission hasn&rsquo;t been generated yet.
            </p>
          </div>

          {/* WHAT THIS PARTNER CHARGES A HOMEOWNER, and whether that is a
              limit or the whole price list. Some partners fund a flat rate
              whatever the job — Amos is $5.50/W — and priced the ordinary way
              their dealer fee stickers that at three times the figure they
              actually advance.

              The mode sits WITH the figure rather than in its own section: on
              its own "cap or flat" is a question about nothing, and the two
              only ever mean anything together. */}
          <div className="space-y-1 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <TextField
              label="Final $/W — what this partner charges a homeowner"
              value={draft.maxFinalPpw}
              placeholder="blank — prices the normal way"
              onChange={(v) => setDraft((d) => ({ ...d, maxFinalPpw: v }))}
            />
            {draft.maxFinalPpw.trim() !== "" && (
              <Select
                value={draft.finalPpwMode}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, finalPpwMode: v as LenderRow["finalPpwMode"] }))
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cap">Maximum — a cheaper deal quotes cheaper</SelectItem>
                  <SelectItem value="flat">Flat price — every deal is this figure</SelectItem>
                </SelectContent>
              </Select>
            )}
            <p className="text-[11px] text-muted-foreground">
              Dealer fee and adders included. Leave blank and this lender prices the normal way:
              your base $/W grossed up by its fee.{" "}
              {draft.finalPpwMode === "flat"
                ? "On FLAT, this is the price — the base you type on a deal and any extra work never move it, they only change what you keep."
                : "On MAXIMUM, the contract is held at or under this figure — so extra work comes out of what you keep, not out of the customer's price."}
            </p>
          </div>

          {/* The same two rules, on a deal with no watts.
              A storage job has no array for a $/W figure to be per, so the pair
              above cannot reach it — they would divide by zero and wave every
              price through. These are the same ceiling and the same floor,
              measured per battery. Grouped and labelled so nobody sets one
              believing it guards a solar deal. */}
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <p className="text-xs font-medium">Storage-only deals</p>
            <p className="text-[11px] text-muted-foreground">
              A battery job has no watts, so the two figures above do not apply to it. These do.
              Leave both blank if this lender does not fund storage on its own.
            </p>
            <TextField
              label="Final $/battery — what this partner charges a homeowner"
              value={draft.maxFinalBattery}
              placeholder="blank — prices the normal way"
              onChange={(v) => setDraft((d) => ({ ...d, maxFinalBattery: v }))}
            />
            {draft.maxFinalBattery.trim() !== "" && (
              <Select
                value={draft.finalBatteryPriceMode}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, finalBatteryPriceMode: v as LenderRow["finalBatteryPriceMode"] }))
                }
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cap">Maximum — a cheaper deal quotes cheaper</SelectItem>
                  <SelectItem value="flat">Flat price — every battery is this figure</SelectItem>
                </SelectContent>
              </Select>
            )}
            <TextField
              label="Min base $/battery — the least these deals may leave you"
              value={draft.minBaseBattery}
              placeholder="blank — no floor"
              onChange={(v) => setDraft((d) => ({ ...d, minBaseBattery: v }))}
            />
            <p className="text-[11px] text-muted-foreground">
              Measured before the dealer fee, on what survives it — the same rule as the $/W floor
              above. A deal under this cannot be quoted or generated.
            </p>
          </div>

          {/* WHETHER THIS PARTNER WILL FUND AN ARRAY WITH NO BATTERY.
              The app used to hold one opinion about this for every lender —
              a note on every batteryless design, unswitchable — which is
              neither true of the partners that do not care nor binding on the
              ones that will decline the file. */}
          <div className="space-y-1 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <Label className="text-xs">A system with no battery on it</Label>
            <Select
              value={draft.batteryRule}
              onValueChange={(v) =>
                setDraft((d) => ({ ...d, batteryRule: v as LenderRow["batteryRule"] }))
              }
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="optional">Fine — say nothing</SelectItem>
                <SelectItem value="warn">Flag it, but let the proposal out</SelectItem>
                <SelectItem value="required">Battery required — block the proposal</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {draft.batteryRule === "required"
                ? "A grid-tied design on this partner cannot be generated at all. Use this for paper that will not fund PV without storage — better a rep finds out here than at submission."
                : draft.batteryRule === "optional"
                  ? "Nothing is said and nothing is stopped. The proposal still tells the homeowner a grid-tied system shuts off in an outage."
                  : "The readiness report flags it and the rep can carry on. This is what every lender did before this setting existed."}
            </p>
          </div>

          {/* The other end of the same deal. The ceiling above is about the
              CUSTOMER'S number; this is about YOURS, which is why the two are
              set separately and neither is derived from the other. */}
          <div className="space-y-1 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <TextField
              label="Min base $/W — the least this partner's deals may leave you"
              value={draft.minBasePpw}
              placeholder="blank — no floor"
              onChange={(v) => setDraft((d) => ({ ...d, minBasePpw: v }))}
            />
            <p className="text-[11px] text-muted-foreground">
              Measured before the dealer fee, on what actually survives it — so on a capped
              lender it is what the cap leaves you, not what the rep typed. A deal under this
              cannot be quoted or generated.
              {capBasePpwCents != null && (
                <>
                  {" "}
                  This lender&rsquo;s cap and fee leave at most{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    ${ppwToDollars(capBasePpwCents)}/W
                  </span>
                  , so a floor above that blocks every deal on it.
                </>
              )}
            </p>
          </div>

          {/* ── THE PROGRAMME CONTRIBUTION ─────────────────────────────────
              The only setting on this card where the contract and the
              customer's obligation stop being the same number. Everything
              above prices what a homeowner pays; this says what the partner's
              paper is written at on top of it.

              Its own bordered block, last, and worded as a whole sentence
              rather than as four loose fields, because an admin filling it in
              is making a legal characterisation of somebody else's money and
              needs to see all of it at once. */}
          <div className="space-y-2 rounded-lg border border-solar/40 bg-solar/5 p-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">Contract adjustment</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  For a partner whose contract is written for MORE than the customer owes — a
                  prepaid-lease programme where a fixed contribution comes off the contract value.
                  Off on every other lender, and off is what changes nothing.
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-1.5 text-[11px]">
                <input
                  type="checkbox"
                  className="size-3.5 accent-solar"
                  checked={draft.adjustmentEnabled}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, adjustmentEnabled: e.target.checked }))
                  }
                />
                Enabled
              </label>
            </div>

            {draft.adjustmentEnabled && (
              <>
                {/* One member today. Shown as a stated fact rather than as a
                    select with nothing to choose — a dropdown with one option
                    is a question that wastes somebody's time. */}
                <p className="text-[11px] text-muted-foreground">
                  Adjustment type: <span className="font-medium text-foreground">Fixed dollar amount</span>
                </p>
                <TextField
                  label="Fixed contract adjustment"
                  value={draft.adjustmentAmount}
                  placeholder="70000"
                  onChange={(v) => setDraft((d) => ({ ...d, adjustmentAmount: v }))}
                />
                <TextField
                  label="Customer-facing label — the approved term, printed as typed"
                  value={draft.adjustmentLabel}
                  placeholder="Participate Program Contribution"
                  onChange={(v) => setDraft((d) => ({ ...d, adjustmentLabel: v }))}
                />
                <p className="text-[11px] text-muted-foreground">
                  Whatever is typed here is what the customer&rsquo;s proposal prints. Do not call
                  it a discount, a rebate, an incentive or a tax credit unless that is the approved
                  term for this programme — they are different claims about who owes what.
                </p>

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`ld-${lender.id}-disclosure`}>
                    Customer disclosure — the paragraph that reconciles the figures
                  </Label>
                  <Textarea
                    id={`ld-${lender.id}-disclosure`}
                    rows={4}
                    value={draft.adjustmentDisclosure}
                    placeholder={DISCLOSURE_TEMPLATE_SUGGESTION}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, adjustmentDisclosure: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    The figures are substituted in at generation, so no dollar amount is typed
                    here:{" "}
                    {DISCLOSURE_TOKENS.map((t, i) => (
                      <React.Fragment key={t.token}>
                        {i > 0 && ", "}
                        <code className="rounded bg-muted px-1 py-px">{t.token}</code> {t.means}
                      </React.Fragment>
                    ))}
                    .
                  </p>
                  {draft.adjustmentDisclosure.trim() === "" && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          adjustmentDisclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
                        }))
                      }
                    >
                      Start from the suggested wording
                    </Button>
                  )}
                </div>

                {/* The preview is the point of this block. An admin typing
                    tokens into a textarea cannot otherwise tell what a
                    homeowner will read, and the sentence they are approving is
                    the sentence with the numbers in it. */}
                {adjustmentPreview && (
                  <div className="rounded-lg border border-border bg-background p-2.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      What the customer reads — {adjustmentPreview.exampleLabel}
                    </p>
                    <dl className="mt-1.5 space-y-0.5 text-[11px]">
                      <PreviewRow k="Adjusted contract value" v={adjustmentPreview.contractValue} />
                      <PreviewRow
                        k={draft.adjustmentLabel.trim() || "Programme adjustment"}
                        v={`−${adjustmentPreview.adjustment}`}
                      />
                      <PreviewRow k="Customer obligation" v={adjustmentPreview.obligation} strong />
                    </dl>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      {adjustmentPreview.disclosure}
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs" htmlFor={`ld-${lender.id}-effective`}>
                    Effective from
                  </Label>
                  <Input
                    id={`ld-${lender.id}-effective`}
                    type="date"
                    value={draft.adjustmentEffectiveAt}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, adjustmentEffectiveAt: e.target.value }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Blank means it is already running. A future date configures the programme now
                    and starts it then — proposals generated before it quote no adjustment at all.
                    Nothing here is ever retroactive: a generated proposal is frozen, so changing
                    any of this moves only versions made afterwards.
                  </p>
                </div>
              </>
            )}

            {/* Kept OUTSIDE the enabled branch. A partner can publish its own
                ownership wording without running a contribution, and the
                sentence this replaces — "you own it outright, and it transfers
                with the house" — is on every financed proposal whether or not
                any money is being adjusted. */}
            <div className="space-y-1 border-t border-border/70 pt-2">
              <Label className="text-xs" htmlFor={`ld-${lender.id}-ownership`}>
                What the customer ends up owning, in this partner&rsquo;s words
              </Label>
              <Textarea
                id={`ld-${lender.id}-ownership`}
                rows={3}
                value={draft.ownershipDisclosure}
                placeholder="Ownership, term, transfer on sale, and any buyout — as this product actually works."
                onChange={(e) => setDraft((d) => ({ ...d, ownershipDisclosure: e.target.value }))}
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank and the proposal keeps its own sentence: that the customer owns the
                system outright, it carries its manufacturer warranties, and it transfers with the
                house. That is true of a loan. Write something here for any product where it is
                not.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs" htmlFor={`ld-${lender.id}-credit`}>
              How to run credit with this partner
            </Label>
            <Textarea
              id={`ld-${lender.id}-credit`}
              rows={3}
              value={draft.creditInstructions}
              placeholder="The steps a rep needs — which portal, what to have ready, who to call when it stips."
              onChange={(e) => setDraft((d) => ({ ...d, creditInstructions: e.target.value }))}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Only the customer application link ever reaches a proposal. The dealer portal stays
            inside the CRM.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { resetDraft(); setEditing(false); }}>
              <X className="size-4" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {/* The mark is the button. Hiding "add a logo" behind the pencil
                  meant the answer to "can we put the bank's logo here?" was
                  yes and invisible, so the thing you would click anyway is
                  what opens it. */}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title={lender.logoUrl ? `Change ${lender.name}'s logo` : `Add ${lender.name}'s logo`}
                  className="group relative shrink-0 rounded-lg ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="md" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-foreground/70 opacity-0 transition-opacity group-hover:opacity-100">
                    <ImagePlus className="size-4 text-background" />
                  </span>
                </button>
              ) : (
                <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="md" />
              )}
              <span className="truncate font-medium">{lender.name}</span>
            </div>
            {!lender.isActive && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                retired
              </span>
            )}
          </div>

          {lender.notes && <p className="mt-1.5 text-xs text-muted-foreground">{lender.notes}</p>}

          {(lender.portalUrl || lender.applyUrl) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {lender.portalUrl && <LinkChip href={lender.portalUrl} label="Dealer portal" />}
              {lender.applyUrl && <LinkChip href={lender.applyUrl} label="Customer application" />}
            </div>
          )}

          {lender.creditInstructions && (
            <details className="mt-2 rounded-lg border border-border/70 p-2">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                How to run credit
              </summary>
              <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted-foreground">
                {lender.creditInstructions}
              </p>
            </details>
          )}

          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Approved equipment</dt>
              <dd className="tabular-nums font-medium">
                {lender.approvedCount}
                {sellableEquipment > 0 && (
                  <span className="text-muted-foreground"> / {sellableEquipment}</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Deals designed for it</dt>
              <dd className="tabular-nums font-medium">{lender.dealCount}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Rep pay</dt>
              <dd className="font-medium">
                {lender.repPayMode === "per_watt" ? (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-muted">Fixed $/W</span>
                ) : (
                  <span className="text-muted-foreground">Redline</span>
                )}
              </dd>
            </div>
            {/* Only shown once set. A "Max final $/W — none" line on every one
                of a dozen uncapped lenders is a column of dashes teaching
                nobody anything. */}
            {lender.maxFinalPpwCents != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {lender.finalPpwMode === "flat" ? "Flat final $/W" : "Max final $/W"}
                </dt>
                <dd className="font-medium tabular-nums">
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-muted">
                    ${ppwToDollars(lender.maxFinalPpwCents)}/W
                  </span>
                </dd>
              </div>
            )}
            {lender.minBasePpwCents != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Min base $/W</dt>
                <dd className="font-medium tabular-nums">
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-muted">
                    ${ppwToDollars(lender.minBasePpwCents)}/W
                  </span>
                </dd>
              </div>
            )}
            {/* Only where a price exists for work to sit on top OF. On an
                uncapped partner every adder is quoted the ordinary way and the
                count would be a number about nothing. */}
            {lender.maxFinalPpwCents != null && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Adders on top</dt>
                <dd className="font-medium tabular-nums">
                  {adderOnTopCount(lender, adderCatalogue)}
                  <span className="text-muted-foreground"> / {adderCatalogue.length}</span>
                </dd>
              </div>
            )}
            {/* The one setting on this card that makes a contract read for more
                than the customer owes. Shown whenever it is ON, and never when
                it is off — which is every other lender. */}
            {lender.contractAdjustmentEnabled && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">
                  {lender.contractAdjustmentLabel?.trim() || "Contract adjustment"}
                </dt>
                <dd className="font-medium tabular-nums">
                  <span className="rounded-full bg-solar/15 px-2 py-0.5 text-[11px] text-solar">
                    {lender.contractAdjustmentCents == null
                      ? "amount not set"
                      : `+${money(lender.contractAdjustmentCents)}`}
                    {lender.contractAdjustmentEffectiveAt
                      ? ` from ${lender.contractAdjustmentEffectiveAt}`
                      : ""}
                  </span>
                </dd>
              </div>
            )}
            {lender.batteryRule !== "warn" && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">No battery</dt>
                <dd className="font-medium">
                  {lender.batteryRule === "required" ? (
                    <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-muted">
                      Blocked
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Allowed, no note</span>
                  )}
                </dd>
              </div>
            )}
          </dl>

          {/* A lender approving nothing produces empty equipment lists on every
              deal that selects it. Better to say so here than to let a rep meet
              it mid-build. */}
          {lender.isActive && lender.approvedCount === 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
              No equipment approved yet — a deal on this lender will show empty lists.{" "}
              <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
                Tag equipment
              </Link>
              .
            </p>
          )}

          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="px-2 text-xs text-muted-foreground"
              >
                <ImagePlus className="size-4" /> {lender.logoUrl ? "Change logo" : "Add logo"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)} title="Edit name, links and credit instructions">
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                title={lender.isActive ? "Retire — deals already built for it keep working" : "Make available again"}
                onClick={() => act(() => setSolarLenderActiveAction(lender.id, !lender.isActive), "Updated")}
              >
                {lender.isActive ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                title="Delete — refused if any deal is being built for it"
                onClick={() => act(() => deleteSolarLenderAction(lender.id), "Deleted")}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
