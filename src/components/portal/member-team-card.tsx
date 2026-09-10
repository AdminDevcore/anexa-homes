"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormat } from "@/components/portal/branding-provider";
import { VERTICAL_LABEL, VERTICAL_ACCENT, DEFAULT_VERTICAL, type ActiveVertical } from "@/lib/vertical";
import {
  setCommissionOverrideAction,
  deleteCommissionOverrideAction,
  setTeamNameAction,
} from "@/server/modules/team/actions";

/**
 * ONE card for a person's place in the org: the team they run or belong to, and
 * the money they make off it.
 *
 * Reporting and Overrides used to be two cards in two columns, and reading them
 * together — "these four reps are mine, and this is what I earn off each of
 * them" — meant holding one in your head while you looked at the other. They
 * are the same question, so they are now the same card: every person on the
 * team is a row, and their override rate sits on their row.
 *
 * Overrides off somebody OUTSIDE the downline are still possible (an owner
 * earning off a manager, a manager off another manager's rep) and get their own
 * section underneath, so consolidating loses nothing.
 */

export type OverrideType = "percentage" | "flat" | "ppw";

export type OverrideRow = {
  id: string;
  sourceId: string;
  sourceName: string;
  vertical: ActiveVertical;
  type: OverrideType;
  percent: number;
  flatAmount: number;
  /** Tenths of a cent per watt. Read only when type = ppw. */
  perWattMills: number;
};

/** Whose deals this person can earn off, and on which sides they actually work. */
export type OverrideCandidate = { id: string; name: string; verticals: ActiveVertical[] };

export type TeamPerson = { id: string; name: string; role: string; roleLabel: string; status: string };
export type TeamReport = TeamPerson & { canvassers: TeamPerson[] };

/** Module scope on purpose — react-hooks/static-components is an error here. */
function VerticalDot({ v }: { v: ActiveVertical }) {
  return <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: VERTICAL_ACCENT[v] }} />;
}

function rateLabel(o: OverrideRow, money: (cents: number) => string): string {
  if (o.type === "percentage") return `${o.percent}%`;
  if (o.type === "ppw") return `$${(o.perWattMills / 1000).toFixed(2)}/W`;
  return money(o.flatAmount);
}

/**
 * One override, as a removable chip. Shows the workspace only when the company
 * runs more than one — a single-vertical company has nothing to distinguish.
 */
