"use client";

import * as React from "react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PenLine, Type, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Logo } from "@/components/marketing/logo";
import { submitSignatureByTokenAction } from "@/server/modules/esign/actions";
import { fillTokens, type AutofillContext } from "@/server/modules/esign/autofill";
import type { Snapshot, SnapshotField } from "@/server/modules/esign/pdf";
import { PdfCanvas } from "./pdf-canvas";

type Props = {
  token: string;
  title: string;
  signerName: string;
  snapshot: Snapshot;
  ctx: AutofillContext;
  signerFields: SnapshotField[];
};

export function SigningExperience({ token, title, signerName, snapshot, ctx, signerFields }: Props) {
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

  const pages = snapshot.pages?.length ? snapshot.pages : [{ width: 612, height: 792 }];
  const sigFields = signerFields.filter((f) => f.type === "signature" || f.type === "initials");
  const fieldById = (id: string) => signerFields.find((f) => f.id === id);

  function setValue(id: string, v: string) {
    setValues((s) => ({ ...s, [id]: v }));
  }

  function adoptSignature(url: string) {
    setSignatureUrl(url);
    setValues((s) => {
      const next = { ...s };
      for (const f of sigFields) next[f.id] = url;
      return next;
    });
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

      {sigOpen && (
        <SignaturePad
          name={signerName}
          onClose={() => setSigOpen(false)}
          onAdopt={adoptSignature}
        />
      )}
    </div>
  );
}

function SignaturePad({
  name,
  onClose,
  onAdopt,
}: {
  name: string;
  onClose: () => void;
  onAdopt: (dataUrl: string) => void;
}) {
  const [tab, setTab] = React.useState<"draw" | "type">("draw");
  const [typed, setTyped] = React.useState(name);
  const padRef = React.useRef<SignatureCanvas | null>(null);

  function adopt() {
    if (tab === "draw") {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) {
        toast.error("Please draw your signature.");
        return;
      }
      onAdopt(pad.getCanvas().toDataURL("image/png"));
    } else {
      if (!typed.trim()) {
        toast.error("Please type your name.");
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 200;
      const c = canvas.getContext("2d")!;
      c.fillStyle = "#0B0B0C";
      c.font = "64px 'Brush Script MT', cursive";
      c.textBaseline = "middle";
      c.fillText(typed, 20, 110);
      onAdopt(canvas.toDataURL("image/png"));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 shadow-xl">
        <h3 className="font-display text-lg font-semibold">Adopt your signature</h3>
        <div className="mt-4 flex gap-2">
          <TabBtn active={tab === "draw"} onClick={() => setTab("draw")} icon={PenLine} label="Draw" />
          <TabBtn active={tab === "type"} onClick={() => setTab("type")} icon={Type} label="Type" />
        </div>

        <div className="mt-4">
          {tab === "draw" ? (
            <div className="overflow-hidden rounded-lg border border-border bg-white">
              <SignatureCanvas
                ref={padRef}
                penColor="#0B0B0C"
                canvasProps={{ className: "w-full", height: 200 }}
              />
            </div>
          ) : (
            <div>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" />
              <div className="mt-3 grid h-28 place-items-center rounded-lg border border-border bg-white">
                <span className="text-4xl text-black" style={{ fontFamily: "'Brush Script MT', cursive" }}>
                  {typed || "Your signature"}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              if (tab === "draw") padRef.current?.clear();
              else setTyped("");
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
