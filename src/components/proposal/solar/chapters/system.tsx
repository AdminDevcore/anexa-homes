"use client";

import * as React from "react";
import { Plate, GlassCard, FigureRow, Chapter, SpecList, EquipCard } from "../primitives";
import { ArrayMap } from "../../array-map";
import { kwh, pctWhole } from "../../format";
import type { Doc } from "./doc";

/** The hardware, named once, for the card on the plate and the paper fallback. */
function hardwareRows(doc: Doc): [string, React.ReactNode][] {
  const { s } = doc;
  const panel = s.system.module;
  const inverter = s.system.inverter;
  const battery = s.system.battery;
  const name = (e: { manufacturer: string | null; model: string } | null, fallback: string | null) =>
    e ? [e.manufacturer, e.model].filter(Boolean).join(" ") : fallback;

  return [
    [
      "Panels",
      panel
        ? `${panel.qty || s.system.moduleQty} × ${name(panel, null)}`
        : s.system.moduleLabel
          ? `${s.system.moduleQty} × ${s.system.moduleLabel}`
          : null,
    ],
    ["Inverter", name(inverter, s.system.inverterLabel)],
    [
      "Battery",
      battery
        ? `${battery.qty > 1 ? `${battery.qty} × ` : ""}${name(battery, null)}`
        : s.system.batteryLabel,
    ],
    ["Mounting", s.system.mountType === "ground" ? "Ground mount" : "Roof mount"],
    ["Utility", s.system.utilityProvider],
    ["Billing programme", s.system.netMeteringProgram],
  ];
}

/** The figures along the foot. Battery capacity only where there is a battery. */
function figures(doc: Doc) {
  const { s } = doc;
  const battery = s.system.battery;
  return [
    { k: "System size", v: `${s.system.sizeKwDc.toFixed(2)} kW`, note: "DC, at standard test" },
    { k: "Year one", v: kwh(s.system.year1ProductionKwh), note: "made on your roof" },
    { k: "Covers", v: pctWhole(s.system.offsetPct), note: "of what you use", accent: true },
    ...(battery && battery.ratingW
      ? [
          {
            k: "Storage",
            v: `${((battery.ratingW * Math.max(1, battery.qty)) / 1000).toFixed(1)} kWh`,
            note: battery.qty > 1 ? `${battery.qty} units` : "usable capacity",
          },
        ]
      : []),
  ];
}

const CAPTION_PRELIM =
  "Preliminary design. The final layout is confirmed at your site survey and may change once the roof and electrical panel have been measured.";
const CAPTION_FINAL =
  "Final design, confirmed by your project team. Minor adjustments can still arise during installation.";

const WARRANTY =
  "Manufacturer warranties apply to each component as published by that manufacturer. Your written agreement sets out the workmanship warranty in full.";

/**
 * 02 · THE DESIGN.
 *
 * The slide people screenshot and send to their partner. Their own roof, their
 * own array on it, running the full bleed of the sheet with the hardware in a
 * glass card — the cover's grammar, and the reason the eight chapters behind
 * the cover now look like they belong to it.
 *
 * It absorbs the equipment sheet. That used to be a page of its own carrying
 * three product cards and no chapter mark, which on paper read as a leftover.
 * The hardware is named once, in the card.
 *
 * THE FALLBACK IS NOT DECORATION. `hasLayout` is false on plenty of real deals —
 * an address never geocoded, no uploaded drawing, a FileAsset whose object went
 * missing — and a plate with no picture is a grey rectangle where the roof
 * should be, on the one sheet that has to look like somebody did the work. When
 * there is nothing to draw, this is a PAPER chapter instead: the specification
 * takes the sheet and the equipment cards come back. Never a placeholder, never
 * an empty frame, and never the bare aerial with no array on it standing in for
 * a design nobody has done yet.
 */
