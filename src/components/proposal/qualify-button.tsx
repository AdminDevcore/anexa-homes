"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, ShieldAlert, Check } from "lucide-react";
import { qualifyOnProposalAction } from "@/server/modules/solar/proposal-qualify-action";
import type { QualifyOffer } from "@/lib/proposal-qualify";

/**
 * QUALIFY — the one thing the document asks the household to do.
 *
 * It has two behaviours and looks the same in both, which is the point. On a
 * partner with no integration it is what it has always been: a link to their
 * own application. On a partner that accepts applications over its API it
 * starts the application with everything this deal already knows, and lands
 * the household on the lender's page with the form filled in.
 *
 * The capability used to be a "Send to <lender>" card on the rep's Financing
 * step. It is here now because a credit application is the household's own act
 * — and because every partner issues its own key, so this was never a button
 * about one lender. Whichever lender the deal is quoted with is the one whose
 * key is used, resolved on the server at the moment of the tap.
 *
 * WHAT IS NOT SENT: no Social Security number, no date of birth, no consent
 * flag. That authorization has to be the customer's own, captured on the
 * lender's page under the lender's disclosures — which is also what keeps this
 * application out of scope for holding any of it.
 */

type Props = {
  /** The share token. The customer's copy has one; a print render does not act. */
  token: string;
  /** The lender's own application link, frozen into the snapshot. */
  applyUrl: string | null;
  lender: string | null;
  /**
   * Resolved on the server. Null means "behave exactly as before" — which is
   * every deal whose lender has no integration, and every reader who has
   * switched to a payment option this deal is not priced at.
   */
  offer: QualifyOffer | null;
  /** The portal preview and the PDF render. Nothing here may act. */
  previewMode: boolean;
};

/** True when tapping the button starts a real application. */
export function qualifySubmits(offer: QualifyOffer | null, previewMode: boolean): boolean {
  return offer?.state === "ready" && !previewMode;
}

/** Whether there is anything at all to put in the card's third column. */
export function hasQualifyAction(applyUrl: string | null, offer: QualifyOffer | null): boolean {
  return !!applyUrl || offer != null;
}

const BUTTON_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-neutral-900 px-8 py-4 font-display text-lg font-bold tracking-[0.12em] text-neutral-900 transition hover:bg-neutral-900 hover:text-white sm:w-auto";

