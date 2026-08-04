"use client";

// The point of the whole redesign: tap a house, tap a disposition, done.
// A Leaflet popup can't do this — it clips at screen edges, shoves the map
// around, and has no room for a 56px tap target.
import * as React from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { KNOCKED_DISPOSITIONS } from "@/lib/canvassing";
import type { KnockDTO } from "@/server/modules/canvassing/queries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { HouseStormInfo } from "@/components/portal/storm/house-storm-info";
import { UserSearch, Move, UserPlus, Check, Trash2, ChevronUp } from "lucide-react";
import { usd } from "./dialogs";

export type KnockSheetProps = {
  knock: KnockDTO | null;
  ownerLookupEnabled: boolean;
  canManage: boolean;
  onClose: () => void;
  onDisposition: (k: KnockDTO, disposition: string) => Promise<void>;
  onOpenDetails: (k: KnockDTO) => void;
  onLookupOwner: (k: KnockDTO) => void;
  onConvert: (k: KnockDTO) => void;
  onMove: (k: KnockDTO) => void;
  onDelete: (k: KnockDTO) => void;
  /** Hail history for the address — meaningless outside a storm vertical. */
  storm: boolean;
};

const isHouseDot = (k: KnockDTO) => k.id.startsWith("house:");

export function KnockSheet({
  knock,
  ownerLookupEnabled,
  canManage,
  onClose,
  onDisposition,
  onOpenDetails,
  onLookupOwner,
  onConvert,
  onMove,
  onDelete,
  storm,
}: KnockSheetProps) {
  // Callers mount this with key={knock.id}, so opening a different house
  // remounts and both of these reset to their peek/idle defaults for free.
  const [expanded, setExpanded] = React.useState(false);
  const [saving, setSaving] = React.useState<string | null>(null);

  if (!knock) return null;
  const k = knock;

  async function pick(disposition: string) {
    setSaving(disposition);
    try {
      await onDisposition(k, disposition);
      onClose();
    } catch {
      toast.error("Couldn't save that knock.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <SheetHeader className="gap-1 p-0 pr-8 text-left">
          <SheetTitle className="text-base font-semibold leading-tight">
            {k.address ?? "House"}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {k.propertyValue != null ? `~${usd(k.propertyValue)} est.` : "Open More for a value estimate"}
            {k.contactName ? ` · ${k.contactName}` : ""}
            {canManage && k.repName ? ` · knocked by ${k.repName}` : ""}
          </p>
        </SheetHeader>

        {/* One tap logs the knock and closes the sheet. Two taps total. */}
        <div className="grid grid-cols-3 gap-2">
          {KNOCKED_DISPOSITIONS.map((d) => {
            const active = k.disposition === d.value;
            return (
              <button
                key={d.value}
                type="button"
                disabled={saving !== null}
                onClick={() => void pick(d.value)}
                aria-pressed={active}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-2 py-2 text-xs font-semibold leading-tight transition-transform active:scale-95 disabled:opacity-50"
                style={{
                  borderColor: d.color,
                  background: active ? d.color : "transparent",
                  color: active ? "#fff" : undefined,
                }}
              >
                <span aria-hidden className="text-base leading-none">{d.glyph}</span>
                {d.label}
              </button>
            );
          })}
        </div>

        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex w-full items-center justify-center gap-1 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronUp className="size-3.5" /> More — owner, value, notes, appointment
          </button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3 border-t border-border pt-3"
          >
            {storm && <HouseStormInfo lat={k.lat} lng={k.lng} />}
            {!k.contactName && ownerLookupEnabled && k.address && (
              <button
                onClick={() => onLookupOwner(k)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gold"
              >
                <UserSearch className="size-4" /> Look up owner
              </button>
            )}
            {k.notes && <p className="text-sm text-muted-foreground">{k.notes}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {k.leadId ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gold">
                  <Check className="size-4" /> Appointment created
                </span>
              ) : (
                <button
                  onClick={() => onConvert(k)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-gold"
                >
                  <UserPlus className="size-4" /> Convert to appointment
                </button>
              )}
              <button
                onClick={() => onOpenDetails(k)}
                className="text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                Details
              </button>
              <button
                onClick={() => onMove(k)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Move className="size-4" /> Move pin
              </button>
              {!isHouseDot(k) && (
                <button
                  onClick={() => onDelete(k)}
                  aria-label="Delete pin"
                  className="ml-auto text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </SheetContent>
    </Sheet>
  );
}
