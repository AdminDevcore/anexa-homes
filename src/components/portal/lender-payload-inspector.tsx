"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  checkDealWithLenderAction,
  readSubmissionLogAction,
  type SubmissionLogRow,
} from "@/server/modules/solar/lender-inspect";
import type { LenderCheckResult } from "@/server/modules/solar/lender-submit";

/**
 * HAS THIS GONE TO THE LENDER, OR NOT?
 *
 * That is the whole headline, and it took a rewrite to get there. The panel
 * started life as a diagnostic — the exact JSON body, a validation button and
 * the full attempt history, all unfolded at once — built because for the whole
 * life of the integration there was no way to see what the partner was being
 * told. It answered a question nobody on the sales floor was asking. What they
 * open a proposal wanting to know is one bit: did it go.
 *
 * So the bit is the panel. A line, an icon, a date and the partner's reference
 * — readable without opening anything.
 *
 * The diagnostic is kept, one fold down, because the reason it was built has
 * not gone away: when their intake spends three weeks refusing every solar
 * deal, finding out why used to mean decrypting the lender's API key and
 * replaying the request by hand. What changed is that it no longer greets
 * somebody who came here to read a document. Inside the fold, in the order
 * somebody debugging needs them:
 *
 *   1. CHECK. Their validation endpoint runs the full schema and every product
 *      rule and writes NOTHING — no application, no credit file, no email to
 *      the household. Every refusal it surfaces is one a customer never
 *      watches happen.
 *   2. THE HISTORY. Every previous attempt with the partner's own reply.
 *   3. THE BODY. The exact JSON, from the same function that sends it — folded
 *      again, because it is the one thing here that is never skim-read.
 */
