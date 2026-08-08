"use client";

// Dialogs, the address search box and the property-value display, moved out of
// canvassing-client.tsx unchanged. Splitting them out is what lets field-map.tsx
// stay a layout shell instead of a 1,700-line grab bag.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, UserSearch, UserPlus } from "lucide-react";
import { KNOCKED_DISPOSITIONS, dispositionMeta, type LatLng } from "@/lib/canvassing";
import type { KnockDTO, KnockDetailDTO, KnockEventDTO } from "@/server/modules/canvassing/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AddressAutocomplete } from "@/components/portal/address-autocomplete";
import {
  updateKnockAction,
  addKnockCommentAction,
  updateKnockContactAction,
  lookupOwnerAction,
  convertKnockToLeadAction,
  convertKnockToAppointmentAction,
  createTerritoryAction,
  assignKnockRepAction,
} from "@/server/modules/canvassing/actions";

// --- Property value (AVM) display ------------------------------------------
export const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
// Compact money for ranges/sales: $412k / $1.2M.
function shortUsd(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(d % 1_000_000 === 0 ? 0 : 1)}M`;
  return `$${Math.round(d / 1000)}k`;
}
function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function yearOf(iso: string): string {
  const m = iso.match(/^(\d{4})/);
  return m ? m[1] : "";
}

type PropertyValueResp = {
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: "high" | "medium" | "low" | null;
  matched: boolean;
  source: string;
  asOfDate: string;
  lastSalePrice: number | null;
  lastSaleDate: string | null;
  assessedValue: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
};

const CONFIDENCE_LABEL: Record<string, string> = { high: "high confidence", medium: "med confidence", low: "low confidence" };

/**
 * Lazily resolves and shows a house's real estimated value as a RANGE with a
 * confidence label, last sale, and source/date — never a single hard number.
 * The fetch fires when this mounts (per open sheet/dialog, not per house).
 * Server caches by address.
 */
export function PropertyInfo({
  knockId,
  lat,
  lng,
  address,
}: {
  knockId?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
}) {
  const { data, isLoading } = useQuery<PropertyValueResp | null>({
    queryKey: ["property-value", knockId ?? `${lat.toFixed(5)},${lng.toFixed(5)}`],
    queryFn: async () => {
      const p = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (address) p.set("address", address);
      if (knockId) p.set("knockId", knockId);
      const r = await fetch(`/api/canvassing/property-value?${p.toString()}`);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
  });

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Estimating value…
      </span>
    );
  }
  // Honest: no confident match → don't show a misleading number.
  if (!data || !data.matched || data.value == null) {
    return (
      <span className="text-xs text-muted-foreground">
        Estimate unavailable / unverified{data?.source && data.source !== "Unavailable" ? ` · ${data.source}` : ""}
      </span>
    );
  }

  const range =
    data.low != null && data.high != null ? `${shortUsd(data.low)}–${shortUsd(data.high)}` : shortUsd(data.value);
  const conf = data.confidence ? CONFIDENCE_LABEL[data.confidence] : null;
  const structure = [
    data.beds != null ? `${data.beds} bd` : null,
    data.baths != null ? `${data.baths} ba` : null,
    data.sqft != null ? `${data.sqft.toLocaleString("en-US")} sqft` : null,
    data.yearBuilt != null ? `${data.yearBuilt}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-0.5 text-right">
      <div className="text-sm font-semibold tabular-nums">
        {range}
        {conf && <span className="ml-1 text-xs font-normal text-muted-foreground">· {conf}</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">
        est. · {data.source}
        {data.asOfDate ? ` · ${monthYear(data.asOfDate)}` : ""}
      </div>
      {data.lastSalePrice != null && (
        <div className="text-[11px] text-muted-foreground">
          Sold {shortUsd(data.lastSalePrice)}
          {data.lastSaleDate ? ` · ${yearOf(data.lastSaleDate)}` : ""}
        </div>
      )}
      {structure.length > 0 && <div className="text-[11px] text-muted-foreground">{structure.join(" · ")}</div>}
    </div>
  );
}

/**
 * Address search box for the field map. Picking a result jumps the map to that
 * house and drops a pulsing highlight on the dot to tap.
 *
 * Shares `AddressAutocomplete` with every other address field in the app, which
 * is what gets house numbers into this box: the old bespoke version proxied
 * Nominatim, and on a TIGER-only street the best it could offer was the street.
 * Searching for a specific house then centred the map on the block.
 */
