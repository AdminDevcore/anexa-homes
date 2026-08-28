"use client";

import * as React from "react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PenLine, Type, ShieldCheck, MapPin, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/marketing/logo";
import { submitSignatureByTokenAction } from "@/server/modules/esign/actions";
import { fillTokens, type AutofillContext } from "@/server/modules/esign/autofill";
import type { Snapshot, SnapshotField } from "@/server/modules/esign/pdf";
import { deriveInitials, mapAdoptedToFields, type AdoptedSignature } from "@/lib/esign-signature";
import { PdfCanvas } from "./pdf-canvas";
import { cursiveImage } from "@/lib/signature-image";

type Props = {
  token: string;
  title: string;
  signerName: string;
  snapshot: Snapshot;
  ctx: AutofillContext;
  signerFields: SnapshotField[];
  /** Rep handed their own device to the customer to sign in person. */
  inPerson?: boolean;
};

export function SigningExperience({ token, title, signerName, snapshot, ctx, signerFields, inPerson }: Props) {
  const today = ctx.today;
  const [consent, setConsent] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of signerFields) {
      if (f.valueToken) init[f.id] = fillTokens(f.valueToken, ctx); // auto-fill from CRM
      else if (f.type === "date") init[f.id] = today;
      else if (f.type === "checkbox") init[f.id] = "false";
    }
    return init;
  });
  const pdfUrl = snapshot.sourcePdfKey ? `/api/sign/${token}/pdf` : null;
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null);
  const [sigOpen, setSigOpen] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [geo, setGeo] = React.useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [geoStatus, setGeoStatus] = React.useState<"idle" | "loading" | "granted" | "denied">("idle");

  function captureLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGeoStatus("denied"); return; }
    setGeoStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  const pages = snapshot.pages?.length ? snapshot.pages : [{ width: 612, height: 792 }];
  const sigFields = signerFields.filter((f) => f.type === "signature" || f.type === "initials");
  const needSignature = sigFields.some((f) => f.type === "signature");
  const needInitials = sigFields.some((f) => f.type === "initials");

  function setValue(id: string, v: string) {
    setValues((s) => ({ ...s, [id]: v }));
  }

  function adoptSignature(adopted: AdoptedSignature) {
    // The signature image fills signature fields; the initials image fills
    // initials fields — never the full signature in an initials box.
    setSignatureUrl(adopted.signature ?? adopted.initials ?? null);
    setValues((s) => ({ ...s, ...mapAdoptedToFields(sigFields, adopted) }));
    setSigOpen(false);
  }

  async function submit() {
    if (!consent) {
      toast.error("Please consent to sign electronically.");
      return;
    }
    if (sigFields.length > 0 && !signatureUrl) {
      toast.error("Please add your signature.");
      setSigOpen(true);
      return;
    }
    setPending(true);
    const res = await submitSignatureByTokenAction(token, {
      consent,
      signatureType: "drawn",
      values,
      geo,
    });
    setPending(false);
    if (res.ok) {
      setDone(true);
      toast.success("Document signed successfully.");
    } else {
      toast.error(res.error ?? "Could not submit signature.");
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
        <CheckCircle2 className="size-14 text-gold" />
        <h1 className="font-display text-3xl font-semibold">All signed!</h1>
        <p className="text-muted-foreground">
          Thank you, {signerName}. Your signed copy of <strong>{title}</strong> has been securely
          stored. Anexa Homes will be in touch with next steps.
        </p>
        {inPerson && (
          <p className="rounded-lg border border-gold/40 bg-gold/5 px-4 py-3 text-sm font-medium text-gold-muted">
            Please hand the device back to your Anexa Homes representative.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40 pb-32">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Logo />
          <span className="hidden text-sm text-muted-foreground sm:block">{title}</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div className="rounded-xl border border-gold/40 bg-gold/5 p-4 text-sm">
          <p className="font-medium text-gold-muted">Please review and sign below</p>
          <p className="mt-1 text-muted-foreground">
            Signing as <strong>{signerName}</strong>. Fields highlighted in gold require your input.
          </p>
        </div>

        {pages.map((page, pi) => {
          const pageNum = pi + 1;
          const bodyOnPage = (snapshot.body ?? []).filter((b) => (b.page ?? 1) === pageNum);
          const fieldsOnPage = signerFields.filter((f) => (f.page ?? 1) === pageNum);
          return (
            <div
              key={pi}
              className="relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              {pdfUrl && <PdfCanvas url={pdfUrl} page={pageNum} className="block w-full" />}

              {!pdfUrl && bodyOnPage.map((b, bi) => (
                <div
                  key={bi}
                  className={cn(
                    "absolute text-black",
                    b.type === "heading" ? "font-display font-semibold" : ""
                  )}
                  style={{
                    left: `${(b.x / page.width) * 100}%`,
                    top: `${((page.height - b.y) / page.height) * 100}%`,
                    fontSize: b.type === "heading" ? "min(2.4vw, 18px)" : "min(1.5vw, 11px)",
                    transform: "translateY(-100%)",
                  }}
                >
                  {fillTokens(b.text, ctx)}
                </div>
              ))}

              {fieldsOnPage.map((f) => {
                const leftPct = (f.x / page.width) * 100;
                const topPct = ((page.height - f.y - f.height) / page.height) * 100;
                const wPct = (f.width / page.width) * 100;
                const hPct = (f.height / page.height) * 100;
                const v = values[f.id] ?? "";
                return (
                  <div
                    key={f.id}
                    className="absolute"
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      width: `${wPct}%`,
                      height: `${hPct}%`,
                    }}
                  >
                    {f.type === "signature" || f.type === "initials" ? (
                      <button
                        type="button"
                        onClick={() => setSigOpen(true)}
                        className={cn(
                          "flex size-full items-center justify-center rounded border-2 border-dashed text-[10px] font-medium transition-colors",
                          v ? "border-emerald-400 bg-white" : "border-gold bg-gold/10 text-gold-muted hover:bg-gold/20"
                        )}
                      >
                        {v ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v} alt="signature" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <span className="flex items-center gap-1">
                            <PenLine className="size-3" /> {f.type === "initials" ? "Initials" : "Sign"}
                          </span>
                        )}
                      </button>
                    ) : f.type === "checkbox" ? (
                      <button
                        type="button"
                        onClick={() => setValue(f.id, v === "true" ? "false" : "true")}
                        className={cn(
                          "flex size-full items-center justify-center rounded border-2",
                          v === "true" ? "border-emerald-400 bg-emerald-50 text-emerald-600" : "border-gold bg-gold/10"
                        )}
                      >
                        {v === "true" ? "✓" : ""}
                      </button>
                    ) : f.valueToken ? (
                      // Auto-filled from CRM — shown read-only.
                      <div className="flex size-full items-center rounded border-2 border-emerald-300 bg-emerald-50/60 px-1 text-[10px] text-black">
                        {v}
                      </div>
                    ) : (
                      <input
                        value={v}
                        onChange={(e) => setValue(f.id, e.target.value)}
                        placeholder={f.label ?? (f.type === "date" ? "Date" : "Text")}
                        className="size-full rounded border-2 border-gold bg-gold/10 px-1 text-[10px] text-black outline-none focus:bg-white"
                      />
                    )}
                  </div>
                );
              })}

              {fieldsOnPage.length === 0 && pi === 0 && (
                <div className="absolute bottom-2 right-3 text-[9px] text-gray-400">
                  Page {pageNum}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Sign bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-2 text-xs text-muted-foreground sm:max-w-md">
            <Checkbox
              checked={consent}
              onCheckedChange={(c) => setConsent(c === true)}
              className="mt-0.5"
            />
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3.5 shrink-0 text-gold" />
              I agree to use electronic records and signatures (ESIGN/UETA).
            </span>
          </label>
          <div className="flex items-center gap-2">
            {geoStatus === "granted" ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700" title={geo ? `${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}` : ""}>
                <Check className="size-3.5" /> Location added
              </span>
            ) : (
              <button
                type="button"
                onClick={captureLocation}
                disabled={geoStatus === "loading"}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                title="Optional: add your location to the signing record"
              >
                {geoStatus === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}
                {geoStatus === "denied" ? "Location unavailable" : "Add my location"}
              </button>
            )}
          <Button
            onClick={submit}
            disabled={pending || !consent}
            size="lg"
            className="bg-gold text-gold-foreground hover:bg-gold/90"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
            Finish &amp; Sign
          </Button>
          </div>
        </div>
      </div>

      {sigOpen && (
        <SignaturePad
          name={signerName}
          needSignature={needSignature}
          needInitials={needInitials}
          onClose={() => setSigOpen(false)}
          onAdopt={adoptSignature}
        />
      )}
    </div>
  );
}

function SignaturePad({
  name,
  needSignature,
  needInitials,
  onClose,
  onAdopt,
}: {
  name: string;
  needSignature: boolean;
  needInitials: boolean;
  onClose: () => void;
  onAdopt: (adopted: AdoptedSignature) => void;
}) {
  const [tab, setTab] = React.useState<"draw" | "type">("draw");
  const [typed, setTyped] = React.useState(name);
  const sigPadRef = React.useRef<SignatureCanvas | null>(null);
  const iniPadRef = React.useRef<SignatureCanvas | null>(null);
  const initialsPreview = deriveInitials(typed) || "—";

  function adopt() {
    if (tab === "draw") {
      const adopted: AdoptedSignature = {};
      if (needSignature) {
        const pad = sigPadRef.current;
        if (!pad || pad.isEmpty()) {
          toast.error("Please draw your signature.");
          return;
        }
        adopted.signature = pad.getCanvas().toDataURL("image/png");
      }
      if (needInitials) {
        const pad = iniPadRef.current;
        if (!pad || pad.isEmpty()) {
          toast.error("Please draw your initials.");
          return;
        }
        adopted.initials = pad.getCanvas().toDataURL("image/png");
      }
      onAdopt(adopted);
    } else {
      if (!typed.trim()) {
        toast.error("Please type your name.");
        return;
      }
      const adopted: AdoptedSignature = {};
      if (needSignature) adopted.signature = cursiveImage(typed);
      if (needInitials) adopted.initials = cursiveImage(deriveInitials(typed), 240, 200);
      onAdopt(adopted);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-xl">
        <h3 className="font-display text-lg font-semibold">
          {needSignature ? "Adopt your signature" : "Adopt your initials"}
        </h3>
        <div className="mt-4 flex gap-2">
          <TabBtn active={tab === "draw"} onClick={() => setTab("draw")} icon={PenLine} label="Draw" />
          <TabBtn active={tab === "type"} onClick={() => setTab("type")} icon={Type} label="Type" />
        </div>

        <div className="mt-4 space-y-4">
          {tab === "draw" ? (
            <>
              {needSignature && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Signature</p>
                  <div className="overflow-hidden rounded-lg border border-border bg-white">
                    <SignatureCanvas ref={sigPadRef} penColor="#0B0B0C" canvasProps={{ className: "w-full", height: 200 }} />
                  </div>
                </div>
              )}
              {needInitials && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Initials</p>
                  <div className="overflow-hidden rounded-lg border border-border bg-white">
                    <SignatureCanvas ref={iniPadRef} penColor="#0B0B0C" canvasProps={{ className: "w-full", height: 120 }} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" />
              <div className="flex gap-3">
                {needSignature && (
                  <div className="flex-1">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Signature</p>
                    <div className="grid h-28 place-items-center rounded-lg border border-border bg-white">
                      <span className="text-4xl text-black" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                        {typed || "Your signature"}
                      </span>
                    </div>
                  </div>
                )}
                {needInitials && (
                  <div className={needSignature ? "w-28" : "flex-1"}>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Initials</p>
                    <div className="grid h-28 place-items-center rounded-lg border border-border bg-white">
                      <span className="text-4xl text-black" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                        {initialsPreview}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (tab === "draw") {
                sigPadRef.current?.clear();
                iniPadRef.current?.clear();
              } else {
                setTyped("");
              }
            }}
          >
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={adopt} className="bg-gold text-gold-foreground hover:bg-gold/90">
              Adopt &amp; Sign
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
        active ? "border-gold bg-gold/10 text-gold-muted" : "border-border hover:bg-muted"
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
