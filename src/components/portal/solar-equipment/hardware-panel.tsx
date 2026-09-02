"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  BatteryCharging,
  Check,
  MoreHorizontal,
  PanelsTopLeft,
  Plug,
  RotateCcw,
  Star,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Caution,
  FieldGrid,
  Hint,
  MoneyField,
  Panel,
  Pill,
  SaveBar,
  StatRow,
  TextField,
} from "@/components/portal/settings-kit";
import {
  deleteSolarEquipmentAction,
  setDefaultSolarEquipmentAction,
  setEquipmentLendersAction,
  setSolarEquipmentActiveAction,
  upsertSolarEquipmentAction,
} from "@/server/modules/solar/actions";
import { PhotoControl } from "./photo-control";
import { KINDS, itemName, money, type Item, type Lender } from "./types";

export const HARDWARE_TABS = ["details", "pricing", "approvals"] as const;
export type HardwareTab = (typeof HARDWARE_TABS)[number];

type Draft = {
  manufacturer: string;
  model: string;
  ratingW: string;
  widthMm: string;
  heightMm: string;
  cost: string;
  price: string;
  avlYear: string;
  specSheetUrl: string;
  lenderIds: string[];
};

const seed = (i: Item): Draft => ({
  manufacturer: i.manufacturer ?? "",
  model: i.model,
  ratingW: i.ratingW == null ? "" : String(i.ratingW),
  widthMm: i.widthMm == null ? "" : String(i.widthMm),
  heightMm: i.heightMm == null ? "" : String(i.heightMm),
  cost: i.costCents ? String(i.costCents / 100) : "",
  price: i.priceCents ? String(i.priceCents / 100) : "",
  avlYear: i.avlYear == null ? "" : String(i.avlYear),
  specSheetUrl: i.specSheetUrl ?? "",
  lenderIds: [...i.lenderIds].sort(),
});

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
const cents = (v: string) => (v.trim() === "" ? 0 : Math.round(Number(v) * 100));

/**
 * One catalogue item, editable.
 *
 * The catalogue this replaces could ADD hardware and retire it, and nothing
 * else — a price typed wrong meant deleting the row and typing it again, which
 * the delete refuses as soon as one deal has used it. Every field is on the
 * panel now, and the one Save at the bottom commits the lot, approvals
 * included.
 */
