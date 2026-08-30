import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import type { ProposalCertificate } from "@/lib/proposal-signature";
import { groupFingerprint } from "@/server/modules/solar/proposal-signature";

/**
 * The funder's processing document — and emphatically NOT the agreement the
 * customer signed.
 *
 * WHY THIS EXISTS AT ALL. A partner whose contract is written for more than the
 * household owes needs its own figure to submit: the adjusted contract value,
 * against the deal it belongs to. The tempting shortcut is to put that number
 * on the customer's proposal in place of their price — which is precisely the
 * fraud this whole feature is arranged to prevent — and the next shortcut is to
 * generate a second "proposal" carrying the contract value and no customer
 * pricing, which is worse: two documents that look alike, disagree about what a
 * household owes, and cannot be told apart six months later.
 *
 * So there is exactly ONE canonical signed document — the customer's, complete
 * with the reconciliation — and this, which is not one. Three things enforce
 * that, and all three are load-bearing:
 *
 *  1. IT SAYS SO, at the top, in the largest thing on the page. Not in a
 *     footnote.
 *  2. IT DOES NOT LOOK LIKE THE PROPOSAL. No cover, no chapters, no branding,
 *     no signature panel that could be mistaken for an execution block. It is
 *     a form.
 *  3. IT POINTS AT THE SIGNED DOCUMENT rather than reproducing it: the version,
 *     the moment of signature, and the SHA-256 fingerprint of the exact
 *     snapshot that was signed. Anybody holding both can check that this
 *     summary describes that document, and this document cannot be passed off
 *     as it.
 *
 * Every figure here is read from the FROZEN snapshot. Nothing is recomputed, so
 * this cannot drift from the customer's copy even by a cent — which is the
 * property that makes it safe to hand to a funder at all.
 */