function RateChip({
  o,
  money,
  showVertical,
  canEdit,
  onRemove,
}: {
  o: OverrideRow;
  money: (cents: number) => string;
  showVertical: boolean;
  canEdit: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs">
      {showVertical && (
        <>
          <VerticalDot v={o.vertical} />
          <span className="text-muted-foreground">{VERTICAL_LABEL[o.vertical]}</span>
        </>
      )}
      <span className="font-semibold tabular-nums">{rateLabel(o, money)}</span>
      {canEdit && (
        <button
          type="button"
          onClick={() => onRemove(o.id)}
          aria-label={`Remove ${VERTICAL_LABEL[o.vertical]} override off ${o.sourceName}`}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </span>
  );
}

/** A person on the team, with whatever this member earns off them on the row. */
function TeamRow({
  person,
  rates,
  money,
  showVertical,
  canEdit,
  canOverride,
  indent,
  onAdd,
  onRemove,
}: {
  person: TeamPerson;
  rates: OverrideRow[];
  money: (cents: number) => string;
  showVertical: boolean;
  canEdit: boolean;
  canOverride: boolean;
  indent?: boolean;
  onAdd: (sourceId: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <li className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 ${indent ? "pl-6" : ""}`}>
      <Link href={`/portal/team/${person.id}`} className="text-sm font-medium hover:text-gold-muted">
        {person.name}
      </Link>
      <span className="text-xs text-muted-foreground">{person.roleLabel}</span>
      {person.status !== "active" && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] capitalize text-muted-foreground">{person.status}</span>
      )}
      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {rates.map((o) => (
          <RateChip key={o.id} o={o} money={money} showVertical={showVertical} canEdit={canEdit} onRemove={onRemove} />
        ))}
        {rates.length === 0 && canOverride && <span className="text-xs text-muted-foreground">No override</span>}
        {canEdit && canOverride && (
          <button
            type="button"
            onClick={() => onAdd(person.id)}
            className="rounded-full border border-dashed border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:border-gold/50 hover:text-gold-muted"
          >
            <Plus className="mr-0.5 inline size-3" />
            Rate
          </button>
        )}
      </span>
    </li>
  );
}

export function MemberTeamCard({
  member,
  canEdit,
  reportsTo,
  reports,
  canvassers,
  overrides,
  candidates,
  verticals,
  showOverrides,
}: {
  member: { id: string; firstName: string; role: string; teamName: string | null };
  canEdit: boolean;
  /** Who this person reports to, already labelled ("Sales manager" / "Sales rep"). */
  reportsTo: { roleLabel: string; name: string | null; team: string | null } | null;
  /** Reps under a manager, each with their own canvassers. */
  reports: TeamReport[];
  /** Canvassers under a rep. */
  canvassers: TeamPerson[];
  overrides: OverrideRow[];
  candidates: OverrideCandidate[];
  verticals: ActiveVertical[];
  showOverrides: boolean;
}) {
  const fmt = useFormat();
  const router = useRouter();
  const isManager = member.role === "manager";

  // -- Team name -------------------------------------------------------------
  const [teamName, setTeamName] = React.useState(member.teamName ?? "");
  const [savingName, setSavingName] = React.useState(false);
  const nameDirty = teamName.trim() !== (member.teamName ?? "");

  async function saveTeamName() {
    setSavingName(true);
    try {
      const res = await setTeamNameAction({ userId: member.id, teamName: teamName.trim() || null });
      if (!res.ok) return toast.error(res.error);
      toast.success(teamName.trim() ? `Team renamed to ${teamName.trim()}` : "Team name cleared");
      router.refresh();
    } finally {
      // In a finally: a thrown action must not leave the field permanently
      // disabled with nothing on screen explaining why.
      setSavingName(false);
    }
  }

  // -- Overrides -------------------------------------------------------------
  const [adding, setAdding] = React.useState<{ sourceId: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [vertical, setVertical] = React.useState<ActiveVertical>(verticals[0] ?? DEFAULT_VERTICAL);
  const [type, setType] = React.useState<OverrideType>("percentage");
  const [amount, setAmount] = React.useState("");

  const showVertical = verticals.length > 1 || new Set(overrides.map((o) => o.vertical)).size > 1;
  const ratesFor = (id: string) => overrides.filter((o) => o.sourceId === id);

  // Everyone already on the card, so the loose-overrides section below lists
  // only the people the team rows do NOT already account for.
  const downlineIds = new Set<string>([
    ...reports.map((r) => r.id),
    ...reports.flatMap((r) => r.canvassers.map((c) => c.id)),
    ...canvassers.map((c) => c.id),
  ]);
  const outside = overrides.filter((o) => !downlineIds.has(o.sourceId));

  // One override per (person, vertical): a name stays pickable until every side
  // they work already has a rate. A candidate is only overridable at all if
  // they can be paid on a workspace this member hasn't already claimed.
  const available = candidates.filter(
    (c) => c.id !== member.id && c.verticals.some((v) => !overrides.some((o) => o.sourceId === c.id && o.vertical === v)),
  );
  const selected = candidates.find((c) => c.id === adding?.sourceId);
  // The sides the picked person actually works, minus the ones that already
  // have a rate — so a row that can never pay is impossible to write.
  const openVerticals = (selected?.verticals ?? verticals).filter(
    (v) => !overrides.some((o) => o.sourceId === adding?.sourceId && o.vertical === v),
  );
  // $/W is Solar's basis: a roofing job has no system size to multiply, so the
  // basis quietly falls back rather than submitting something the server rejects.
  const isSolar = vertical === "solar";
  const effectiveType: OverrideType = !isSolar && type === "ppw" ? "percentage" : type;

  function openForm(sourceId: string) {
    setAdding({ sourceId });
    setAmount("");
    setType("percentage");
    const open = (candidates.find((c) => c.id === sourceId)?.verticals ?? verticals).filter(
      (v) => !overrides.some((o) => o.sourceId === sourceId && o.vertical === v),
    );
    setVertical(open[0] ?? verticals[0] ?? DEFAULT_VERTICAL);
  }

  function pickSource(id: string) {
    openForm(id);
  }

  async function save() {
    if (!adding?.sourceId) return toast.error("Pick whose deals this is off of.");
    if (!openVerticals.includes(vertical)) return toast.error("Pick a workspace for this override.");
    const n = Number(amount);
    if (!(n > 0)) return toast.error("Enter an amount above 0.");
    setBusy(true);
    try {
      const res = await setCommissionOverrideAction({
        beneficiaryId: member.id,
        sourceId: adding.sourceId,
        vertical,
        type: effectiveType,
        percent: effectiveType === "percentage" ? n : 0,
        flatAmount: effectiveType === "flat" ? Math.round(n * 100) : 0,
        // Mills, so $0.075/W survives the round trip. Cents would floor it to $0.07.
        perWattMills: effectiveType === "ppw" ? Math.round(n * 1000) : 0,
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Override saved");
      setAdding(null);
      setAmount("");
      setType("percentage");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await deleteCommissionOverrideAction(id);
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  const teamSize = reports.length + reports.reduce((n, r) => n + r.canvassers.length, 0);
  const teamLabel = member.teamName ?? `${member.firstName}'s team`;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Users2 className="size-4 text-gold" /> Team
        </h3>
        {isManager && member.teamName && (
          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-semibold text-gold-muted">{member.teamName}</span>
        )}
      </div>

      {/* Only a sales manager has a team to name — see setTeamNameAction. */}
      {isManager && (
        <div className="mt-4 rounded-lg border border-gold/30 bg-gold/5 p-3">
          <Label htmlFor="team-name" className="text-xs">Team name</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Input
              id="team-name"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Team Alpha"
              maxLength={60}
              disabled={!canEdit || savingName}
              className="min-w-0 flex-1"
            />
            {canEdit && (
              <Button size="sm" variant="outline" onClick={saveTeamName} disabled={savingName || !nameDirty}>
                {savingName ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Only sales managers have teams. This name groups {member.firstName}&rsquo;s reps together on{" "}
            <Link href="/portal/team/performance?view=team" className="underline underline-offset-2">Team Performance</Link>.
            {" "}Leave it blank and the team reads as &ldquo;{member.firstName}&rsquo;s team&rdquo;.
          </p>
        </div>
      )}

      {/* Who this person reports to (canvasser → rep → manager). */}
      {reportsTo && (
        <p className="mt-4 text-sm">
          <span className="text-muted-foreground">Reports to ({reportsTo.roleLabel.toLowerCase()}): </span>
          {reportsTo.name ? <span className="font-medium">{reportsTo.name}</span> : <span className="text-muted-foreground">Unassigned</span>}
          {reportsTo.team && <span className="text-muted-foreground"> · {reportsTo.team}</span>}
        </p>
      )}

      {/* The team itself, each person carrying what this member earns off them. */}
      {(reports.length > 0 || canvassers.length > 0) && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isManager
              ? `${teamLabel} · ${teamSize} ${teamSize === 1 ? "person" : "people"}`
              : `Reporting to ${member.firstName} (${canvassers.length})`}
          </p>
          <ul className="mt-1 divide-y divide-border">
            {reports.map((r) => (
              <React.Fragment key={r.id}>
                <TeamRow
                  person={r}
                  rates={ratesFor(r.id)}
                  money={fmt.money}
                  showVertical={showVertical}
                  canEdit={canEdit && showOverrides}
                  canOverride={available.some((c) => c.id === r.id)}
                  onAdd={openForm}
                  onRemove={remove}
                />
                {r.canvassers.map((c) => (
                  <TeamRow
                    key={c.id}
                    person={c}
                    rates={ratesFor(c.id)}
                    money={fmt.money}
                    showVertical={showVertical}
                    canEdit={canEdit && showOverrides}
                    canOverride={available.some((x) => x.id === c.id)}
                    indent
                    onAdd={openForm}
                    onRemove={remove}
                  />
                ))}
              </React.Fragment>
            ))}
            {canvassers.map((c) => (
              <TeamRow
                key={c.id}
                person={c}
                rates={ratesFor(c.id)}
                money={fmt.money}
                showVertical={showVertical}
                canEdit={canEdit && showOverrides}
                canOverride={available.some((x) => x.id === c.id)}
                onAdd={openForm}
                onRemove={remove}
              />
            ))}
          </ul>
        </div>
      )}

      {isManager && reports.length === 0 && (
        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
          {`No reps on this team yet. Open a sales rep's profile and set their sales manager to ${member.firstName} — they and their canvassers then appear here, and ${member.firstName} can see their deals, tasks and commissions.`}
        </p>
      )}

      {/* Overrides off people outside the downline — an owner earning off a
          manager, a manager off somebody else's rep. Rare, real, and it has
          nowhere else to live now that the separate card is gone. */}
      {showOverrides && (
        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Overrides earned</p>
            {canEdit && available.length > 0 && !adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding({ sourceId: "" })}>
                <Plus className="size-3.5" /> Add
              </Button>
            )}
          </div>
          {/* One template literal, not JSX text with a name spliced into it:
              the transform drops the leading space of a text node that follows
              an expression, which is how the old card rendered "Shayanearns". */}
          <p className="mt-1 text-[11px] text-muted-foreground">
            {`What ${member.firstName} earns off other people's deals — a percentage, a flat amount per deal, or a $/W rate on Solar${showVertical ? ", set separately for each workspace" : ""}. Rates off their own team sit on the rows above.`}
          </p>
          {outside.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {overrides.length === 0 ? "No overrides configured." : "None outside this team."}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-border">
              {outside.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    {showVertical && (
                      <>
                        <VerticalDot v={o.vertical} />
                        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{VERTICAL_LABEL[o.vertical]}</span>
                      </>
                    )}
                    <span className="font-medium tabular-nums">{rateLabel(o, fmt.money)}</span>
                    <span className="text-muted-foreground">off {o.sourceName}&rsquo;s deals</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove(o.id)}
                      aria-label="Remove override"
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canEdit && showOverrides && adding && (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Off whose deals</Label>
            <Select value={adding.sourceId} onValueChange={pickSource}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Select person" /></SelectTrigger>
              <SelectContent>
                {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {showVertical && (
            <div className="space-y-1.5">
              <Label className="text-xs">On which workspace</Label>
              <Select value={vertical} onValueChange={(v) => setVertical(v as ActiveVertical)} disabled={!adding.sourceId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={adding.sourceId ? "Select workspace" : "Pick a person first"} />
                </SelectTrigger>
                <SelectContent>
                  {openVerticals.map((v) => (
                    <SelectItem key={v} value={v}>
                      <span className="flex items-center gap-2"><VerticalDot v={v} />{VERTICAL_LABEL[v]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pays only on that side&rsquo;s deals. To earn off both, add one override per workspace — the rate can differ.
              </p>
            </div>
          )}
          {/* Stacked, not side by side: this card sits in the narrow column, and
              a viewport breakpoint would lie about how much room it has. */}
          <div className="space-y-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={effectiveType} onValueChange={(v) => setType(v as OverrideType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* The percentage means different things on the two sides and
                      says so — solar pays a share of what the REP earned, which
                      is why raising a rep's redline raises his manager too. */}
                  <SelectItem value="percentage">{isSolar ? "% of rep's commission" : "% of contract"}</SelectItem>
                  <SelectItem value="flat">Flat $ / deal</SelectItem>
                  {isSolar && <SelectItem value="ppw">$ / watt</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {effectiveType === "percentage" ? "Percent" : effectiveType === "ppw" ? "Rate ($/W)" : "Amount (USD)"}
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                step={effectiveType === "ppw" ? "0.01" : undefined}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={effectiveType === "percentage" ? "e.g. 3" : effectiveType === "ppw" ? "e.g. 0.10" : "e.g. 500"}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={busy} className="bg-gold text-gold-foreground hover:bg-gold/90">
              {busy && <Loader2 className="size-4 animate-spin" />} Save override
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
