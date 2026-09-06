"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ExternalLink, Loader2, ShieldAlert, Check } from "lucide-react";
import { qualifyOnProposalAction } from "@/server/modules/solar/proposal-qualify-action";
import { qualifyFromPortalAction } from "@/server/modules/solar/proposal-qualify-rep-action";
import type { QualifyOffer } from "@/lib/proposal-qualify";

/**
 * QUALIFY — the one thing the document asks the household to do.
 *
 * THERE ARE TWO WAYS TO RUN CREDIT WITH A PARTNER, and most partners have
 * both: a public application link, and an API that takes the deal and returns
 * a pre-filled application. They reach the same underwriter. Making the API
 * silently REPLACE the link — which is what this did at first — left the other
 * road with no door onto it, and a rep who wanted the plain form had nowhere
 * to go.
 *
 * So one button with a chevron. QUALIFY runs the automatic route, and the
 * chevron opens the other one. The chevron appears only when the partner
 * genuinely has both: a lender on a link alone gets exactly the button it
 * always had, and a lender with an API and no link gets no menu to open.
 *
 * The capability used to be a "Send to <lender>" card on the rep's Financing
 * step. It is here now because a credit application is the household's own act
 * — and because every partner issues its own key, so this was never a button
 * about one lender. Whichever lender the deal is quoted with is the one whose
 * key is used, resolved on the server at the moment of the tap.
 *
 * TWO DOORS, ONE BUTTON. The customer's copy is authorized by its share token.
 * The portal preview carries no token — deliberately, so none appears in that
 * page's HTML — and so the same button was dead there, which left a rep sitting
 * with a signed document and nowhere to press. `repQualify` is the second door:
 * the same submission, authorized by the session instead. It changes nothing
 * about whose details go or whose consent is captured; those were never
 * statements about which screen the deal was sent from.
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
  /** The portal preview and the PDF render. Neither can act on the token. */
  previewMode: boolean;
  /**
   * THE PREVIEW'S OWN DOOR, and the only thing that makes a control live while
   * `previewMode` is on.
   *
   * Passed only by `/portal/leads/[id]/solar-proposal/preview`, which is
   * authenticated and deliberately carries no share token — so the customer's
   * route has nothing to act with there, and the button was dead. This carries
   * the proposal id instead, and the action behind it proves the session owns
   * that row before anything reaches a lender.
   *
   * Null on the customer's copy and on every print render, which leaves both
   * exactly as they were.
   */
  repQualify?: { proposalId: string } | null;
  /**
   * Told when the automatic route has failed and the link has taken over.
   *
   * The CAPTION lives outside this component — it spans the whole card — and a
   * caption describing a button that has since changed behaviour is the exact
   * defect the preview shipped with once already. So the fact is raised to
   * whoever owns both halves rather than kept in here.
   */
  onFailed?: () => void;
};

/**
 * True when tapping the button starts a real application.
 *
 * The preview is inert UNLESS it was handed its own door — the button and the
 * caption under it are computed from this one function precisely so they can
 * never disagree about what a press is about to do.
 */
export function qualifySubmits(
  offer: QualifyOffer | null,
  previewMode: boolean,
  repQualify: { proposalId: string } | null = null,
): boolean {
  return offer?.state === "ready" && (!previewMode || !!repQualify);
}

/** Whether there is anything at all to put in the card's third column. */
export function hasQualifyAction(applyUrl: string | null, offer: QualifyOffer | null): boolean {
  return !!applyUrl || offer != null;
}

const BUTTON_CLASS =
  "inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-neutral-900 px-8 py-4 font-display text-lg font-bold tracking-[0.12em] text-neutral-900 transition hover:bg-neutral-900 hover:text-white sm:w-auto";

/** The same button cut in two, when there is a second road to offer. */
const SEGMENT =
  "inline-flex items-center justify-center gap-2 border-2 border-neutral-900 font-display font-bold tracking-[0.12em] text-neutral-900 transition hover:bg-neutral-900 hover:text-white";