export function ParticipateSubmissionSummary({
  snapshot,
  version,
  reference,
  certificate,
}: {
  snapshot: SolarProposalSnapshot;
  version: number;
  /** The proposal's own reference, so the two documents can be tied together. */
  reference: string;
  /** The signing record. Null renders the unsigned state, which is stated. */
  certificate: ProposalCertificate | null;
}) {
  const f = snapshot.financing;
  const adjustment = f.lenderAdjustment ?? null;
  const watts = Math.round(snapshot.system.sizeKwDc * 1000);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-neutral-900 print:py-6">
      {/* 1 — IT SAYS SO. */}
      <header className="rounded-lg border-2 border-neutral-900 p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Processing document</p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
          Lender submission summary
        </h1>
        <p className="mt-2 text-sm leading-relaxed">
          <strong>This is not the agreement the customer signed.</strong> It is an internal summary
          prepared for submission to the finance partner, and it carries no signature and no offer.
          The document the customer reviewed and signed is solar proposal v{version} ({reference}),
          identified below by its fingerprint.
        </p>
      </header>

      <Block title="Deal">
        <Field k="Customer" v={snapshot.customer.name} />
        <Field k="Property" v={snapshot.customer.address || "—"} />
        <Field k="Proposal reference" v={reference} />
        <Field k="Version" v={`v${version}`} />
        <Field k="Generated" v={new Date(snapshot.generatedAt).toLocaleString()} />
        <Field k="Calculation revision" v={String(snapshot.calculationVersion ?? 1)} />
      </Block>

      <Block title="System">
        <Field k="DC capacity" v={`${snapshot.system.sizeKwDc.toFixed(2)} kW · ${watts.toLocaleString()} W`} />
        <Field k="Modules" v={snapshot.system.moduleLabel ?? "—"} />
        <Field k="Module quantity" v={String(snapshot.system.moduleQty)} />
        <Field k="Inverter" v={snapshot.system.inverterLabel ?? "—"} />
        <Field k="Storage" v={snapshot.system.batteryLabel ?? "None"} />
        <Field k="Year-one production" v={`${Math.round(snapshot.system.year1ProductionKwh).toLocaleString()} kWh`} />
      </Block>

      <Block title="Finance partner">
        <Field k="Lender" v={f.lender ?? "—"} />
        <Field k="Product" v={f.lenderProductLabel ?? "—"} />
        <Field k="APR" v={f.aprPct != null ? `${f.aprPct}%` : "—"} />
        <Field
          k="Term"
          v={f.loanTermMonths ? `${f.loanTermMonths} months` : f.termYears ? `${f.termYears} years` : "—"}
        />
      </Block>

      {/* WHAT THE CUSTOMER SIGNED FOR — the contract, which since 2026-08-29 is
          the figure the proposal itself quotes on every page. This block used
          to lead with the obligation and call it "customer obligation"; that
          label now belongs to the bottom of the credit ladder below, and
          leaving it here would have had the funder's paperwork and the signed
          document disagreeing about what the household agreed to. */}
      <Block title="Customer pricing">
        <Field
          k="Contract price per watt"
          v={f.finalPpwCents != null && f.finalPpwCents > 0 ? `$${(f.finalPpwCents / 100).toFixed(2)}/W` : "—"}
        />
        <Field k="System price" v={money(f.basePriceCents)} />
        <Field k="Customer-selected add-ons" v={money(f.adderTotalCents)} />
        {adjustment && (
          <Field k={adjustment.label} v={`+${money(adjustment.adjustmentCents)}`} />
        )}
        <Field k="Contract price" v={money(f.contractPriceCents)} strong />
        <Field k="Amount financed" v={money(f.financedAmountCents ?? f.contractPriceCents)} />
        <Field k="Customer monthly payment" v={money(f.loanMonthlyPaymentCents, 2)} strong />
        {f.netMonthlyPaymentCents != null && (
          <Field
            k="Monthly once the credits are applied"
            v={money(f.netMonthlyPaymentCents, 2)}
          />
        )}
      </Block>

      {/* THE LADDER, on the funder's paperwork too.
          The signed document promises the household a figure well below the
          contract this summary submits, and the whole of that difference is
          credits and a company incentive. A funder reconciling the two needs
          the same rows the customer read, not a footnote saying they exist. */}
      {f.creditLadder && (
        <Block title="What the customer pays">
          <Field k="Contract price" v={money(f.creditLadder.contractValueCents)} />
          {f.creditLadder.credits.map((c) => (
            <Field key={c.key} k={`${c.label} (${c.pct}%)`} v={`−${money(c.amountCents)}`} />
          ))}
          {f.creditLadder.incentiveCents > 0 && (
            <Field
              k={f.creditLadder.incentiveLabel}
              v={`−${money(f.creditLadder.incentiveCents)}`}
            />
          )}
          <Field k="Net customer cost" v={money(f.creditLadder.netCostCents)} strong />
        </Block>
      )}

      {adjustment ? (
        <Block title="Contract value submitted">
          <Field
            k="Adjusted contract value"
            v={money(adjustment.lenderContractValueCents)}
            strong
          />
          <Field k={adjustment.label} v={money(adjustment.adjustmentCents)} />
          <Field
            k="System priced at"
            v={money(adjustment.customerObligationCents)}
            strong
          />
          <p className="col-span-2 mt-2 text-sm leading-relaxed text-neutral-600">
            {adjustment.disclosure}
          </p>
        </Block>
      ) : (
        <Block title="Contract value submitted">
          <p className="col-span-2 text-sm leading-relaxed text-neutral-600">
            This deal carries no contract adjustment. The value submitted is the contract price of{" "}
            {money(f.contractPriceCents)}.
          </p>
        </Block>
      )}

      {/* 3 — IT POINTS AT THE SIGNED DOCUMENT. */}
      <Block title="Signed document referenced">
        {certificate ? (
          <>
            <Field k="Signed by" v={certificate.signature.name || "—"} />
            <Field
              k="Signed at"
              v={new Date(certificate.signature.signedAt).toLocaleString()}
            />
            <Field
              k="Method"
              v={
                certificate.signature.via === "in_person"
                  ? "In person, on a representative's device"
                  : "Remotely, from the customer's own link"
              }
            />
            <Field k="Document" v={certificate.documentTitle} />
            <div className="col-span-2 mt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                SHA-256 fingerprint of the signed proposal
              </p>
              <p className="mt-1 font-mono text-xs break-all text-neutral-700">
                {groupFingerprint(certificate.fingerprint)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600">
                That fingerprint identifies the exact document the customer signed. This summary is
                a separate file and has a different one; it is a description of that document, not
                a copy of it.
              </p>
            </div>
          </>
        ) : (
          <p className="col-span-2 text-sm leading-relaxed text-neutral-600">
            This version has not been signed by the customer, so there is no signed document for
            this summary to reference.
          </p>
        )}
      </Block>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid">
      <h2 className="border-b border-neutral-300 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-500">
        {title}
      </h2>
      <dl className="mt-2 grid grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        {children}
      </dl>
    </section>
  );
}

function Field({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <>
      <dt className="text-neutral-500">{k}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{v}</dd>
    </>
  );
}

/** Money from the snapshot's cents, or a dash where the document holds none. */
function money(cents: number | null | undefined, digits = 0): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}
