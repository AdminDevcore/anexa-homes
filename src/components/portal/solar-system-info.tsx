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

export type SystemSpecs = {
  module: string | null;
  moduleQty: number;
  moduleRatingW: number | null;
  inverter: string | null;
  battery: string | null;
  batteryQty: number;
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
  lenderId: string | null;
  inverterId: string | null;
  batteryId: string | null;
  lenders: { id: string; name: string; isActive: boolean; logoUrl: string | null }[];
  inverters: { id: string; label: string }[];
  batteries: { id: string; label: string }[];
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
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
 * Read on top, write underneath. The specs come from the proposal and are
 * deliberately not editable here: the panel count is what moves a customer's
 * price, and it moves it on the proposal or not at all.
 */
export function SolarSystemInfo({
  leadId,
  specs,
  build,
  canEdit,
}: {
  leadId: string;
  specs: SystemSpecs | null;
  build: SystemBuild;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    utilityAccountNo: build.utilityAccountNo ?? "",
    meterNo: build.meterNo ?? "",
    lenderId: build.lenderId ?? "",
    inverterId: build.inverterId ?? "",
    batteryId: build.batteryId ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const chosenLender = build.lenders.find((l) => l.id === form.lenderId) ?? null;

  async function save() {
    setBusy(true);
    const res = await saveSolarBuildDetailsAction({
      leadId,
      utilityAccountNo: form.utilityAccountNo.trim() || null,
      meterNo: form.meterNo.trim() || null,
      lenderId: form.lenderId || null,
      inverterId: form.inverterId || null,
      batteryId: form.batteryId || null,
    });
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Something went wrong.");
    toast.success("Build details saved");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {specs ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Group title="The array">
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
              above hide that. An array facing north is not a rounding error. */}
          {specs.arrays.length > 0 && (
            <div className="lg:col-span-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Arrays
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

      {/* ── Interconnection & equipment ─────────────────────────────────── */}
      <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Interconnection &amp; equipment
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Recorded when the job is built. None of this changes the customer&rsquo;s quote — only
            the panel count does that, and it lives on the proposal.
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

            <div className="space-y-1">
              <Label htmlFor="solar-lender" className="text-xs">Lender / approved-vendor list</Label>
              {/* The mark sits beside the select because a native <option>
                  cannot carry an image, and a custom listbox here would cost
                  ops the keyboard behaviour they already have. */}
              <div className="flex items-center gap-2">
                {chosenLender && (
                  <LenderMark name={chosenLender.name} logoUrl={chosenLender.logoUrl} size="md" />
                )}
                <select
                  id="solar-lender"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.lenderId}
                  disabled={!canEdit || build.lenders.length === 0}
                  onChange={(e) => set("lenderId", e.target.value)}
                >
                  <option value="">— any lender (no filtering) —</option>
                  {build.lenders.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}{l.isActive ? "" : " · retired"}
                    </option>
                  ))}
                </select>
              </div>
              {build.lenders.length === 0 ? (
                <p className="text-[11px] text-amber-700">
                  No lenders set up yet.{" "}
                  <Link href="/portal/settings/solar-lenders" className="underline underline-offset-2">
                    Add your lenders
                  </Link>{" "}
                  to filter equipment by an approved-vendor list.
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {form.lenderId
                    ? "Only equipment on this lender's approved list is offered below. Save to apply a change."
                    : "Pick a lender to narrow the equipment below to its approved list."}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["Inverter", "inverterId", build.inverters],
                ["Battery", "batteryId", build.batteries],
              ] as const).map(([label, key, options]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`solar-${key}`} className="text-xs">{label}</Label>
                  <select
                    id={`solar-${key}`}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={form[key]}
                    disabled={!canEdit || options.length === 0}
                    onChange={(e) => set(key, e.target.value)}
                  >
                    <option value="">— none —</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  {/* An empty dropdown is indistinguishable from a broken one. */}
                  {options.length === 0 && (
                    <p className="text-[11px] text-amber-700">
                      No {label.toLowerCase()}s available.{" "}
                      <Link href="/portal/settings/solar-equipment" className="underline underline-offset-2">
                        Open the catalogue
                      </Link>
                      .
                    </p>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={save}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}
                Save build details
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
