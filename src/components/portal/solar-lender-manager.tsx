"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Search, Landmark, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LenderMark } from "@/components/ui/lender-mark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/portal/ui";
import { upsertSolarLenderAction } from "@/server/modules/solar/actions";
import type { AdderRuleOption, LenderRow } from "./solar-lender/types";
import { ppwToDollars } from "./solar-lender/types";
import { LenderDetail, LENDER_TABS, type LenderTab } from "./solar-lender/detail";

export type { LenderRow, LenderProduct, AdderRuleOption } from "./solar-lender/types";

/**
 * The lenders whose approved-vendor lists constrain what can be sold.
 *
 * A LIST AND A PANEL, not a grid of cards. The old screen laid every partner
 * out as a third-width card and then opened the edit form inside one of them,
 * which put twenty fields down a narrow column with the rest of the window
 * empty — and it scattered one lender across three sections of the page, so
 * setting a partner up meant finding its card, its rate sheet a screenful
 * below, and its adder table below that. Here a partner is picked once on the
 * left and everything about it is on the right.
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
  initialLenderId,
  initialTab,
}: {
  lenders: LenderRow[];
  sellableEquipment: number;
  canEdit: boolean;
  /** From Solar Settings. Null = the sticker is not derived from a dealer fee. */
  targetNetPpwCents: number | null;
  /** The sellable adders every lender is asked to rule on. */
  adderCatalogue: AdderRuleOption[];
  /**
   * Where the page was left, off the query string.
   *
   * READ ON THE SERVER and handed down, not read out of `window.location`
   * here. The panel writes both back into the URL so a reload returns to the
   * same partner — and a client that reads that URL while hydrating renders a
   * different partner from the one the server sent, which is a hydration
   * mismatch: React throws the server's markup away and rebuilds the page.
   */
  initialLenderId: string | null;
  initialTab: string | null;
}) {
  const live = lenders.filter((l) => l.isActive);
  const retired = lenders.filter((l) => !l.isActive);

  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => initialLenderId ?? live[0]?.id ?? lenders[0]?.id ?? null
  );
  const [tab, setTab] = React.useState<LenderTab>(() =>
    (LENDER_TABS as readonly string[]).includes(initialTab ?? "")
      ? (initialTab as LenderTab)
      : "details"
  );
  const [query, setQuery] = React.useState("");

  // A partner that has just been deleted, or one whose id came out of a stale
  // link, must not leave the panel blank.
  const selected = lenders.find((l) => l.id === selectedId) ?? live[0] ?? lenders[0] ?? null;

  /**
   * Keep the URL pointing at what is on screen.
   *
   * `replaceState` rather than a router push: moving between partners and tabs
   * is not a navigation and should not stack up history entries somebody has
   * to press Back through — but a reload, or a link pasted to a colleague,
   * should still land on the partner being talked about.
   */
  const selectedIdInUrl = selected?.id ?? null;
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (selectedIdInUrl) p.set("lender", selectedIdInUrl);
    else p.delete("lender");
    p.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${p}`);
  }, [selectedIdInUrl, tab]);

  const q = query.trim().toLowerCase();
  const matches = (l: LenderRow) => q === "" || l.name.toLowerCase().includes(q);
  const shownLive = live.filter(matches);
  const shownRetired = retired.filter(matches);

  if (lenders.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="No financing partners yet"
        description="Add the banks and finance partners you sell through. Then tag your equipment with the ones that approve it on Solar Equipment, and each partner's rate sheet decides what a deal can be quoted at."
        action={
          canEdit ? (
            <AddLenderDialog onAdded={setSelectedId} />
          ) : (
            <Link
              href="/portal/settings/solar-equipment"
              className="text-sm underline underline-offset-2"
            >
              Solar Equipment
            </Link>
          )
        }
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* ── The partners ─────────────────────────────────────────────────
          Sticky on a wide screen so the panel scrolls under it: setting a
          lender up means moving between its tabs, not losing your place in
          the list of who they all are. */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="space-y-2">
          {canEdit && <AddLenderDialog onAdded={setSelectedId} full />}

          {lenders.length > 6 && (
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a partner"
                aria-label="Find a financing partner"
                className="h-8 pl-8 pr-8"
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}

          <nav
            aria-label="Financing partners"
            className="max-h-[20rem] space-y-1 overflow-y-auto pr-1 lg:max-h-[calc(100vh-13rem)]"
          >
            {shownLive.map((l) => (
              <LenderRailRow
                key={l.id}
                lender={l}
                selected={l.id === selected?.id}
                onSelect={() => setSelectedId(l.id)}
              />
            ))}

            {shownRetired.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Retired ({shownRetired.length})
                </p>
                {shownRetired.map((l) => (
                  <LenderRailRow
                    key={l.id}
                    lender={l}
                    selected={l.id === selected?.id}
                    onSelect={() => setSelectedId(l.id)}
                  />
                ))}
              </>
            )}

            {shownLive.length === 0 && shownRetired.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No partner matches &ldquo;{query}&rdquo;.
              </p>
            )}
          </nav>
        </div>
      </aside>

      {selected && (
        <LenderDetail
          // Keyed so switching partners remounts the panel: the draft belongs
          // to the lender it was seeded from, and carrying it across would
          // offer to save one partner's price onto another.
          key={selected.id}
          lender={selected}
          canEdit={canEdit}
          sellableEquipment={sellableEquipment}
          targetNetPpwCents={targetNetPpwCents}
          adderCatalogue={adderCatalogue}
          tab={tab}
          onTabChange={setTab}
          onDeleted={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

/**
 * One partner in the rail: who they are, and whether they are ready to sell on.
 *
 * The second line is the thing the old grid could not say — a lender with no
 * approved equipment or nothing on its rate sheet produces empty lists and
 * unquotable deals, and that was only discoverable by opening it.
 */
function LenderRailRow({
  lender,
  selected,
  onSelect,
}: {
  lender: LenderRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const products = lender.products.filter((p) => p.isActive).length;
  const needsWork = lender.isActive && (products === 0 || lender.approvedCount === 0);

  const price =
    lender.maxFinalPpwCents != null
      ? `${lender.finalPpwMode === "flat" ? "Flat" : "Max"} $${ppwToDollars(lender.maxFinalPpwCents)}/W`
      : `${products} ${products === 1 ? "programme" : "programmes"}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
        selected
          ? "border-gold/50 bg-gold/[0.08]"
          : "border-transparent hover:border-border hover:bg-muted/50",
        !lender.isActive && "opacity-70"
      )}
    >
      <LenderMark name={lender.name} logoUrl={lender.logoUrl} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{lender.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {needsWork ? (products === 0 ? "no programmes yet" : "no equipment approved") : price}
        </span>
      </span>
      {needsWork && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
          aria-label="Needs setup"
          role="img"
        />
      )}
    </button>
  );
}

/** Adding a partner: a name, and anything worth remembering about them. */
function AddLenderDialog({ onAdded, full }: { onAdded: (id: string) => void; full?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await upsertSolarLenderAction(null, {
        name: name.trim(),
        notes: notes.trim() || null,
      });
      if (!res.ok) return toast.error(res.error);
      // Open what was just created rather than leaving somebody on whoever
      // happened to be selected — adding a partner is the first step of setting
      // one up, not an end in itself.
      onAdded(res.id);
      setName("");
      setNotes("");
      setOpen(false);
      toast.success(`${name.trim()} added`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className={full ? "w-full" : undefined}>
          <Plus className="size-4" /> New lender
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a financing partner</DialogTitle>
          <DialogDescription>
            Just a name to start with. Its price, rate sheet and disclosures are set on the panel
            next.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-lender-name">
              Name
            </Label>
            <Input
              id="new-lender-name"
              value={name}
              placeholder="e.g. Credit Human"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="new-lender-notes">
              Notes (optional)
            </Label>
            <Input
              id="new-lender-notes"
              value={notes}
              placeholder="Anything worth remembering about this partner"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            A partner with nothing on its rate sheet cannot be quoted on a deal, so the programmes
            it publishes are the next thing to fill in.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
            lender
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
