"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BatteryCharging,
  ChevronDown,
  ChevronUp,
  Loader2,
  MoreHorizontal,
  Plus,
  PiggyBank,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  ChoiceCards,
  Figure,
  Hint,
  ItemRail,
  MoneyField,
  Panel,
  Pill,
  RailGroup,
  RailLayout,
  RailRow,
  SaveBar,
  TextField,
  ToggleRow,
} from "@/components/portal/settings-kit";
import { backupHours } from "@/lib/solar-storage";
import {
  saveBackupProfileAction,
  deleteBackupProfileAction,
  saveRebateAction,
  deleteRebateAction,
  type BackupProfileRow,
  type RebateRow,
} from "@/server/modules/solar/storage";

/** kWh a two-Powerwall system holds, used only to preview hours in Settings. */
const REFERENCE_KWH = 27;

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

/**
 * Run a server action, and ALWAYS put the busy flag back.
 *
 * The `finally` is the point. Roughly forty components in this codebase reset
 * the flag on the line after the await, so an action that throws leaves the
 * form permanently disabled — the "it won't let me type" bug, which looks like
 * a broken input and is actually a latched boolean.
 */
function useAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error ?? "Something went wrong.");
          return false;
        }
        toast.success(okMsg);
        router.refresh();
        return true;
      } catch {
        toast.error("Something went wrong.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [router]
  );

  return { busy, run };
}

/**
 * The two company lists behind a battery quote, in one rail.
 *
 * They stay separate lists because they are separate things — a load profile is
 * what a battery carries, a rebate is money off the price — but they exist for
 * the same reason and are set up in the same sitting, so they share a screen
 * and a rail rather than sitting stacked as two cards with an inline add row
 * each.
 */
export function SolarStorageSettings({
  profiles,
  rebates,
  canEdit,
}: {
  profiles: BackupProfileRow[];
  rebates: RebateRow[];
  canEdit: boolean;
}) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => profiles[0]?.id ?? rebates[0]?.id ?? null
  );

  // A row that has just been deleted, or an id from a stale link, must not leave
  // the panel blank — so the first profile stands in, and only then the first
  // rebate.
  const profile = profiles.find((p) => p.id === selectedId) ?? null;
  const rebate = rebates.find((r) => r.id === selectedId) ?? null;
  const nothingOpen = profile == null && rebate == null;
  const openProfile = profile ?? (nothingOpen ? (profiles[0] ?? null) : null);
  const openRebate =
    rebate ?? (nothingOpen && openProfile == null ? (rebates[0] ?? null) : null);

  return (
    <RailLayout
      rail={
        <ItemRail
          label="Storage lists"
          add={canEdit ? <AddDialog profiles={profiles} rebates={rebates} full /> : undefined}
        >
          <RailGroup>Backup load profiles ({profiles.length})</RailGroup>
          {profiles.length === 0 && (
            <p className="px-2 py-2 text-xs text-amber-600 dark:text-amber-400">
              None — a storage proposal cannot state backup hours at all.
            </p>
          )}
          {profiles.map((p, i) => (
            <RailRow
              key={p.id}
              title={p.name}
              subtitle={`${p.loadWatts.toLocaleString("en-US")} W${i === 0 ? " · leads the cover" : ""}`}
              mark={
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/10 text-gold">
                  <BatteryCharging className="size-3.5" />
                </span>
              }
              selected={p.id === (openProfile?.id ?? null)}
              onSelect={() => setSelectedId(p.id)}
              muted={!p.isActive}
            />
          ))}

          <RailGroup>Rebates ({rebates.length})</RailGroup>
          {rebates.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">None yet.</p>
          )}
          {rebates.map((r) => (
            <RailRow
              key={r.id}
              title={r.name}
              subtitle={`${usd(r.amountCents)} ${r.perBattery ? "per battery" : "per job"}`}
              mark={
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <PiggyBank className="size-3.5" />
                </span>
              }
              selected={r.id === (openRebate?.id ?? null)}
              onSelect={() => setSelectedId(r.id)}
              muted={!r.isActive}
            />
          ))}
        </ItemRail>
      }
    >
      {openProfile && (
        <ProfilePanel
          key={openProfile.id}
          row={openProfile}
          rows={profiles}
          canEdit={canEdit}
          onDeleted={() => setSelectedId(null)}
        />
      )}
      {openRebate && (
        <RebatePanel
          key={openRebate.id}
          row={openRebate}
          canEdit={canEdit}
          onDeleted={() => setSelectedId(null)}
        />
      )}
      {!openProfile && !openRebate && (
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <BatteryCharging className="size-6" />
          </span>
          <h3 className="mt-3 font-medium">Nothing set up for storage yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A storage deal argues from backup hours rather than production, and those hours come
            from a load profile. Without one, readiness blocks the proposal from being generated at
            all.
          </p>
          {canEdit && (
            <div className="mt-4 flex justify-center">
              <AddDialog profiles={profiles} rebates={rebates} />
            </div>
          )}
        </div>
      )}
    </RailLayout>
  );
}

