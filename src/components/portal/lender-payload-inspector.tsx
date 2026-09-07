"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  ScrollText,
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
 * WHAT THE LENDER IS ACTUALLY BEING TOLD ABOUT THIS DEAL.
 *
 * Built because for the whole life of the integration there was no way to see
 * it. A submission left a one-line error string on the activity log; the
 * payload and the partner's own answer went to a server console nobody in the
 * product can read. When their intake spent three weeks refusing every solar
 * deal, finding out why meant decrypting the lender's API key and replaying the
 * request by hand.
 *
 * Three things, in the order somebody needs them:
 *
 *   1. CHECK. Their validation endpoint runs the full schema and every product
 *      rule and writes NOTHING — no application, no credit file, no email to
 *      the household. Every refusal it surfaces is one a customer never
 *      watches happen.
 *   2. THE BODY. The exact JSON, from the same function that sends it. Not a
 *      summary of the payload; the payload.
 *   3. THE HISTORY. Every previous attempt with the partner's own reply.
 *
 * Collapsed by default. This is a diagnostic, and a proposal preview is a page
 * somebody opens to read a document.
 */
export function LenderPayloadInspector({
  leadId,
  proposalId,
  lenderName,
  payload,
  problems,
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
}) {
  const [open, setOpen] = React.useState(false);
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

  return (
    <div className="mx-auto max-w-5xl px-4 pb-6 print:hidden sm:px-6">
      <div className="overflow-hidden rounded-lg border bg-white">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40"
          aria-expanded={open}
        >
          <ScrollText className="size-4 text-muted-foreground" />
          <span className="font-medium">What gets sent to {lenderName}</span>
          <span className="text-xs text-muted-foreground">
            {problems.length > 0
              ? `${problems.length} blocker${problems.length === 1 ? "" : "s"}`
              : "the exact application body"}
          </span>
          <ChevronDown
            className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>

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

            {payload != null && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  The application body
                </h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Built by the same function that sends it. Occupancy is answered at the moment of
                  sending and is shown here as yes.
                </p>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-neutral-900 p-3 text-xs leading-relaxed text-neutral-100">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            )}

            <SubmissionHistory rows={log} />
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
    return <p className="text-xs text-muted-foreground">No submission has been attempted yet.</p>;
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
