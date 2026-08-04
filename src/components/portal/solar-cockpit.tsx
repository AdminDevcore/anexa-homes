"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2, Check, ChevronRight, FileText, Upload, ListTodo, UserPlus,
  Sun, Pencil, Lock, Sparkles, Send,
} from "lucide-react";
import type { FeedChannel, MilestonePayee } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SOLAR_FOLDERS } from "@/lib/solar-folders";
import {
  postDealFeedAction,
  inviteHomeownerAction,
  upsertSolarMilestoneAction,
} from "@/server/modules/solar/cockpit-actions";

const usd = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdc = (c: number) =>
  (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

// The stage bar used to live here. Nothing about it was solar-specific, so it
// now serves both verticals from `deal-stage-bar.tsx` (DealStageBar).

// ---------------------------------------------------------------------------
// 1 · System & money
// ---------------------------------------------------------------------------

export type MilestoneLite = {
  id: string;
  payee: MilestonePayee;
  sequence: number;
  label: string;
  amountCents: number;
  trigger: string | null;
  expectedAt: string | null;
  paidAt: string | null;
};

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
  dealerFeeCents: number;
  dealerFeePpwCents: number;
  finalPpwCents: number;
  contractPriceCents: number;
};

export function SolarSystemMoneyPanel({
  leadId,
  money,
  milestones,
  canEdit,
}: {
  leadId: string;
  money: SystemMoney | null;
  milestones: MilestoneLite[];
  canEdit: boolean;
}) {
  if (!money) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a system design and financing in the Proposal tab and the numbers appear here.
      </p>
    );
  }
  const rep = milestones.filter((m) => m.payee === "rep").sort((a, b) => a.sequence - b.sequence);
  const fin = milestones.filter((m) => m.payee === "financier").sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="System size" value={`${money.sizeKwDc.toFixed(2)} kW`} />
        <Metric label="Year-1 production" value={`${money.year1ProductionKwh.toLocaleString()} kWh`} />
        <Metric label="Offset" value={`${Math.round(money.offsetPct)}%`} />
        <Metric label="System cost" value={usd(money.contractPriceCents)} />
      </div>

      <dl className="divide-y divide-border text-sm">
        {money.moduleLabel && <SpecRow k="Modules" v={`${money.moduleQty} × ${money.moduleLabel}`} />}
        {money.inverterLabel && <SpecRow k="Inverter" v={money.inverterLabel} />}
        {money.batteryLabel && <SpecRow k="Battery" v={money.batteryLabel} />}
        {money.product && <SpecRow k="Financing" v={money.product.toUpperCase()} />}
      </dl>

      {/* Price per watt, decomposed. Every figure derives from what is already
          stored on the design and finance rows — nothing new is entered here. */}
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pricing breakdown
        </div>
        <dl className="divide-y divide-border text-sm">
          <SpecRow k="Base PPW" v={`${usdc(money.basePpwCents)}/W`} />
          <SpecRow k="Adder PPW" v={`${usdc(money.adderPpwCents)}/W`} />
          <SpecRow
            k="Dealer fees"
            v={money.dealerFeeCents > 0 ? `${usd(money.dealerFeeCents)} · ${usdc(money.dealerFeePpwCents)}/W` : "None"}
          />
          <div className="flex items-center justify-between gap-4 py-2 font-semibold">
            <dt>Final PPW</dt>
            <dd className="tabular-nums">{usdc(money.finalPpwCents)}/W</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <MilestoneList
          leadId={leadId}
          payee="rep"
          title="Commission milestones"
          rows={rep}
          canEdit={canEdit}
          defaultLabels={["M1", "M2", "M3"]}
          defaultTriggers={["Contract signed", "Install complete", "PTO granted"]}
        />
        <MilestoneList
          leadId={leadId}
          payee="financier"
          title="Financier payments"
          rows={fin}
          canEdit={canEdit}
          defaultLabels={["1st payment", "2nd payment", "3rd payment"]}
          defaultTriggers={["NTP approved", "Install complete", "PTO granted"]}
        />
      </div>
    </div>
  );
}

/**
 * The payment schedule, editable in place.
 *
 * Three fixed slots per payee, because that is how these deals are actually
 * structured — a coordinator fills in the amounts and dates rather than
 * inventing rows. An empty slot shows as "not set" instead of being hidden, so
 * a schedule that has never been entered is visibly incomplete rather than
 * silently absent.
 */