/** One load profile: what it carries, and how long a battery holds it up. */
function ProfilePanel({
  row,
  rows,
  canEdit,
  onDeleted,
}: {
  row: BackupProfileRow;
  rows: BackupProfileRow[];
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const { busy, run } = useAction();

  const seed = React.useCallback(
    () => ({ name: row.name, watts: String(row.loadWatts), isActive: row.isActive }),
    [row]
  );
  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([row.id, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const watts = Number(draft.watts);
  const hours = watts > 0 ? backupHours(REFERENCE_KWH, watts) : null;
  const index = rows.findIndex((r) => r.id === row.id);

  /** Move a profile up or down the order the customer's cover reads them in. */
  async function move(delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    for (const [rank, r] of next.entries()) {
      if (r.rank === rank) continue;
      const ok = await run(() => saveBackupProfileAction({ ...r, rank }), "Order saved.");
      if (!ok) return;
    }
  }

  return (
    <div className="min-w-0" data-testid="backup-profile-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold">
          <BatteryCharging className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {row.name}
            </h2>
            {!row.isActive && <Pill>Off</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="gold">{row.loadWatts.toLocaleString("en-US")} W</Pill>
            <Pill>
              #{index + 1} of {rows.length}
            </Pill>
            {index === 0 && <Pill tone="solar">Leads the customer&rsquo;s cover</Pill>}
          </div>
        </div>

        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={busy || index === 0}
              aria-label={`Move ${row.name} up`}
              onClick={() => void move(-1)}
            >
              <ChevronUp className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              disabled={busy || index === rows.length - 1}
              aria-label={`Move ${row.name} down`}
              onClick={() => void move(1)}
            >
              <ChevronDown className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`More for ${row.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={async () => {
                    const ok = await run(
                      () => deleteBackupProfileAction({ id: row.id }),
                      "Profile deleted."
                    );
                    if (ok) onDeleted();
                  }}
                >
                  <Trash2 className="size-4" /> Delete {row.name}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Panel
            title="What the battery carries"
            description="Hours are worked out from this — the proposal never asks anyone to type a runtime."
          >
            <TextField
              label="Name"
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="Essentials + AC"
              id={`bp-${row.id}-name`}
            />
            <TextField
              label="Load (watts)"
              type="number"
              value={draft.watts}
              onChange={(v) => setDraft((d) => ({ ...d, watts: v }))}
              placeholder="3500"
              hint="Everything running at once while the power is out. A fridge and some lights is around 800 W; add air conditioning and it is several thousand."
            />
            <ToggleRow
              label="Offered on proposals"
              description="Turned off, it stays here but never appears on a customer's document."
              checked={draft.isActive}
              onChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
            />
            {!(watts > 0) && (
              <Caution>A load profile needs a wattage above zero, or it computes no hours.</Caution>
            )}
          </Panel>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Panel title="Sanity check" tone="muted">
            <Figure
              label={`On a ${REFERENCE_KWH} kWh system`}
              value={hours == null ? "—" : `${hours.toFixed(1)} hrs`}
              tone="gold"
            />
            <Hint className="mt-2">
              Two Powerwalls, as a reference. Not a promise about any deal — it is here so a
              wattage typed with a digit missing is obvious before it is saved.
            </Hint>
          </Panel>
        </div>
      </div>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          what={row.name}
          onSave={() =>
            void run(
              () =>
                saveBackupProfileAction({
                  id: row.id,
                  name: draft.name.trim(),
                  loadWatts: Number(draft.watts),
                  rank: row.rank,
                  isActive: draft.isActive,
                }),
              `${draft.name.trim()} saved`
            )
          }
          onDiscard={() => setDraft(seed())}
          disabled={!(watts > 0) || draft.name.trim() === ""}
          blockedReason={
            !(watts > 0) || draft.name.trim() === ""
              ? "A profile needs a name and a wattage above zero."
              : undefined
          }
        />
      )}
    </div>
  );
}

/** One rebate: whose money it is, how much, and how it is counted. */
function RebatePanel({
  row,
  canEdit,
  onDeleted,
}: {
  row: RebateRow;
  canEdit: boolean;
  onDeleted: () => void;
}) {
  const { busy, run } = useAction();

  const seed = React.useCallback(
    () => ({
      name: row.name,
      amount: String(row.amountCents / 100),
      perBattery: row.perBattery,
      isActive: row.isActive,
    }),
    [row]
  );
  const [draft, setDraft] = React.useState(seed);
  const serverKey = JSON.stringify([row.id, seed()]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed());
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed());
  const amount = Number(draft.amount);

  return (
    <div className="min-w-0" data-testid="rebate-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
          <PiggyBank className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {row.name}
            </h2>
            {!row.isActive && <Pill>Off</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="gold">{usd(row.amountCents)}</Pill>
            <Pill>{row.perBattery ? "per battery" : "per job"}</Pill>
          </div>
        </div>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`More for ${row.name}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  const ok = await run(() => deleteRebateAction({ id: row.id }), "Rebate deleted.");
                  if (ok) onDeleted();
                }}
              >
                <Trash2 className="size-4" /> Delete {row.name}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="mt-4 space-y-4">
        <Panel
          title="Money the company passes through"
          description="A rebate comes off the price BEFORE the lender's fee, so the amount financed and the monthly payment both drop. Priced here once so two reps cannot quote the same rebate at two amounts."
        >
          <TextField
            label="Name"
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder="Tesla battery rebate"
            id={`rb-${row.id}-name`}
          />
          <MoneyField
            label="Amount"
            value={draft.amount}
            onChange={(v) => setDraft((d) => ({ ...d, amount: v }))}
            placeholder="500"
          />
          <ChoiceCards
            name={`rebate-basis-${row.id}`}
            legend="Counted"
            value={draft.perBattery ? "battery" : "job"}
            onChange={(v) => setDraft((d) => ({ ...d, perBattery: v === "battery" }))}
            columns={2}
            options={[
              {
                value: "battery",
                label: "Per battery",
                detail: "Multiplied by how many batteries the deal carries.",
              },
              { value: "job", label: "Per job", detail: "One amount, however many batteries." },
            ]}
          />
          <ToggleRow
            label="Available to quote"
            description="Nothing is applied to a deal automatically either way — a rep picks it."
            checked={draft.isActive}
            onChange={(v) => setDraft((d) => ({ ...d, isActive: v }))}
          />
          {!(amount > 0) && <Caution>A rebate needs an amount above zero.</Caution>}
        </Panel>
      </div>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          what={row.name}
          onSave={() =>
            void run(
              () =>
                saveRebateAction({
                  id: row.id,
                  name: draft.name.trim(),
                  amountCents: Math.round(amount * 100),
                  perBattery: draft.perBattery,
                  rank: row.rank,
                  isActive: draft.isActive,
                }),
              `${draft.name.trim()} saved`
            )
          }
          onDiscard={() => setDraft(seed())}
          disabled={!(amount > 0) || draft.name.trim() === ""}
          blockedReason={
            !(amount > 0) || draft.name.trim() === ""
              ? "A rebate needs a name and an amount above zero."
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Adding to either list, from one button. */
function AddDialog({
  profiles,
  rebates,
  full,
}: {
  profiles: BackupProfileRow[];
  rebates: RebateRow[];
  full?: boolean;
}) {
  const { busy, run } = useAction();
  const [open, setOpen] = React.useState(false);
  const [kind, setKind] = React.useState<"profile" | "rebate">("profile");
  const [name, setName] = React.useState("");
  const [value, setValue] = React.useState("");
  const [perBattery, setPerBattery] = React.useState(true);

  const isProfile = kind === "profile";
  const valid = name.trim() !== "" && Number(value) > 0;

  async function add() {
    if (!valid) return;
    const ok = await run(
      () =>
        isProfile
          ? saveBackupProfileAction({
              name: name.trim(),
              loadWatts: Number(value),
              rank: profiles.length,
              isActive: true,
            })
          : saveRebateAction({
              name: name.trim(),
              amountCents: Math.round(Number(value) * 100),
              perBattery,
              rank: rebates.length,
              isActive: true,
            }),
      isProfile ? "Profile added." : "Rebate added."
    );
    if (ok) {
      setName("");
      setValue("");
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to storage</DialogTitle>
          <DialogDescription>
            A load profile is what a battery carries; a rebate is money off the price.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ChoiceCards
            name="new-storage-kind"
            legend="Which is it?"
            value={kind}
            onChange={(v) => setKind(v)}
            columns={2}
            options={[
              {
                value: "profile" as const,
                label: "Backup load profile",
                detail: "What the battery holds up when the power goes out.",
              },
              {
                value: "rebate" as const,
                label: "Rebate",
                detail: "Manufacturer or utility money that comes off the price.",
              },
            ]}
          />
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-storage-name">
              Name
            </Label>
            <Input
              id="new-storage-name"
              value={name}
              placeholder={isProfile ? "Essentials + AC" : "Tesla battery rebate"}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-storage-value">
              {isProfile ? "Load (watts)" : "Amount ($)"}
            </Label>
            <Input
              id="new-storage-value"
              type="number"
              min={1}
              value={value}
              placeholder={isProfile ? "3500" : "500"}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          </div>
          {!isProfile && (
            <ToggleRow
              label="Per battery"
              description="Off means one amount however many batteries the deal carries."
              checked={perBattery}
              onChange={setPerBattery}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !valid}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
