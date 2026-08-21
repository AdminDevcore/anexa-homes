"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LenderMark } from "@/components/ui/lender-mark";
import { compassLabel, tiltDegToPitch } from "@/lib/solar-orientation";
import { saveSolarBuildDetailsAction } from "@/server/modules/solar/actions";

/** One array as the layout designer drew it, flattened for display. */
export type SystemArray = {
  id: string;
  panels: number;
  azimuthDeg: number | null;
  tiltDeg: number | null;
  shadePct: number | null;
};

/**
 * Where the figures below came from.
 *
 * A proposal is a frozen document; the design underneath it keeps moving. This
 * slide says which of the two it is reporting rather than showing numbers of
 * unstated provenance — `label` is built on the server so this stays free of
 * date formatting.
 */
export type SpecSource =
  | { kind: "proposal"; label: string }
  | { kind: "design"; label: string };

export type SystemSpecs = {
  module: string | null;
  moduleQty: number;
  moduleRatingW: number | null;
  inverter: string | null;
  battery: string | null;
  batteryQty: number;
  /** The financing partner as the proposal froze it. Null on a cash quote. */
  lender: string | null;
  lenderLogoUrl: string | null;
  sizeKwDc: number;
  sizeKwAc: number;
  year1Kwh: number;
  offsetPct: number;
  mountType: string;
  tsrfPct: number | null;
  yieldSource: string | null;
  yieldStation: string | null;
  annualUsageKwh: number | null;
  rateMills: number | null;
  ratePlan: string | null;
  netMeteringProgram: string | null;
  arrays: SystemArray[];
  setbackNotes: string | null;
  structuralNotes: string | null;
  electricalNotes: string | null;
};

export type SystemBuild = {
  hasDesign: boolean;
  utilityAccountNo: string | null;
  meterNo: string | null;
};

/** A label/value row, the deal page's own vocabulary. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {hint && <span className="ml-1.5 font-normal normal-case tracking-normal">· {hint}</span>}
      </div>
      <dl className="mt-1.5">{children}</dl>
    </div>
  );
}

/** An em dash, so an unset figure reads as unset rather than as zero. */
const NOT_SET = <span className="font-normal text-muted-foreground">—</span>;

/**
 * Everything technical about the physical system, in one place.
 *
 * Two halves that were previously nowhere and somewhere-wrong respectively:
 *
 * The specs were only ever visible as four totals on System & financing —
 * size, production, offset, cost. What the array is actually MADE of, and
 * which way each bank of it points, existed only inside the proposal builder,
 * so "why is this only offsetting 38%?" could not be answered from the deal.
 *
 * The equipment fields sat inside the Operations card, which is the chase:
 * who we are waiting on and when we last pushed. A meter number is not a chase
 * — it is what got installed — and burying it under a follow-up log is how it
 * went unfilled.
 *
 * READ-ONLY, and read off the LAST PROPOSAL wherever the proposal has an
 * opinion. Modules, inverter, battery and lender used to be dropdowns here as
 * well as choices in the builder, which is one field with two owners: a rep
 * quotes a customer a Tesla inverter on a signed document and ops swaps it on
 * this card a fortnight later, and now the deal and the customer's copy
 * disagree with nobody informed. The proposal is the agreement, so the
 * proposal decides; this slide reports it and links back to the builder.
 * Only the interconnection numbers below — utility account and meter — are
 * genuinely ours to fill in after the fact.
 */