export function QualifyAction({ token, applyUrl, lender, offer, previewMode }: Props) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  /** Set once a submission has failed: the link takes over from here. */
  const [failure, setFailure] = React.useState<string | null>(null);
  /** The lender emailed the link instead of handing it back. */
  const [emailed, setEmailed] = React.useState<string | null>(null);

  const submits = qualifySubmits(offer, previewMode) && !failure;

  async function start(ownerOccupied: boolean) {
    setBusy(true);
    const res = await qualifyOnProposalAction({ token, ownerOccupied });
    if (!res.ok) {
      setBusy(false);
      setOpen(false);
      setFailure(res.error);
      return;
    }
    if (res.customerUrl) {
      // Same tab, deliberately. A popup opened after an await is blocked by
      // every mobile browser worth naming, and this is read on a phone in a
      // driveway. The proposal link is theirs to come back to.
      window.location.href = res.customerUrl;
      return;
    }
    setBusy(false);
    setOpen(false);
    setEmailed(res.sentTo || null);
  }

  if (emailed !== null) {
    return (
      <div className="flex items-center bg-white p-6 print:hidden">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-neutral-700">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span>
            Your application has been started
            {lender ? ` with ${lender}` : ""}. A link to finish it
            {emailed ? ` has been sent to ${emailed}` : " is on its way to you"}.
          </span>
        </p>
      </div>
    );
  }

  // The rep's preview, on a deal that cannot be submitted. Never rendered on
  // the customer's copy — the server does not put this shape on that page.
  if (offer?.state === "blocked") {
    return (
      <div className="bg-white p-6 print:hidden">
        <span className={`${BUTTON_CLASS} cursor-not-allowed opacity-40`} aria-disabled>
          QUALIFY
        </span>
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <ShieldAlert className="size-3.5" /> The customer cannot apply to {offer.lenderName} yet
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-900/80">
            {offer.problems.map((p) => (
              <li key={p}>· {p}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // THE PREVIEW OF A LIVE ONE. Inert, because the note under it says so — and
  // because a rep checking their own work must not be handed the customer's
  // control. Rendering the plain link here instead would make the button open
  // the lender's page on a click the note promises does nothing.
  if (offer?.state === "ready" && previewMode) {
    return (
      <div className="flex items-center bg-white p-6 print:hidden">
        <span className={`${BUTTON_CLASS} cursor-not-allowed opacity-40`} aria-disabled>
          QUALIFY
        </span>
      </div>
    );
  }

  if (!submits) {
    // Everything else: the link the document has always carried.
    return (
      <div className="flex flex-col items-start justify-center gap-3 bg-white p-6 print:hidden">
        {failure && (
          <p className="text-xs leading-relaxed text-amber-900">{failure}</p>
        )}
        {applyUrl ? (
          <a href={applyUrl} target="_blank" rel="noopener noreferrer" className={BUTTON_CLASS}>
            QUALIFY <ExternalLink className="size-4" />
          </a>
        ) : (
          <span className={`${BUTTON_CLASS} cursor-not-allowed opacity-40`} aria-disabled>
            QUALIFY
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center bg-white p-6 print:hidden">
      <button type="button" onClick={() => setOpen(true)} className={BUTTON_CLASS}>
        QUALIFY
      </button>
      {open && offer?.state === "ready" && (
        <QualifySheet
          offer={offer}
          busy={busy}
          onCancel={() => setOpen(false)}
          onContinue={start}
        />
      )}
    </div>
  );
}

/**
 * The same control, standing on its own.
 *
 * QUALIFY normally lives in the third column of the payment card — but that
 * card is the payment MENU, and a document with one way to pay, or one whose
 * rep has switched the menu off, does not render it. The call to action is not
 * allowed to disappear with a picker, so on those sheets it stands alone.
 */
export function QualifyCallout(props: Props) {
  if (!hasQualifyAction(props.applyUrl, props.offer)) return null;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5 print:hidden">
      <QualifyAction {...props} />
      <QualifyNote
        applyUrl={props.applyUrl}
        lender={props.lender}
        offer={props.offer}
        previewMode={props.previewMode}
      />
    </div>
  );
}

/**
 * What is about to happen, before it happens.
 *
 * Every figure on it was built on the server from the rows the submission
 * actually reads, so this is a statement of what goes rather than a summary of
 * what the page was holding. The occupancy question is here because it is the
 * one thing the lender requires that Anexa has never recorded — and because it
 * is a statement about the household, which nobody else should be making on
 * their behalf.
 */
function QualifySheet({
  offer,
  busy,
  onCancel,
  onContinue,
}: {
  offer: Extract<QualifyOffer, { state: "ready" }>;
  busy: boolean;
  onCancel: () => void;
  onContinue: (ownerOccupied: boolean) => void;
}) {
  const [ownerOccupied, setOwnerOccupied] = React.useState<boolean | null>(null);
  const titleId = React.useId();
  /**
   * THE SHEET LEAVES THE DOCUMENT, and this is not a preference.
   *
   * `Chapter` carries `@container`, and a `container-type` other than `normal`
   * makes that element the containing block for every fixed-position
   * descendant — so `fixed inset-0` resolved to the chapter rather than the
   * viewport, and the chapter's `overflow-hidden` then cut the top off. The
   * household saw the occupancy question and the Continue button and never the
   * list of what was about to be sent to a bank.
   *
   * Safe to reach for `document` unguarded: this component is only ever
   * rendered from a click handler, so it never runs during the server render.
   */

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-neutral-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* THE PANEL SCROLLS, not the overlay. A centred flex child taller than
          its container overflows ABOVE the scroll origin, and that part of it
          cannot be reached by scrolling at all — on a phone in a driveway,
          which is where this is read, the household would see the occupancy
          question and never the list of what is being sent. Capping the panel
          and giving it its own scrollbar is what keeps the top reachable. */}
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-6 text-neutral-900 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">
          Start your application
        </p>
        <h2 id={titleId} className="mt-1.5 font-display text-2xl font-semibold leading-snug">
          {offer.lenderName}
        </h2>

        <dl className="mt-5 space-y-2 rounded-xl bg-neutral-50 p-4 text-sm ring-1 ring-neutral-200/70">
          <Row k="You" v={offer.summary.customer} />
          <Row k="Property" v={offer.summary.property} />
          <Row k="System" v={offer.summary.system} />
          <Row k="Financing" v={offer.summary.financing} />
        </dl>

        <p className="mt-4 text-sm leading-relaxed text-neutral-600">
          That is everything we send. Your Social Security number, your date of birth and your
          authorisation for the credit check are entered on {offer.lenderName}&rsquo;s own secure
          page — none of it passes through this document.
        </p>

        <div className="mt-5">
          <p className="text-sm font-semibold">Do you live in this home?</p>
          <div className="mt-2 flex gap-2">
            <Choice on={ownerOccupied === true} onClick={() => setOwnerOccupied(true)}>
              Yes
            </Choice>
            <Choice on={ownerOccupied === false} onClick={() => setOwnerOccupied(false)}>
              No
            </Choice>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-5 py-3 text-sm font-semibold text-neutral-500 transition hover:text-neutral-900 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => ownerOccupied !== null && onContinue(ownerOccupied)}
            disabled={busy || ownerOccupied === null}
            className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-7 py-3.5 font-display text-base font-bold tracking-[0.08em] text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "STARTING…" : "CONTINUE"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        on
          ? "rounded-xl border-2 border-neutral-900 bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white"
          : "rounded-xl border-2 border-neutral-300 px-6 py-2.5 text-sm font-semibold text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900"
      }
    >
      {children}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="shrink-0 text-neutral-500">{k}</dt>
      <dd className="min-w-0 text-right font-medium">{v}</dd>
    </div>
  );
}

/**
 * The sentence under the card, which has to describe the button above it.
 *
 * "Nothing is submitted from this page" was true of the link and is a lie
 * about the submission, and the one place a document must not be casually
 * wrong is the strip explaining what a button does with a household's details.
 */
export function QualifyNote({
  applyUrl,
  lender,
  offer,
  previewMode,
}: {
  applyUrl: string | null;
  lender: string | null;
  offer: QualifyOffer | null;
  previewMode: boolean;
}) {
  if (offer?.state === "blocked") {
    return (
      <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
        Only you can see this. On the customer&rsquo;s copy this button falls back to{" "}
        {offer.lenderName}&rsquo;s ordinary application link until the deal is complete.
      </p>
    );
  }

  if (qualifySubmits(offer, previewMode)) {
    const name = offer?.state === "ready" ? offer.lenderName : (lender ?? "the lender");
    return (
      <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
        Starts your application with {name} using the details above, then opens their own secure
        page to finish it. Your Social Security number and the credit authorisation are entered
        there, never here.
      </p>
    );
  }

  // The rep's preview of a live, submittable document: say so, rather than
  // printing the link's sentence under a button that will not behave that way.
  if (offer?.state === "ready" && previewMode) {
    return (
      <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
        Only you can see this. On the customer&rsquo;s copy this button starts a real application
        with {offer.lenderName} — it is inert in the preview.
      </p>
    );
  }

  if (!applyUrl) return null;
  return (
    <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
      Opens {lender ?? "the lender"}&rsquo;s own secure application. Nothing is submitted from this
      page, and no information here is sent anywhere.
    </p>
  );
}