export function ChapterSystem({
  doc,
  siteImageBase,
  layoutImageUrl,
}: {
  doc: Doc;
  siteImageBase: string | null;
  layoutImageUrl: string | null;
}) {
  const { s } = doc;
  const sitePanels = s.site?.panels ?? [];
  const hasArrayMap = !!(siteImageBase && s.site && sitePanels.length > 0);
  const hasUploadedLayout = !!(s.layout && layoutImageUrl);
  const hasEquipment = !!(s.system.module || s.system.inverter || s.system.battery);

  const caption = `${s.layout?.preliminary === false ? CAPTION_FINAL : CAPTION_PRELIM}${
    s.layout?.provider ? ` Produced in ${s.layout.provider}.` : ""
  }`;

  const rows = hardwareRows(doc).filter(([, v]) => v);

  /* ── no drawing: the chapter is paper ──────────────────────────────── */
  if (!hasArrayMap && !hasUploadedLayout) {
    return (
      <Chapter
        id="system"
        index={doc.num("system")}
        total={doc.total}
        eyebrow="The design"
        title="Your system"
        lede={
          <>
            {s.system.moduleQty > 0 ? `${s.system.moduleQty} panels ` : "An array "}
            sized to cover {pctWhole(s.system.offsetPct)} of what this home used last year.
          </>
        }
      >
        <SpecList
          items={[
            ["Size", `${s.system.sizeKwDc.toFixed(2)} kW-DC`],
            ["Year-one production", kwh(s.system.year1ProductionKwh)],
            ["Energy offset", `${pctWhole(s.system.offsetPct)} of your usage`],
            ...rows,
          ]}
        />
        {hasEquipment && (
          <>
            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <EquipCard i={0} label="Panels" e={s.system.module} unit="W each" />
              <EquipCard i={1} label="Inverter" e={s.system.inverter} unit="W" />
              <EquipCard i={2} label="Battery" e={s.system.battery} unit="Wh" />
            </div>
            <p className="mt-4 max-w-[62ch] text-sm text-neutral-500">{WARRANTY}</p>
          </>
        )}
      </Chapter>
    );
  }

  /* ── the plate ─────────────────────────────────────────────────────── */
  const uploaded = (
    /* eslint-disable-next-line @next/next/no-img-element -- served from a
       token-scoped route, not the image pipeline, on a public document. */
    <img
      src={layoutImageUrl ?? ""}
      alt={`${s.layout?.preliminary === false ? "Panel" : "Preliminary panel"} layout for ${s.customer.address}`}
      className="size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
    />
  );

  return (
    <Plate
      id="system"
      index={doc.num("system")}
      total={doc.total}
      eyebrow="The design"
      title={
        s.system.moduleQty > 0 ? (
          <>
            {s.system.moduleQty} panels,
            <br />
            on your roof.
          </>
        ) : (
          <>Your system, on your roof.</>
        )
      }
      lede={
        <>
          Sized to cover {pctWhole(s.system.offsetPct)} of what this home used last year — measured
          from your own bill, not a regional average.
        </>
      }
      background={
        hasArrayMap && s.site ? (
          <div className="size-full [&_*]:!rounded-none">
            <ArrayMap
              lat={s.site.lat}
              panels={sitePanels}
              imageUrl={(z) => `${siteImageBase}?z=${z}`}
              /* The sheet's own proportions. The imagery arrives square, so a
                 wide frame crops it rather than squashing it and the panels
                 stay on the shingles they were drawn on — see ArrayMap. */
              aspect={11 / 8.5}
              fallback={hasUploadedLayout ? uploaded : null}
            />
          </div>
        ) : (
          uploaded
        )
      }
      card={
        rows.length > 0 ? (
          <GlassCard className="w-full px-6 py-6 sm:px-6 sm:py-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
              The hardware
            </p>
            <div className="mt-3">
              <SpecList items={rows} />
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">{WARRANTY}</p>
          </GlassCard>
        ) : null
      }
      figures={<FigureRow items={figures(doc)} />}
      caption={caption}
    />
  );
}