const SEGMENT_MAIN = `${SEGMENT} flex-1 rounded-l-xl border-r-0 px-8 py-4 text-lg sm:flex-none`;
const SEGMENT_CHEVRON = `${SEGMENT} rounded-r-xl px-3.5 py-4`;

/** What came back from a submission that worked. Shaped locally rather than
 *  imported: `QualifyResult` lives in a module that imports Prisma. */
type Submitted = {
  lenderName: string;
  referenceNumber: string;
  customerUrl: string | null;
  sentTo: string;
};

export function QualifyAction({
  token,
  applyUrl,
  lender,
  offer,
  previewMode,
  repQualify = null,
  onFailed,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  /** What went wrong last time, shown above the button. */
  const [failure, setFailure] = React.useState<string | null>(null);
  /**
   * Set only by a failure THIS DOCUMENT CANNOT RETRY — a deal missing
   * something, or a lender nobody has finished configuring. Then, and only
   * then, the plain application link takes the button over.
   *
   * A transient failure deliberately does NOT set it. The lender's own message
   * for those says "try the same request again — it is idempotent", and the
   * submission is keyed on the design so a second press cannot open a second
   * credit file. Swapping in the link on the first blip stranded a real
   * application for two hours: the button afterwards was an `<a>` to the
   * lender's website, so every retry opened a blank form and not one of them
   * reached the API.
   */
  const [terminal, setTerminal] = React.useState(false);
  /** The lender emailed the link instead of handing it back. */
  const [emailed, setEmailed] = React.useState<string | null>(null);
  /** What the lender gave back, on the rep's door. See `start`. */
  const [submitted, setSubmitted] = React.useState<Submitted | null>(null);
  /** The other road, open. */
  const [menu, setMenu] = React.useState(false);

  const submits = qualifySubmits(offer, previewMode, repQualify) && !terminal;
  /**
   * Both roads exist, so the chevron has something to offer. Not a styling
   * choice: a chevron on a partner with only one route is a control that opens
   * a menu of one, and a household taps it expecting an alternative.
   */
  const bothRoutes = submits && !!applyUrl;

  React.useEffect(() => {
    if (!menu) return;
    function away(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest?.("[data-qualify-menu]")) setMenu(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(false);
    }
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  async function start(ownerOccupied: boolean) {
    setBusy(true);
    // WHICH DOOR. The customer's copy carries a share token and that token is
    // its authorization; the portal preview carries no token at all and is
    // authorized by the session behind it. Same deal, same lender, same key,
    // same idempotency — the only difference is who proved they may ask.
    const res = repQualify
      ? await qualifyFromPortalAction({ proposalId: repQualify.proposalId, ownerOccupied })
      : await qualifyOnProposalAction({ token, ownerOccupied });
    if (!res.ok) {
      setBusy(false);
      setOpen(false);
      setFailure(res.error);
      if (!res.retryable) {
        setTerminal(true);
        // The CARD's caption promises an automatic submission, so it only
        // changes when the automatic route is genuinely gone.
        onFailed?.();
      }
      return;
    }
    if (repQualify) {
      // NOT a redirect, which is the one place the two doors behave
      // differently after a success. The household is sent straight on because
      // finishing the form is the next thing they do; a rep has the deal open
      // behind this tab, and throwing it at a bank's website to confirm the
      // send worked is a worse answer than saying so. The link is an anchor
      // they press — a real click, which nothing blocks.
      setBusy(false);
      setOpen(false);
      setSubmitted(res);
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

  // WHAT THE REP SEES AFTERWARDS. The reference is the thing worth reading —
  // it is what an office quotes back to the lender — and the handoff link is
  // offered rather than taken, because the deal is still open behind this tab.
  if (submitted) {
    return (
      <div className="bg-white p-6 print:hidden">
        <p className="flex items-start gap-2 text-sm leading-relaxed text-neutral-700">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          <span>
            Application started with {submitted.lenderName} · reference{" "}
            <span className="font-semibold">{submitted.referenceNumber}</span>. A link to finish it
            {submitted.sentTo ? ` has gone to ${submitted.sentTo}` : " is on its way to the customer"}.
          </span>
        </p>
        {submitted.customerUrl && (
          <a
            href={submitted.customerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-neutral-900 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-900 hover:text-white"
          >
            Open it on this device <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    );
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
  // ...unless this page was handed its own door, above. Reached now only by a
  // reader who may not act — no `update` grant, or a superseded version.
  if (offer?.state === "ready" && previewMode && !repQualify) {
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
    <div className="bg-white p-6 print:hidden" data-qualify-menu>
      {/* A retryable failure keeps the button that can retry, and says why. */}
      {failure && (
        <p className="mb-3 text-xs leading-relaxed text-amber-900">{failure}</p>
      )}
      <div className="flex w-full sm:w-auto">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={bothRoutes ? SEGMENT_MAIN : BUTTON_CLASS}
        >
          QUALIFY
        </button>
        {bothRoutes && (
          <button
            type="button"
            onClick={() => setMenu((m) => !m)}
            aria-expanded={menu}
            aria-haspopup="true"
            aria-label="Other ways to apply"
            className={SEGMENT_CHEVRON}
          >
            <ChevronDown className={menu ? "size-5 rotate-180 transition" : "size-5 transition"} />
          </button>
        )}
      </div>

      {/*
        THE MENU EXPANDS THE CARD rather than floating over it. `Chapter` is
        `overflow-hidden`, so an absolutely-positioned panel would be clipped
        at whichever edge it crossed — the same containment that sent the
        confirm sheet through a portal. A panel that is simply in the flow
        cannot be clipped by anything, and it needs no measuring, no
        reposition-on-scroll and no second portal.
      */}
      {menu && bothRoutes && (
        <div
          role="menu"
          className="mt-3 w-full overflow-hidden rounded-xl border border-neutral-300 sm:w-[22rem]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setOpen(true);
            }}
            className="flex w-full items-start gap-2.5 border-b border-neutral-200 bg-neutral-50 p-3.5 text-left transition hover:bg-neutral-100"
          >
            <Check className="mt-0.5 size-4 shrink-0 text-neutral-900" />
            <span>
              <span className="block text-sm font-semibold text-neutral-900">Start it here</span>
              <span className="block text-xs leading-relaxed text-neutral-500">
                We fill in what we already know, then hand you to{" "}
                {lender ?? "the lender"} to finish.
              </span>
            </span>
          </button>
          <a
            role="menuitem"
            href={applyUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenu(false)}
            className="flex w-full items-start gap-2.5 p-3.5 text-left transition hover:bg-neutral-50"
          >
            <ExternalLink className="mt-0.5 size-4 shrink-0 text-neutral-400" />
            <span>
              <span className="block text-sm font-semibold text-neutral-900">
                Open {lender ?? "the lender"}&rsquo;s own application
              </span>
              <span className="block text-xs leading-relaxed text-neutral-500">
                Their blank form. You type everything in yourself.
              </span>
            </span>
          </a>
        </div>
      )}

      {open && offer?.state === "ready" && (
        <QualifySheet
          offer={offer}
          busy={busy}
          forRep={!!repQualify}
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
  const [failed, setFailed] = React.useState(false);
  if (!hasQualifyAction(props.applyUrl, props.offer)) return null;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-black/5 print:hidden">
      <QualifyAction {...props} onFailed={() => setFailed(true)} />
      <QualifyNote
        applyUrl={props.applyUrl}
        lender={props.lender}
        offer={props.offer}
        previewMode={props.previewMode}
        repQualify={props.repQualify}
        failed={failed}
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
  forRep = false,
  onCancel,
  onContinue,
}: {
  offer: Extract<QualifyOffer, { state: "ready" }>;
  busy: boolean;
  /**
   * Opened from the portal preview rather than the customer's copy.
   *
   * The sheet is otherwise IDENTICAL on purpose — same figures, same list of
   * what goes, same occupancy question, because it is the same submission and a
   * shorter confirmation for the person who is not the applicant would be the
   * wrong way round. What it adds is the one fact the rep needs and the
   * customer does not: this is not a rehearsal, and the household finds out
   * because the lender writes to them.
   */
  forRep?: boolean;
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

        {forRep && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-50 p-3.5">
            <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-900">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                This is a real credit application in the customer&rsquo;s name, not a preview of
                one. {offer.lenderName} emails them the link to finish it — and texts it, if there
                is a number on the deal — the moment you continue. There is no way to send this
                quietly.
              </span>
            </p>
          </div>
        )}

        <p className="mt-4 text-sm leading-relaxed text-neutral-600">
          {forRep ? (
            <>
              That is everything we send. The customer&rsquo;s Social Security number, date of
              birth and authorisation for the credit check are entered by them on{" "}
              {offer.lenderName}&rsquo;s own secure page — none of it passes through this
              document, and none of it can be entered here.
            </>
          ) : (
            <>
              That is everything we send. Your Social Security number, your date of birth and your
              authorisation for the credit check are entered on {offer.lenderName}&rsquo;s own
              secure page — none of it passes through this document.
            </>
          )}
        </p>

        <div className="mt-5">
          <p className="text-sm font-semibold">
            {forRep ? "Does the customer live in this home?" : "Do you live in this home?"}
          </p>
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
  repQualify = null,
  failed = false,
}: {
  applyUrl: string | null;
  lender: string | null;
  offer: QualifyOffer | null;
  previewMode: boolean;
  /** See `QualifyAction`. Read here so the caption cannot outlive the button. */
  repQualify?: { proposalId: string } | null;
  /** The automatic route failed and the plain link has taken the button over. */
  failed?: boolean;
}) {
  if (offer?.state === "blocked") {
    return (
      <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
        Only you can see this. On the customer&rsquo;s copy this button falls back to{" "}
        {offer.lenderName}&rsquo;s ordinary application link until the deal is complete.
      </p>
    );
  }

  if (qualifySubmits(offer, previewMode, repQualify) && !failed) {
    const name = offer?.state === "ready" ? offer.lenderName : (lender ?? "the lender");
    // THE PREVIEW'S BUTTON IS LIVE NOW, so the strip that used to say it was
    // inert would be the exact defect this file already shipped once — a
    // caption describing a control that has since changed behaviour. Said to
    // the person actually reading it, and said before they press.
    if (repQualify) {
      return (
        <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
          Only you can see this, but the button is live: it starts a real application with {name}{" "}
          in the customer&rsquo;s name, and {name} writes to them to finish it.
          {applyUrl ? " The arrow beside it opens their blank form instead." : ""}
        </p>
      );
    }
    return (
      <p className="border-t border-neutral-200/70 bg-neutral-50 px-6 py-3 text-xs text-neutral-500 print:hidden">
        Starts your application with {name} using the details above, then opens their own secure
        page to finish it. Your Social Security number and the credit authorisation are entered
        there, never here.
        {applyUrl ? " The arrow beside it opens their blank form instead." : ""}
      </p>
    );
  }

  // The rep's preview of a live, submittable document they may NOT press —
  // no `update` grant, or a superseded version. Say so, rather than printing
  // the link's sentence under a button that will not behave that way.
  //
  // `!repQualify` is load-bearing in the failed case too: once the automatic
  // route has died terminally the button above is an `<a>` to the lender, and
  // a strip under it reading "inert in the preview" is the same defect this
  // file shipped once already (21151fa). Falling through to the plain-link
  // sentence below is the true description of what that button now does.
  if (offer?.state === "ready" && previewMode && !repQualify) {
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
