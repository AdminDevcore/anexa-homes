"use client";

import * as React from "react";
import { toast } from "sonner";
import SignatureCanvas from "react-signature-canvas";
import { Check, Loader2, PenLine, Type, RotateCcw } from "lucide-react";
import { signSolarProposalAction } from "@/server/modules/solar/proposal-sign-action";
import { cursiveImage } from "@/lib/signature-image";
import type { ProposalCertificate } from "@/lib/proposal-signature";

/**
 * Where the homeowner signs.
 *
 * This used to be a name box and a tick box, and what it produced was a
 * timestamp. That is enough to move a deal internally and nothing like enough
 * for the lender, who asks for a signed proposal and means a document with a
 * signature ON it. So the box became a signature: drawn with a finger or set
 * from the typed name, and either way an image that goes onto the paper, into
 * the filed PDF, and onto the certificate behind it.
 *
 * THE ORDER IS THE POINT. Consent to sign electronically comes first and is its
 * own affirmative act — ESIGN wants the agreement to transact electronically
 * recorded separately, not implied by the fact that somebody pressed a button.
 * The pad stays shut until it is given, so the record can never say the two
 * happened in the wrong order.
 */
export function AcceptForm({
  token,
  onSigned,
}: {
  token: string;
  onSigned: (certificate: ProposalCertificate) => void;
}) {
  const [name, setName] = React.useState("");
  const [consented, setConsented] = React.useState(false);
  /** When the box was ticked, as the browser saw it. Server-clamped. */
  const consentAtRef = React.useRef<number | null>(null);
  const [read, setRead] = React.useState(false);
  const [mode, setMode] = React.useState<"draw" | "type">("draw");
  const [busy, setBusy] = React.useState(false);
  const padRef = React.useRef<SignatureCanvas | null>(null);
  const [drawn, setDrawn] = React.useState(false);

  /**
   * The in-person token, if a rep opened this page on their own device.
   *
   * Read from the URL at SUBMIT time rather than passed as a prop: the page is
   * a server component rendering the same document for both audiences, and
   * threading a query parameter through it would put the token into the HTML of
   * every remote proposal as well. Read on demand rather than into state
   * because nothing renders differently for it — it is a fact about the
   * request, not part of the form.
   */
  function witnessToken(): string | null {
    return new URLSearchParams(window.location.search).get("w");
  }

  function consent(on: boolean) {
    setConsented(on);
    consentAtRef.current = on ? Date.now() : null;
  }

  async function submit() {
    const full = name.trim();
    if (!consented) return toast.error("Please agree to sign electronically first.");
    if (full.length < 2) return toast.error("Please type your full name.");
    if (!read) return toast.error("Please confirm you have read the proposal.");

    let signature: string;
    if (mode === "draw") {
      const pad = padRef.current;
      if (!pad || pad.isEmpty()) return toast.error("Please draw your signature in the box.");
      signature = pad.getCanvas().toDataURL("image/png");
    } else {
      signature = cursiveImage(full);
    }

    setBusy(true);
    try {
      const res = await signSolarProposalAction({
        token,
        name: full,
        signature,
        signatureType: mode === "draw" ? "drawn" : "typed",
        consentAtMs: consentAtRef.current,
        witness: witnessToken(),
      });
      if (!res.ok || !res.certificate) return toast.error(res.error ?? "Something went wrong.");
      toast.success("Signed — thank you.");
      onSigned(res.certificate);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      // Always released, whatever the action did. A busy flag left latched on a
      // throw is a form the customer can no longer submit and cannot see why.
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 rounded-2xl bg-white p-6 text-neutral-900 shadow-xl sm:p-7">
      {/* ── 1 · consent, before anything else can be done ─────────────────── */}
      <label className="flex items-start gap-2.5 text-xs leading-relaxed text-neutral-600">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => consent(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-neutral-900"
        />
        <span>
          <strong className="font-semibold text-neutral-900">
            I agree to sign this proposal electronically
          </strong>{" "}
          and to receive it and any related records in electronic form. I can ask for a paper copy
          at any time by contacting the company below.
        </span>
      </label>

      <fieldset
        disabled={!consented}
        className="space-y-5 transition-opacity disabled:pointer-events-none disabled:opacity-40"
      >
        {/* ── 2 · the name that goes on the document ─────────────────────── */}
        <div className="space-y-1.5">
          <label
            htmlFor="signer-name"
            className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400"
          >
            Your full name
          </label>
          <input
            id="signer-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            autoComplete="name"
            className="h-12 w-full rounded-xl border border-neutral-200 bg-white px-4 font-display text-xl outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        {/* ── 3 · the mark ──────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-neutral-400">
              Your signature
            </span>
            <div className="flex gap-1 rounded-lg bg-neutral-100 p-0.5">
              <ModeTab active={mode === "draw"} onClick={() => setMode("draw")} icon={PenLine} label="Draw" />
              <ModeTab active={mode === "type"} onClick={() => setMode("type")} icon={Type} label="Type" />
            </div>
          </div>

          {mode === "draw" ? (
            <div className="relative">
              <DrawPad padRef={padRef} onChange={setDrawn} />
              <button
                type="button"
                onClick={() => {
                  padRef.current?.clear();
                  setDrawn(false);
                }}
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[11px] font-medium text-neutral-500 hover:text-neutral-900"
              >
                <RotateCcw className="size-3" /> Clear
              </button>
              {!drawn && (
                <span className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-neutral-400">
                  Sign with your finger or mouse
                </span>
              )}
            </div>
          ) : (
            <div className="grid h-[140px] place-items-center rounded-xl border border-neutral-200 bg-neutral-50">
              <span
                className="px-4 text-center text-4xl text-neutral-900"
                style={{ fontFamily: "'Brush Script MT', cursive" }}
              >
                {name.trim() || "Your signature"}
              </span>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-neutral-400">
            {mode === "draw"
              ? "Draw your signature above. It is applied to this proposal exactly as drawn."
              : "Your typed name is applied to this proposal as your signature and has the same effect as signing on paper."}
          </p>
        </div>

        {/* ── 4 · what signing means ────────────────────────────────────── */}
        <label className="flex items-start gap-2.5 text-xs leading-relaxed text-neutral-500">
          <input
            type="checkbox"
            checked={read}
            onChange={(e) => setRead(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-neutral-900"
          />
          I have read this proposal and understand the figures are estimates, not a guarantee, and
          that financing is subject to credit approval.
        </label>

        <button
          onClick={submit}
          disabled={busy}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Sign and accept this proposal
        </button>
      </fieldset>
    </div>
  );
}

/**
 * The drawing surface.
 *
 * The canvas is sized in DEVICE PIXELS from its own measured box, not left at
 * the element default. A canvas stretched by CSS keeps its 300×150 coordinate
 * space, so the ink lands nowhere near the finger — the single most common way
 * a signature pad ships broken, and the more so on a phone, which is where most
 * of these are signed.
 */
function DrawPad({
  padRef,
  onChange,
}: {
  padRef: React.MutableRefObject<SignatureCanvas | null>;
  onChange: (hasInk: boolean) => void;
}) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    function resize() {
      const pad = padRef.current;
      const canvas = pad?.getCanvas();
      if (!pad || !canvas || !box) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = box.getBoundingClientRect();
      if (!width || !height) return;
      // Resizing a canvas clears it, so anything already drawn is carried
      // across — a phone rotating mid-signature must not wipe it.
      const ink = pad.isEmpty() ? null : pad.toData();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.getContext("2d")?.scale(ratio, ratio);
      pad.clear();
      if (ink) pad.fromData(ink);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    return () => ro.disconnect();
  }, [padRef]);

  return (
    <div
      ref={boxRef}
      className="h-[140px] w-full overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50"
    >
      <SignatureCanvas
        ref={padRef}
        penColor="#0B0B0C"
        // touch-none stops the browser treating a signing stroke as a scroll,
        // which on a phone is the difference between a signature and a
        // half-scrolled page with one stray dot on it.
        canvasProps={{ className: "h-full w-full touch-none" }}
        onEnd={() => onChange(true)}
      />
    </div>
  );
}

function ModeTab({
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
      className={
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition " +
        (active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-900")
      }
    >
      <Icon className="size-3" />
      {label}
    </button>
  );
}
