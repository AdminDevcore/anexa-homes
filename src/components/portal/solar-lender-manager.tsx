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
}: {
  lenders: LenderRow[];
  sellableEquipment: number;
  canEdit: boolean;
  /** From Solar Settings. Null = the sticker is not derived from a dealer fee. */
  targetNetPpwCents: number | null;
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
              <LenderCard key={l.id} lender={l} sellableEquipment={sellableEquipment} canEdit={canEdit} />
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
              <LenderCard key={l.id} lender={l} sellableEquipment={sellableEquipment} canEdit={canEdit} />
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
    </div>
  );
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

function LenderCard({
  lender,
  sellableEquipment,
  canEdit,
}: {
  lender: LenderRow;
  sellableEquipment: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState({
    name: lender.name,
    notes: lender.notes ?? "",
    portalUrl: lender.portalUrl ?? "",
    applyUrl: lender.applyUrl ?? "",
    creditInstructions: lender.creditInstructions ?? "",
    repPayMode: lender.repPayMode,
    maxFinalPpw: ppwToDollars(lender.maxFinalPpwCents),
  });
  const resetDraft = () =>
    setDraft({
      name: lender.name,
      notes: lender.notes ?? "",
      portalUrl: lender.portalUrl ?? "",
      applyUrl: lender.applyUrl ?? "",
      creditInstructions: lender.creditInstructions ?? "",
      repPayMode: lender.repPayMode,
      maxFinalPpw: ppwToDollars(lender.maxFinalPpwCents),
    });

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

          {/* A CEILING on what the customer signs, not a price list. Some
              partners fund a flat rate whatever the job — Amos is $5.50/W —
              and priced the ordinary way their dealer fee stickers that at
              three times the figure they actually advance. */}
          <div className="space-y-1 rounded-lg border border-border/70 bg-muted/30 p-2.5">
            <TextField
              label="Max final $/W — the most this partner ever charges a homeowner"
              value={draft.maxFinalPpw}
              placeholder="blank — no cap"
              onChange={(v) => setDraft((d) => ({ ...d, maxFinalPpw: v }))}
            />
            <p className="text-[11px] text-muted-foreground">
              Dealer fee and adders included. Leave blank and this lender prices the normal way:
              your base $/W grossed up by its fee. Set it and the contract is held at or under
              this figure — so extra work comes out of what you keep, not out of the
              customer&rsquo;s price.
            </p>
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
                <dt className="text-muted-foreground">Max final $/W</dt>
                <dd className="font-medium tabular-nums">
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-muted">
                    ${ppwToDollars(lender.maxFinalPpwCents)}/W
                  </span>
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