export function HardwarePanel({
  item,
  lenders,
  canEdit,
  tab,
  onTabChange,
  onDeleted,
}: {
  item: Item;
  lenders: Lender[];
  canEdit: boolean;
  tab: HardwareTab;
  onTabChange: (t: HardwareTab) => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState(() => seed(item));

  // Re-seeded during render, not in an effect — an effect paints the pre-save
  // values for a frame after every refresh.
  const serverKey = JSON.stringify([item.id, seed(item)]);
  const [seen, setSeen] = React.useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDraft(seed(item));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(seed(item));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const meta = KINDS.find((k) => k.value === item.kind)!;
  const named = lenders.filter((l) => item.lenderIds.includes(l.id));

  /** A module with no wattage sizes nothing — the action refuses it, so say so. */
  const missingRating = item.kind === "module" && !(Number(draft.ratingW) > 0);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.", { duration: 9000 });
        return res;
      }
      toast.success(okMsg);
      router.refresh();
      return res;
    } finally {
      setBusy(false);
    }
  }

  /**
   * ONE SAVE, across two actions.
   *
   * The approvals live in a join table with an action of their own, which is a
   * fact about the schema and not something a person editing a panel should
   * have to know — so they only post when the ticks actually changed, and a
   * failure on the item stops them going in behind it.
   */
  async function save() {
    if (!draft.model.trim()) return toast.error("A catalogue item needs a model.");
    setBusy(true);
    try {
      const res = await upsertSolarEquipmentAction(item.id, {
        kind: item.kind,
        manufacturer: draft.manufacturer.trim() || null,
        model: draft.model.trim(),
        ratingW: numOrNull(draft.ratingW),
        widthMm: numOrNull(draft.widthMm),
        heightMm: numOrNull(draft.heightMm),
        costCents: cents(draft.cost),
        priceCents: cents(draft.price),
        avlYear: numOrNull(draft.avlYear),
        specSheetUrl: draft.specSheetUrl.trim() || null,
      });
      if (!res.ok) return toast.error(res.error, { duration: 9000 });

      const before = [...item.lenderIds].sort().join(",");
      if (draft.lenderIds.join(",") !== before) {
        const approvals = await setEquipmentLendersAction(item.id, draft.lenderIds);
        if (!approvals.ok) return toast.error(approvals.error);
      }
      toast.success(`${itemName(item)} saved`);
      router.refresh();
    } catch {
      // A server action that THROWS skips everything after it, and the busy flag
      // would latch on — leaving a panel nobody can type in until a reload.
      toast.error("That did not save. Try again, or reload if it keeps failing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" data-testid="equipment-panel">
      <header className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white">
          {item.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.photoUrl} alt="" className="size-full object-contain p-1" />
          ) : (
            <KindIcon kind={item.kind} className="size-5 text-muted-foreground/50" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-xl font-semibold tracking-tight">
              {itemName(item)}
            </h2>
            {!item.isActive && <Pill>Retired</Pill>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {item.isDefault && (
              <Pill tone="gold">
                <Star className="size-3 fill-current" /> Default
              </Pill>
            )}
            {item.ratingW != null && <Pill>{item.ratingW}W</Pill>}
            {item.avlYear != null && <Pill>AVL {item.avlYear}</Pill>}
            <Pill tone={item.priceCents ? "plain" : "warn"}>
              {item.priceCents ? money(item.priceCents) : "no price"}
            </Pill>
            {lenders.length > 0 && (
              <Pill tone={named.length === 0 ? "warn" : "plain"}>
                {named.length === 0
                  ? "no lender approves it"
                  : `${named.length}/${lenders.length} approved`}
              </Pill>
            )}
          </div>
        </div>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={busy}
                aria-label={`More for ${itemName(item)}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              {item.isActive && (
                <DropdownMenuItem
                  onSelect={() =>
                    void act(
                      () => setDefaultSolarEquipmentAction(item.id, !item.isDefault),
                      item.isDefault ? "No longer the default" : "Set as default"
                    )
                  }
                >
                  <Star className={cn("size-4", item.isDefault && "fill-current")} />
                  {item.isDefault
                    ? "Stop being the default"
                    : `Make the default ${meta.one} — one per kind`}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  void act(
                    () => setSolarEquipmentActiveAction(item.id, !item.isActive),
                    item.isActive ? "Retired" : "Sellable again"
                  )
                }
              >
                {item.isActive ? (
                  <>
                    <Archive className="size-4" /> Retire — hidden from new designs, kept on
                    existing deals
                  </>
                ) : (
                  <>
                    <RotateCcw className="size-4" /> Make sellable again
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={async () => {
                  const res = await act(() => deleteSolarEquipmentAction(item.id), "Deleted");
                  if (res.ok) onDeleted();
                }}
              >
                <Trash2 className="size-4" /> Delete — refused if any design uses it
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => onTabChange(v as HardwareTab)} className="mt-4 gap-4">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="approvals">
            Approvals
            {lenders.length > 0 && (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {draft.lenderIds.length}/{lenders.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── DETAILS ──────────────────────────────────────────────────── */}
        <TabsContent value="details" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="space-y-4">
              <Panel title="Identity">
                <FieldGrid columns={2}>
                  <TextField
                    label="Manufacturer"
                    value={draft.manufacturer}
                    onChange={(v) => set("manufacturer", v)}
                    placeholder="e.g. Tesla"
                  />
                  <TextField
                    label="Model"
                    value={draft.model}
                    onChange={(v) => set("model", v)}
                    id={`eq-${item.id}-model`}
                  />
                </FieldGrid>
                <FieldGrid columns={2}>
                  <TextField
                    label={meta.ratingLabel}
                    type="number"
                    value={draft.ratingW}
                    onChange={(v) => set("ratingW", v)}
                    why={
                      item.kind === "module"
                        ? "Every downstream number — system size, production, offset, price — is derived from the panel's wattage. A module with none sizes nothing."
                        : undefined
                    }
                  />
                  <TextField
                    label="AVL year"
                    type="number"
                    value={draft.avlYear}
                    onChange={(v) => set("avlYear", v)}
                    placeholder="e.g. 2026"
                    why="Which approved-vendor list this belongs to. Plenty of items are not year-scoped, and a blank is honest about that."
                  />
                </FieldGrid>
                {missingRating && (
                  <Caution>
                    A module needs a wattage above zero — the system size is calculated from it, and
                    the save is refused without one.
                  </Caution>
                )}
              </Panel>

              {/* The laminate's real size. The roof designer lays panels out at
                  true scale against satellite imagery, so this is what decides
                  how many fit between a ridge and a setback. */}
              {item.kind === "module" && (
                <Panel
                  title="Physical size"
                  description="Off the spec sheet, in millimetres. The roof designer draws panels at true scale, so this is what decides how many fit between a ridge and a setback — left blank, every roof is planned with a generic 1134 × 1762 module instead of the one on the approved-vendor list."
                >
                  <FieldGrid columns={2}>
                    <TextField
                      label="Width (mm)"
                      type="number"
                      value={draft.widthMm}
                      onChange={(v) => set("widthMm", v)}
                      placeholder="1134"
                    />
                    <TextField
                      label="Length (mm)"
                      type="number"
                      value={draft.heightMm}
                      onChange={(v) => set("heightMm", v)}
                      placeholder="1762"
                    />
                  </FieldGrid>
                </Panel>
              )}

              <Panel
                title="Spec sheet"
                description="A link to the manufacturer, not a file we store: they revise these without telling anybody, and the version a homeowner should read is whichever is current when they click."
              >
                <TextField
                  label="Spec sheet URL"
                  type="url"
                  value={draft.specSheetUrl}
                  onChange={(v) => set("specSheetUrl", v)}
                  placeholder="https://manufacturer.com/datasheets/model.pdf"
                  hint="Rendered as “View details” on the customer’s proposal. Left blank, no link appears."
                />
              </Panel>

              <PhotoControl item={item} canEdit={canEdit} />
            </div>

            <div className="xl:sticky xl:top-20 xl:self-start">
              <Panel title="At a glance" tone="muted">
                <dl>
                  <StatRow label="Kind" value={meta.one} />
                  <StatRow label="Price" value={item.priceCents ? money(item.priceCents) : "—"} />
                  <StatRow label="Cost" value={item.costCents ? money(item.costCents) : "—"} />
                  <StatRow
                    label="Approved by"
                    value={
                      named.length === 0
                        ? "nobody"
                        : `${named.length} lender${named.length === 1 ? "" : "s"}`
                    }
                    tone={lenders.length > 0 && named.length === 0 ? "warn" : "plain"}
                  />
                  <StatRow label="Photo" value={item.photoUrl ? "set" : "none"} />
                </dl>
              </Panel>
            </div>
          </div>
        </TabsContent>

        {/* ── PRICING ──────────────────────────────────────────────────── */}
        <TabsContent value="pricing" className="space-y-4">
          <Panel
            title="What it costs and what it sells for"
            description="Per unit. The builder totals these against the count a design puts on the roof."
          >
            <FieldGrid columns={2}>
              <MoneyField
                label="Cost to us"
                value={draft.cost}
                onChange={(v) => set("cost", v)}
                placeholder="0"
              />
              <MoneyField
                label="Price"
                value={draft.price}
                onChange={(v) => set("price", v)}
                placeholder="0"
              />
            </FieldGrid>
            <Hint>
              Solar systems are quoted per watt, so these are the reference figures behind a
              design rather than the number a customer sees. A battery is the exception — a
              storage-only deal is priced per battery.
            </Hint>
          </Panel>
        </TabsContent>

        {/* ── APPROVALS ────────────────────────────────────────────────── */}
        <TabsContent value="approvals" className="space-y-4">
          <Panel
            title="Approved-vendor lists"
            description="A rep who picks one of these lenders on a deal will be offered this item. Tick every list it appears on — most equipment is approved by more than one."
          >
            {lenders.length === 0 ? (
              <Hint>
                No lenders set up yet. Add them under{" "}
                <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
                  Lenders
                </Link>{" "}
                to tag which approved-vendor lists this appears on.
              </Hint>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {lenders.map((l) => {
                    const on = draft.lenderIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        disabled={!canEdit}
                        onClick={() =>
                          set(
                            "lenderIds",
                            (on
                              ? draft.lenderIds.filter((x) => x !== l.id)
                              : [...draft.lenderIds, l.id]
                            ).sort()
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          on
                            ? "border-gold/50 bg-gold/[0.12] text-gold-muted"
                            : "border-border hover:bg-muted"
                        )}
                      >
                        {on && <Check className="size-3" />}
                        {l.name}
                        {!l.isActive && " · retired"}
                      </button>
                    );
                  })}
                </div>
                {draft.lenderIds.length === 0 && (
                  <Caution>
                    Nothing ticked, so this item is hidden the moment a lender is selected on a
                    deal — which is every financed deal.
                  </Caution>
                )}
              </>
            )}
          </Panel>
        </TabsContent>
      </Tabs>

      {canEdit && (
        <SaveBar
          dirty={dirty}
          busy={busy}
          what={itemName(item)}
          onSave={save}
          onDiscard={() => setDraft(seed(item))}
          disabled={missingRating}
          blockedReason={
            missingRating ? "A module needs a wattage above zero before it can be saved." : undefined
          }
        />
      )}
    </div>
  );
}

/** What a catalogue item looks like before anybody has photographed it. */
function KindIcon({ kind, className }: { kind: Item["kind"]; className?: string }) {
  if (kind === "battery") return <BatteryCharging className={className} aria-hidden />;
  if (kind === "inverter") return <Plug className={className} aria-hidden />;
  return <PanelsTopLeft className={className} aria-hidden />;
}