export function SolarSystemInfo({
  leadId,
  specs,
  source,
  build,
  canEdit,
}: {
  leadId: string;
  specs: SystemSpecs | null;
  source: SpecSource;
  build: SystemBuild;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    utilityAccountNo: build.utilityAccountNo ?? "",
    meterNo: build.meterNo ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const res = await saveSolarBuildDetailsAction({
        leadId,
        utilityAccountNo: form.utilityAccountNo.trim() || null,
        meterNo: form.meterNo.trim() || null,
      });
      if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
      toast.success("Interconnection saved");
      router.refresh();
    } finally {
      // In a `finally`, so a thrown action leaves the form usable instead of
      // latching the button on and stranding the fields.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Provenance first. Everything under this line is a report, not a form. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide text-foreground">
            {source.kind === "proposal" ? "As proposed" : "Working design"}
          </span>{" "}
          · {source.label}
        </p>
        <Link
          href={`/portal/leads/${leadId}/solar-proposal`}
          className="text-xs font-medium underline underline-offset-2"
        >
          {source.kind === "proposal" ? "Change in the proposal" : "Open the proposal builder"}
        </Link>
      </div>

      {specs ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Group title="The system">
            <Row
              label="Modules"
              value={
                specs.module ? (
                  <>
                    {specs.moduleQty} × {specs.module}
                    {specs.moduleRatingW ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({specs.moduleRatingW} W)
                      </span>
                    ) : null}
                  </>
                ) : (
                  NOT_SET
                )
              }
            />
            <Row label="Inverter" value={specs.inverter ?? NOT_SET} />
            <Row
              label="Battery"
              value={
                specs.battery
                  ? `${specs.batteryQty > 1 ? `${specs.batteryQty} × ` : ""}${specs.battery}`
                  : NOT_SET
              }
            />
            <Row label="Mount" value={<span className="capitalize">{specs.mountType}</span>} />
            <Row
              label="System size"
              value={
                specs.sizeKwDc
                  ? `${specs.sizeKwDc.toFixed(2)} kW DC${specs.sizeKwAc ? ` · ${specs.sizeKwAc.toFixed(2)} kW AC` : ""}`
                  : NOT_SET
              }
            />
            {/* The lender rides with the equipment it gates: its approved-vendor
                list is what makes one inverter quotable and another not. */}
            <Row
              label="Lender"
              value={
                specs.lender ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LenderMark name={specs.lender} logoUrl={specs.lenderLogoUrl} size="sm" />
                    {specs.lender}
                  </span>
                ) : (
                  NOT_SET
                )
              }
            />
          </Group>

          <Group title="Production">
            <Row
              label="Year-1 production"
              value={specs.year1Kwh ? `${specs.year1Kwh.toLocaleString()} kWh` : NOT_SET}
            />
            <Row label="Offset" value={specs.offsetPct ? `${Math.round(specs.offsetPct)}%` : NOT_SET} />
            <Row
              label="Annual usage"
              value={specs.annualUsageKwh ? `${specs.annualUsageKwh.toLocaleString()} kWh` : NOT_SET}
            />
            <Row
              label="Utility rate"
              value={specs.rateMills != null ? `$${(specs.rateMills / 1000).toFixed(3)}/kWh` : NOT_SET}
            />
            {/* Which model produced the number, so a figure that looks wrong can
                be traced instead of argued about. */}
            <Row
              label="Yield source"
              value={
                specs.yieldSource ? (
                  <>
                    <span className="uppercase">{specs.yieldSource}</span>
                    {specs.yieldStation && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {specs.yieldStation}
                      </span>
                    )}
                  </>
                ) : (
                  NOT_SET
                )
              }
            />
            {specs.tsrfPct != null && <Row label="TSRF" value={`${Math.round(specs.tsrfPct)}%`} />}
            {specs.ratePlan && <Row label="Rate plan" value={specs.ratePlan} />}
            {specs.netMeteringProgram && (
              <Row label="Net metering" value={specs.netMeteringProgram} />
            )}
          </Group>

          {/* Per array, because a design is rarely one plane and the totals
              above hide that. An array facing north is not a rounding error.

              Drawn from the LIVE layout, always: a proposal freezes a picture
              of the roof, not the per-plane angles behind it. Labelled as such
              when the figures above came from a proposal, so a redrawn roof
              cannot quietly read as part of the frozen document. */}
          {specs.arrays.length > 0 && (
            <div className="lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Arrays
                {source.kind === "proposal" && (
                  <span className="ml-1.5 font-normal normal-case tracking-normal">
                    · current drawing
                  </span>
                )}
              </div>
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">#</th>
                      <th className="py-1.5 font-medium">Panels</th>
                      <th className="py-1.5 font-medium">Facing</th>
                      <th className="py-1.5 font-medium">Pitch</th>
                      <th className="py-1.5 font-medium">Shade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {specs.arrays.map((a, i) => (
                      <tr key={a.id} className="border-b border-border/60 last:border-0">
                        <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 tabular-nums">{a.panels}</td>
                        <td className="py-1.5">
                          {a.azimuthDeg != null ? (
                            <>
                              {compassLabel(a.azimuthDeg)}{" "}
                              <span className="text-muted-foreground tabular-nums">
                                ({Math.round(a.azimuthDeg)}°)
                              </span>
                            </>
                          ) : (
                            NOT_SET
                          )}
                        </td>
                        <td className="py-1.5">
                          {a.tiltDeg != null ? (
                            <>
                              <span className="tabular-nums">{Math.round(a.tiltDeg)}°</span>{" "}
                              <span className="text-muted-foreground">
                                ({tiltDegToPitch(a.tiltDeg)})
                              </span>
                            </>
                          ) : (
                            NOT_SET
                          )}
                        </td>
                        <td className="py-1.5 tabular-nums">
                          {a.shadePct ? `${Math.round(a.shadePct)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(specs.setbackNotes || specs.structuralNotes || specs.electricalNotes) && (
            <div className="lg:col-span-2">
              <Group title="Site notes">
                {specs.setbackNotes && <Row label="Setbacks" value={specs.setbackNotes} />}
                {specs.structuralNotes && <Row label="Structural" value={specs.structuralNotes} />}
                {specs.electricalNotes && <Row label="Electrical" value={specs.electricalNotes} />}
              </Group>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No system design on this deal yet. Build the proposal and the specifications appear here.
        </p>
      )}

      {/* ── Interconnection ─────────────────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Interconnection
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            The utility&rsquo;s own numbers for this house, recorded when the job is built. The
            equipment and the lender are not set here — they are what the customer was quoted, so
            they change on the proposal.
          </p>
        </div>

        {!build.hasDesign ? (
          <p className="text-xs text-muted-foreground">
            No system design on this deal yet. Build the proposal first and these will attach to it.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="solar-utility-account" className="text-xs">Utility account #</Label>
                <Input
                  id="solar-utility-account"
                  value={form.utilityAccountNo}
                  disabled={!canEdit}
                  onChange={(e) => set("utilityAccountNo", e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="solar-meter-no" className="text-xs">Meter #</Label>
                <Input
                  id="solar-meter-no"
                  value={form.meterNo}
                  disabled={!canEdit}
                  onChange={(e) => set("meterNo", e.target.value)}
                />
              </div>
            </div>

            {canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={save}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                Save interconnection
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