export function LenderPayloadInspector({
  leadId,
  proposalId,
  lenderName,
  payload,
  problems,
  submitted,
}: {
  leadId: string;
  /**
   * The version this panel sits on. Checked against the SAME document the body
   * above was built from — asking the lender about a different version than the
   * one on screen is a check whose answer means nothing.
   */
  proposalId: string;
  lenderName: string;
  /** Null when our own preflight already refuses the deal. */
  payload: unknown | null;
  /** Our blockers, when there are any. Shown instead of the check button. */
  problems: string[];
  /**
   * WHAT HAPPENED TO THIS VERSION, resolved on the server so the headline is
   * right on the first paint. Null means no attempt has been recorded for this
   * document — which is not the same as "this deal has never been submitted",
   * and the line says so rather than claiming the stronger thing.
   */
  submitted: {
    ok: boolean;
    at: string;
    referenceNumber: string | null;
    message: string | null;
    actorName: string | null;
  } | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [showBody, setShowBody] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [check, setCheck] = React.useState<LenderCheckResult | null>(null);
  const [log, setLog] = React.useState<SubmissionLogRow[] | null>(null);

  // Loaded when the panel is first opened rather than on render: nobody opening
  // a proposal to read it should pay for a query they did not ask for.
  React.useEffect(() => {
    if (!open || log) return;
    void readSubmissionLogAction(leadId).then(setLog).catch(() => setLog([]));
  }, [open, log, leadId]);

  async function runCheck() {
    setBusy(true);
    try {
      setCheck(await checkDealWithLenderAction(leadId, proposalId));
    } catch {
      setCheck({ ok: false, error: "Could not reach the lender." });
    } finally {
      // ALWAYS. A busy flag left latched by a throw is a panel whose only
      // button never works again until the page is reloaded.
      setBusy(false);
    }
  }

  /**
   * The one line. Four states, and each is a different thing to do next:
   * fix it, send it, wait, or ring the partner about a refusal.
   */
  const headline = submitted
    ? submitted.ok
      ? {
          tone: "sent" as const,
          icon: <CheckCircle2 className="size-4 text-emerald-600" />,
          label: `Sent to ${lenderName}`,
          detail: [
            new Date(submitted.at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
            submitted.referenceNumber ? `ref ${submitted.referenceNumber}` : null,
            submitted.actorName,
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          tone: "refused" as const,
          icon: <XCircle className="size-4 text-red-600" />,
          label: `${lenderName} did not accept it`,
          detail: submitted.message ?? "See the attempts below.",
        }
    : problems.length > 0
      ? {
          tone: "blocked" as const,
          icon: <TriangleAlert className="size-4 text-amber-600" />,
          label: "Not sent — this deal cannot go yet",
          detail: `${problems.length} thing${problems.length === 1 ? "" : "s"} to fix first`,
        }
      : {
          tone: "unsent" as const,
          icon: <Circle className="size-4 text-muted-foreground" />,
          label: `Not sent to ${lenderName}`,
          detail: "Nothing has been submitted for this version.",
        };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-6 print:hidden sm:px-6">
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-white",
          headline.tone === "sent" && "border-emerald-300",
          headline.tone === "refused" && "border-red-300",
          headline.tone === "blocked" && "border-amber-300"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
          {headline.icon}
          <span className="font-medium">{headline.label}</span>
          <span className="text-xs text-muted-foreground">{headline.detail}</span>
          {/* The way in for somebody who has to know WHY, kept quiet enough
              that nobody else has to read past it. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            aria-expanded={open}
          >
            {open ? "Hide details" : "Details"}
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>

        {open && (
          <div className="space-y-4 border-t p-4">
            {problems.length > 0 ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="flex items-center gap-1.5 font-medium">
                  <TriangleAlert className="size-4" /> This deal cannot be sent yet
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" onClick={() => void runCheck()} disabled={busy}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Check with {lenderName}
                </Button>
                {/* Said plainly, because the fear this answers is real: the
                    button beside it starts a credit application. */}
                <span className="text-xs text-muted-foreground">
                  Asks whether they would accept it. Creates nothing — no application, no credit
                  file, and nothing reaches the customer.
                </span>
              </div>
            )}

            {check && <CheckResult result={check} />}

            <SubmissionHistory rows={log} />

            {/* FOLDED AGAIN. The payload is the most useful thing in here to
                the one person debugging the integration and the least useful
                to everybody else, and unfolded it was ninety lines of JSON
                between a rep and the answer they came for. */}
            {payload != null && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowBody((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  aria-expanded={showBody}
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", showBody && "rotate-180")} />
                  The application body
                </button>
                {showBody && (
                  <>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Built by the same function that sends it. Occupancy is answered at the moment
                      of sending and is shown here as yes.
                    </p>
                    <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-neutral-900 p-3 text-xs leading-relaxed text-neutral-100">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CheckResult({ result }: { result: LenderCheckResult }) {
  if (!result.ok) {
    return (
      <p className="flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <XCircle className="mt-0.5 size-4 shrink-0" /> {result.error}
      </p>
    );
  }
  if (result.valid) {
    return (
      <p className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="size-4" /> {result.lenderName} would accept this application.
      </p>
    );
  }
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-4" /> {result.lenderName} would refuse it
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {result.problems.map((p) => (
          <li key={p} className="font-mono text-xs">
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How a recorded basis reads to somebody who did not set it. */
const AMOUNT_BASIS: Record<string, string> = {
  contract_value: "contract value",
  customer_obligation: "household obligation",
  after_credits: "after tax credits",
};

/** Every previous attempt, with the partner's own answer beside it. */
function SubmissionHistory({ rows }: { rows: SubmissionLogRow[] | null }) {
  if (rows === null) {
    return <p className="text-xs text-muted-foreground">Loading previous attempts…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Send className="size-3.5" /> No submission has been attempted on this deal.
      </p>
    );
  }
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Previous attempts
      </h4>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {r.ok ? (
                <CheckCircle2 className="size-3.5 text-emerald-600" />
              ) : (
                <XCircle className="size-3.5 text-red-600" />
              )}
              <span className="font-medium">{new Date(r.at).toLocaleString()}</span>
              <span className="text-muted-foreground">{r.actorName ?? "—"}</span>
              {r.status != null && <span className="text-muted-foreground">HTTP {r.status}</span>}
              {r.code && <span className="font-mono text-muted-foreground">{r.code}</span>}
              {r.referenceNumber && (
                <span className="font-medium text-emerald-700">ref {r.referenceNumber}</span>
              )}
              {/* WHICH FIGURE THIS ATTEMPT ASKED THEM TO FUND. Recorded per
                  attempt because the lender's setting can be changed later and
                  this has to stay answerable about the submission that went. */}
              {r.amountBasis && r.amountBasis !== "contract_value" && (
                <span className="text-muted-foreground">{AMOUNT_BASIS[r.amountBasis] ?? r.amountBasis}</span>
              )}
            </div>
            {r.message && <p className="mt-1 text-muted-foreground">{r.message}</p>}
            {/* The reference this attempt was FILED UNDER. A partner support
                desk asks for it by name, and "the design id" is not something
                a rep can read off any screen. */}
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">{r.externalId}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