function MilestoneList({
  leadId, payee, title, rows, canEdit, defaultLabels, defaultTriggers,
}: {
  leadId: string;
  payee: MilestonePayee;
  title: string;
  rows: MilestoneLite[];
  canEdit: boolean;
  defaultLabels: string[];
  defaultTriggers: string[];
}) {
  const [editing, setEditing] = React.useState<number | null>(null);
  const slots = [1, 2, 3];

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {slots.map((seq) => {
          const m = rows.find((r) => r.sequence === seq) ?? null;
          if (editing === seq) {
            return (
              <li key={seq} className="p-2.5">
                <MilestoneForm
                  leadId={leadId}
                  payee={payee}
                  sequence={seq}
                  existing={m}
                  defaultLabel={defaultLabels[seq - 1]}
                  defaultTrigger={defaultTriggers[seq - 1]}
                  onDone={() => setEditing(null)}
                />
              </li>
            );
          }
          return (
            <li key={seq} className="flex items-center gap-2 p-2.5 text-sm">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                  m?.paidAt ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                )}
              >
                {m?.paidAt ? <Check className="size-3" /> : seq}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("font-medium", !m && "text-muted-foreground")}>
                  {m?.label ?? defaultLabels[seq - 1]}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {m?.trigger ?? defaultTriggers[seq - 1]}
                </span>
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{m ? usd(m.amountCents) : "—"}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {m?.paidAt
                    ? `paid ${new Date(m.paidAt).toLocaleDateString()}`
                    : m?.expectedAt
                      ? `due ${new Date(m.expectedAt).toLocaleDateString()}`
                      : "not set"}
                </span>
              </span>
              {canEdit && (
                <button
                  onClick={() => setEditing(seq)}
                  aria-label={`Edit ${m?.label ?? defaultLabels[seq - 1]}`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MilestoneForm({
  leadId, payee, sequence, existing, defaultLabel, defaultTrigger, onDone,
}: {
  leadId: string;
  payee: MilestonePayee;
  sequence: number;
  existing: MilestoneLite | null;
  defaultLabel: string;
  defaultTrigger: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [label, setLabel] = React.useState(existing?.label ?? defaultLabel);
  const [amount, setAmount] = React.useState(
    existing ? (existing.amountCents / 100).toString() : ""
  );
  const [trigger, setTrigger] = React.useState(existing?.trigger ?? defaultTrigger);
  const [expected, setExpected] = React.useState(
    existing?.expectedAt ? existing.expectedAt.slice(0, 10) : ""
  );
  const [paid, setPaid] = React.useState(!!existing?.paidAt);

  async function save() {
    setBusy(true);
    const res = await upsertSolarMilestoneAction({
      leadId,
      payee,
      sequence,
      label: label.trim() || defaultLabel,
      amountCents: Math.round(Number(amount || 0) * 100),
      trigger: trigger.trim() || null,
      expectedAt: expected ? new Date(expected).toISOString() : null,
      paid,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Milestone saved");
    onDone();
    router.refresh();
  }

  return (
    <div className="space-y-2" data-testid="milestone-form">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
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
          <span className="text-[11px] text-muted-foreground">Pays when</span>
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[11px] text-muted-foreground">Expected date</span>
          <input
            type="date"
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          />
        </label>
      </div>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
      <div className="font-display text-lg font-semibold">{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium tabular-nums">{v}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2 · Document folders
// ---------------------------------------------------------------------------

export function SolarDocumentFolders({
  counts,
  onOpenUpload,
}: {
  counts: Record<string, number>;
  onOpenUpload?: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {SOLAR_FOLDERS.map((f) => (
        <div
          key={f.key}
          className={cn(
            "flex items-start gap-3 rounded-lg border p-3",
            f.internal ? "border-dashed border-border bg-muted/30" : "border-border"
          )}
        >
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            {f.internal ? (
              <Lock className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{f.label}</span>
              <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                {counts[f.key] ?? 0}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{f.hint}</p>
          </div>
        </div>
      ))}
      {onOpenUpload && (
        <a
          href={onOpenUpload}
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Upload className="size-4" /> Upload a file
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3 · Activity feed
// ---------------------------------------------------------------------------

export type FeedPost = {
  id: string;
  channel: FeedChannel;
  body: string;
  author: string;
  createdAt: string;
};

const CHANNELS: { value: FeedChannel; label: string; hint: string; tone: string }[] = [
  { value: "internal", label: "Internal", hint: "Staff only — the customer never sees this", tone: "bg-slate-100 text-slate-700" },
  { value: "external", label: "External", hint: "Visible to the customer in their portal", tone: "bg-sky-100 text-sky-700" },
  { value: "customer", label: "Customer", hint: "From or to the homeowner", tone: "bg-amber-100 text-amber-800" },
];

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
  const [channel, setChannel] = React.useState<FeedChannel>("internal");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<FeedChannel | "all">("all");

  const active = CHANNELS.find((c) => c.value === channel)!;
  const shown = filter === "all" ? posts : posts.filter((p) => p.channel === filter);

  async function post() {
    if (!body.trim()) return;
    setBusy(true);
    const res = await postDealFeedAction({ leadId, channel, body: body.trim() });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(res.mentioned ? `Posted · ${res.mentioned} notified` : "Posted");
    setBody("");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {canPost && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap gap-1">
            {CHANNELS.map((c) => (
              <button
                key={c.value}
                onClick={() => setChannel(c.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  channel === c.value ? c.tone : "text-muted-foreground hover:bg-muted"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{active.hint}</p>
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write an update. Use @Name to notify someone by email."
          />
          <Button size="sm" onClick={post} disabled={busy || !body.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Post
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-1">
        {(["all", "internal", "external", "customer"] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
              filter === c ? "border-transparent bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((p) => {
            const meta = CHANNELS.find((c) => c.value === p.channel)!;
            return (
              <li key={p.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium">{p.author}</span>
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", meta.tone)}>
                    {meta.label}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(p.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{p.body}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4 · Quick actions
// ---------------------------------------------------------------------------

/**
 * A single calm row of pills under the page header.
 *
 * This used to be a three-across grid of full-width tiles in its own card,
 * which gave five secondary actions the same visual weight as the deal's
 * financials. As a pill row it stays reachable without competing with the
 * content — the reference design's "actions live near their section, quietly".
 */
export function SolarQuickActions({
  leadId,
  proposalToken,
  canEdit,
  homeownerInvited,
}: {
  leadId: string;
  proposalToken: string | null;
  canEdit: boolean;
  homeownerInvited: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  async function invite() {
    setBusy(true);
    const res = await inviteHomeownerAction(leadId);
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Invitation sent");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {proposalToken ? (
        <QuickAction href={`/proposal/${proposalToken}`} icon={Sun} label="View proposal" external />
      ) : (
        <QuickAction disabled icon={Sun} label="No proposal yet" />
      )}
      {/* The deal page is one long page; these scroll to a section on it. The
          ids live on the <section> wrappers in the deal page. */}
      <QuickAction href={`/portal/leads/${leadId}#proposal`} icon={Pencil} label="Edit design" />
      <QuickAction href={`/portal/leads/${leadId}#documents`} icon={Upload} label="Upload files" />
      <QuickAction href={`/portal/tasks?lead=${leadId}`} icon={ListTodo} label="Tasks" />
      {canEdit && !homeownerInvited && (
        <button
          onClick={invite}
          disabled={busy}
          className={cn(QUICK_ACTION_CLS, "hover:bg-muted disabled:opacity-60")}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5 text-muted-foreground" />}
          Invite homeowner
        </button>
      )}
      {homeownerInvited && <QuickAction disabled icon={UserPlus} label="Homeowner invited" />}
    </div>
  );
}

const QUICK_ACTION_CLS =
  "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1";

function QuickAction({
  href, icon: Icon, label, external, disabled,
}: {
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  external?: boolean;
  disabled?: boolean;
}) {
  const inner = (
    <>
      <Icon className="size-3.5 text-muted-foreground" />
      {label}
    </>
  );
  const cls = cn(QUICK_ACTION_CLS, disabled ? "opacity-50" : "hover:bg-muted");
  if (disabled || !href) return <span className={cls}>{inner}</span>;
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Deferred — clearly labelled, deliberately not built
// ---------------------------------------------------------------------------

/**
 * Placeholders for work that needs something outside this codebase. Shown
 * rather than hidden so the gap is visible to whoever picks it up, and
 * explicitly NOT wired to anything.
 *
 * "Satellite roof render" used to sit here too. It was removed once the real
 * property view shipped (`solar/property-view.tsx`) and became this page's
 * hero — a "coming soon" card directly below the working feature it describes
 * teaches people to ignore the whole panel. The remaining gap, drawing the
 * PANEL LAYOUT onto that imagery, still needs a design provider and is called
 * out in the property card itself.
 */
export function SolarDeferredPanels() {
  return (
    <div className="grid gap-3">
      <DeferredCard
        icon={Sparkles}
        title="Project AI assistant"
        why="Part of the separate AI-agent programme, deliberately out of scope for this work."
      />
    </div>
  );
}

function DeferredCard({
  icon: Icon, title, why,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  why: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{why}</p>
    </div>
  );
}