export function AddressSearch({ onSelect }: { onSelect: (lat: number, lng: number) => void }) {
  const [term, setTerm] = React.useState("");

  return (
    <AddressAutocomplete
      value={term}
      onChange={setTerm}
      onSelect={(parts) => {
        onSelect(parts.lat, parts.lng);
        // Collapse to street + city; the full formatted line overflows the
        // floating box on a phone.
        setTerm([parts.address, parts.city].filter(Boolean).join(", ") || parts.formatted);
      }}
      mode="single"
      placeholder="Search an address…"
      aria-label="Search an address on the map"
      className="w-full"
      inputClassName="h-10 bg-background/95 pl-8 shadow backdrop-blur"
      leading={
        <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      }
    />
  );
}

/** Skip-trace alternates as clickable chips — tap one to drop it into a contact field. */
function OwnerChips({ label, values, onPick }: { label: string; values: string[]; onPick: (v: string) => void }) {
  if (!values || values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] hover:border-gold/50 hover:bg-muted"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function TerritoryDialog({
  points,
  defaultName = "",
  reps,
  onClose,
  onSaved,
}: {
  points: LatLng[] | null;
  defaultName?: string;
  reps: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (territoryId: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#F4631E");
  const [repId, setRepId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // undefined = still counting, null = count unavailable, number = home count
  const [houseCount, setHouseCount] = React.useState<number | null | undefined>(undefined);

  React.useEffect(() => {
    if (!points) return;
    setName(defaultName);
    setColor("#F4631E");
    setRepId("");
    setHouseCount(undefined);
    let cancelled = false;
    fetch("/api/canvassing/house-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ring: points }),
    })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setHouseCount(typeof d?.count === "number" ? d.count : null); })
      .catch(() => { if (!cancelled) setHouseCount(null); });
    return () => { cancelled = true; };
  }, [points, defaultName]);

  async function save() {
    if (!points) return;
    if (!name.trim()) return toast.error("Give the territory a name.");
    setBusy(true);
    const res = await createTerritoryAction({ name: name.trim(), color, polygon: points, assignedRepId: repId || null });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Territory created");
    onSaved(res.id);
  }

  return (
    <Dialog open={!!points} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New territory</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="terr-name">Name</Label>
            <Input id="terr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Frisco" />
          </div>
          <div className="flex items-center gap-3">
            <div>
              <Label htmlFor="terr-color">Color</Label>
              <input id="terr-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 h-10 w-16 cursor-pointer rounded border border-border bg-background" />
            </div>
            <div className="flex-1">
              <Label htmlFor="terr-rep">Assign to</Label>
              <select id="terr-rep" value={repId} onChange={(e) => setRepId(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                <option value="">Unassigned</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {houseCount === undefined
              ? "Counting homes in this area…"
              : houseCount === null
                ? `${points?.length ?? 0} boundary points · houses inside will be added automatically.`
                : `≈ ${houseCount.toLocaleString()} home${houseCount === 1 ? "" : "s"} in this area · ${
                    houseCount > 1500 ? "first 1,500 will be added as pins" : "all will be added automatically"
                  }.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create &amp; populate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConvertDialog({
  knock,
  onClose,
  onConverted,
}: {
  knock: KnockDTO | null;
  onClose: () => void;
  onConverted: (leadId: string) => void;
}) {
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (knock) {
      setFirstName("");
      setLastName("");
      setPhone("");
    }
  }, [knock]);

  async function convert() {
    if (!knock) return;
    setBusy(true);
    const res = await convertKnockToLeadAction({
      id: knock.id,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    onConverted(res.leadId);
  }

  return (
    <Dialog open={!!knock} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert knock to appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{knock?.address ?? "This house"} will become an appointment assigned to its rep.</p>
          {knock && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Estimated value (saved to appointment)</span>
              <PropertyInfo knockId={knock.id} lat={knock.lat} lng={knock.lng} address={knock.address} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cv-first">First name</Label>
              <Input id="cv-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="cv-last">Last name</Label>
              <Input id="cv-last" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div>
            <Label htmlFor="cv-phone">Phone</Label>
            <Input id="cv-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={convert} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function eventLabel(ev: KnockEventDTO): string {
  switch (ev.type) {
    case "status_change":
      return `Status → ${ev.disposition ? dispositionMeta(ev.disposition).label : "updated"}`;
    case "comment":
      return "Comment";
    case "contact_update":
      return "Updated contact";
    case "lead_created":
      return "Converted to appointment";
    default:
      return "Created";
  }
}

export function KnockDetailDialog({
  id,
  canManage,
  ownerLookupEnabled,
  reps,
  onClose,
  onChanged,
  onConvert,
}: {
  id: string | null;
  canManage: boolean;
  ownerLookupEnabled: boolean;
  reps: { id: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
  onConvert: (k: KnockDTO) => void;
}) {
  const { data: detail, refetch, isFetching } = useQuery<KnockDetailDTO>({
    queryKey: ["knock-detail", id],
    queryFn: async () => {
      const r = await fetch(`/api/canvassing/knock/${id}`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  const [comment, setComment] = React.useState("");
  const [contact, setContact] = React.useState({ contactName: "", contactPhone: "", contactEmail: "", bestTime: "" });
  const [savingContact, setSavingContact] = React.useState(false);
  const [lookingUp, setLookingUp] = React.useState(false);
  const [apptAt, setApptAt] = React.useState("");
  const [apptRep, setApptRep] = React.useState("");
  const [bookingAppt, setBookingAppt] = React.useState(false);

  React.useEffect(() => {
    if (detail) {
      setComment("");
      setContact({
        contactName: detail.contactName ?? "",
        contactPhone: detail.contactPhone ?? "",
        contactEmail: detail.contactEmail ?? "",
        bestTime: detail.bestTime ?? "",
      });
      setApptRep(detail.repId ?? "");
      setApptAt(detail.appointmentAt ? detail.appointmentAt.slice(0, 16) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  // Resolve "Address pending" once: reverse-geocode and persist the real address.
  React.useEffect(() => {
    if (!detail || detail.address || !id) return;
    let cancelled = false;
    fetch(`/api/canvassing/reverse?lat=${detail.lat}&lng=${detail.lng}`)
      .then((r) => r.json())
      .then(async (d: { address?: string }) => {
        if (cancelled || !d.address) return;
        const res = await updateKnockAction({ id, address: d.address });
        if (res.ok) {
          await refetch();
          onChanged();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  async function setStatus(d: string) {
    if (!id) return;
    const res = await updateKnockAction({ id, disposition: d });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    await refetch();
    onChanged();
  }
  async function addComment() {
    if (!id || !comment.trim()) return;
    const res = await addKnockCommentAction({ knockId: id, body: comment });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    setComment("");
    await refetch();
    onChanged();
  }
  async function saveContact() {
    if (!id) return;
    setSavingContact(true);
    const res = await updateKnockContactAction({ knockId: id, ...contact });
    setSavingContact(false);
    if (!res.ok) return toast.error(res.error ?? "Failed");
    toast.success("Contact saved");
    await refetch();
    onChanged();
  }
  async function lookupOwner() {
    if (!id) return;
    setLookingUp(true);
    const res = await lookupOwnerAction({ knockId: id });
    setLookingUp(false);
    if (!res.ok) return toast.error(res.error ?? "Lookup failed");
    // Fill any blank field with the top match; the rep can pick alternates or edit.
    setContact((c) => ({
      ...c,
      contactName: c.contactName || res.applied.contactName || "",
      contactPhone: c.contactPhone || res.applied.contactPhone || "",
      contactEmail: c.contactEmail || res.applied.contactEmail || "",
    }));
    const n = res.result.names.length, p = res.result.phones.length, e = res.result.emails.length;
    toast.success(`Owner found via ${res.result.source} — ${n} name${n === 1 ? "" : "s"}, ${p} phone${p === 1 ? "" : "s"}, ${e} email${e === 1 ? "" : "s"}`);
    await refetch();
    onChanged();
  }
  async function setRep(repId: string) {
    if (!id) return;
    const res = await assignKnockRepAction({ knockId: id, repId: repId || null });
    if (!res.ok) return toast.error(res.error ?? "Failed");
    await refetch();
    onChanged();
  }
  async function bookAppointment() {
    if (!id) return;
    if (!apptAt) return toast.error("Pick a date and time.");
    setBookingAppt(true);
    const res = await convertKnockToAppointmentAction({
      knockId: id,
      appointmentAt: new Date(apptAt).toISOString(),
      repId: apptRep || null,
    });
    setBookingAppt(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Appointment booked + task created");
    await refetch();
    onChanged();
  }

  const blank = detail?.disposition === "not_knocked";

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail?.address ?? "House detail"}</DialogTitle>
        </DialogHeader>
        {!detail ? (
          <div className="py-10 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {detail.territoryName && <span>Territory: {detail.territoryName}</span>}
              <span>Rep: {detail.repName ?? "Unassigned"}</span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">Estimated property value</span>
              <PropertyInfo knockId={detail.id} lat={detail.lat} lng={detail.lng} address={detail.address} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <select
                value={blank ? "" : detail.disposition}
                onChange={(e) => e.target.value && setStatus(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
              >
                {blank && <option value="">Set status…</option>}
                {KNOCKED_DISPOSITIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            {canManage && (
              <div className="space-y-1.5">
                <Label className="text-xs">Assigned rep</Label>
                <select
                  value={detail.repId ?? ""}
                  onChange={(e) => setRep(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">Homeowner contact</p>
                {ownerLookupEnabled && detail?.address && (
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={lookupOwner} disabled={lookingUp}>
                    {lookingUp ? <Loader2 className="size-3.5 animate-spin" /> : <UserSearch className="size-3.5" />}
                    {detail?.owner ? "Re-run lookup" : "Look up owner"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Name" value={contact.contactName} onChange={(e) => setContact((c) => ({ ...c, contactName: e.target.value }))} />
                <Input placeholder="Phone" value={contact.contactPhone} onChange={(e) => setContact((c) => ({ ...c, contactPhone: e.target.value }))} />
                <Input placeholder="Email" value={contact.contactEmail} onChange={(e) => setContact((c) => ({ ...c, contactEmail: e.target.value }))} />
                <Input placeholder="Best time to reach" value={contact.bestTime} onChange={(e) => setContact((c) => ({ ...c, bestTime: e.target.value }))} />
              </div>

              {/* Skip-trace alternates — click a chip to drop it into the matching field. */}
              {detail?.owner && (
                <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
                  <p className="text-[11px] text-muted-foreground">
                    From {detail.owner.source}
                    {detail.ownerLookedUpAt ? ` · checked ${new Date(detail.ownerLookedUpAt).toLocaleDateString()}` : ""} — tap to use:
                  </p>
                  <OwnerChips label="Names" values={detail.owner.names} onPick={(v) => setContact((c) => ({ ...c, contactName: v }))} />
                  <OwnerChips label="Phones" values={detail.owner.phones} onPick={(v) => setContact((c) => ({ ...c, contactPhone: v }))} />
                  <OwnerChips label="Emails" values={detail.owner.emails} onPick={(v) => setContact((c) => ({ ...c, contactEmail: v }))} />
                </div>
              )}

              <Button size="sm" variant="outline" onClick={saveContact} disabled={savingContact}>
                {savingContact && <Loader2 className="size-3.5 animate-spin" />} Save contact
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Add a comment</Label>
              <div className="flex gap-2">
                <Textarea
                  rows={1}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. callback Tuesday 6pm; spoke to homeowner, wants a quote"
                  className="min-h-9"
                />
                <Button size="sm" onClick={addComment} disabled={!comment.trim()}>Add</Button>
              </div>
            </div>

            {/* Convert to appointment */}
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium">
                Appointment
                {detail.appointmentAt && (
                  <span className="ml-2 font-normal text-gold">booked {new Date(detail.appointmentAt).toLocaleString()}</span>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="datetime-local"
                  value={apptAt}
                  onChange={(e) => setApptAt(e.target.value)}
                  className="w-48"
                />
                <select
                  value={apptRep}
                  onChange={(e) => setApptRep(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-2 text-sm"
                >
                  <option value="">{detail.repName ? `Keep ${detail.repName}` : "Assign rep"}</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <Button size="sm" onClick={bookAppointment} disabled={bookingAppt || !apptAt}>
                  {bookingAppt && <Loader2 className="size-3.5 animate-spin" />} Book appointment time
                </Button>
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium">Visit history {isFetching && <Loader2 className="ml-1 inline size-3 animate-spin" />}</p>
              <ul className="space-y-1.5">
                {detail.events.length === 0 && <li className="text-xs text-muted-foreground">No activity yet.</li>}
                {detail.events.map((ev) => (
                  <li key={ev.id} className="rounded-md border border-border/60 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{eventLabel(ev)}</span>
                      <span className="tabular-nums">{new Date(ev.createdAt).toLocaleString()}</span>
                    </div>
                    {ev.body && <p className="mt-0.5 whitespace-pre-wrap text-sm">{ev.body}</p>}
                    {ev.authorName && <p className="text-[10px] text-muted-foreground">by {ev.authorName}</p>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center gap-2 border-t border-border pt-3">
              {detail.leadId ? (
                <span className="text-sm font-medium text-gold">Appointment created from this house ✓</span>
              ) : (
                <Button size="sm" onClick={() => onConvert(detail as KnockDTO)}>
                  <UserPlus className="size-3.5" /> Create appointment from this house
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
