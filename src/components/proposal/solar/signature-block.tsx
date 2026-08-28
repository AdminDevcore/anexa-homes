"use client";

import * as React from "react";
import { Check } from "lucide-react";
import type { ProposalSignature } from "@/lib/proposal-signature";

/**
 * The executed signature, ON the document.
 *
 * This is the piece the lender actually asked for. Acceptance already worked —
 * it stamped a row and moved the deal — but it left no mark on the paper, so a
 * signed proposal and an unsigned one printed to the same PDF. Amos cannot tell
 * those apart and neither could anybody else.
 *
 * Rendered on screen AND on paper from one component, deliberately. A signature
 * block maintained separately for print is a second document, and the first
 * time either changes they stop agreeing about what was signed.
 */
export function ExecutionBlock({ signature }: { signature: ProposalSignature }) {
  const signed = new Date(signature.signedAt);

  return (
    <div
      data-print-keep
      className="rounded-2xl bg-white p-6 text-neutral-900 shadow-xl sm:p-7 print:shadow-none print:ring-1 print:ring-neutral-300"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
        <Check className="size-3.5" />
        Signed and accepted
      </div>

      {/* The mark itself, sitting on a signature rule the way it would on
          paper. A fixed height so a wide drawn scrawl and a short typed name
          occupy the same block and the document does not reflow around which
          way somebody chose to sign. */}
      <div className="mt-5">
        {signature.mark ? (
          <div className="flex h-[92px] items-end">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL,
                not a remote asset: there is nothing for the image pipeline to
                optimise and it must render identically in a headless print. */}
            <img
              src={signature.mark}
              alt={`Signature of ${signature.name}`}
              className="max-h-[92px] max-w-full object-contain object-left"
            />
          </div>
        ) : (
          /* A proposal accepted before signatures were captured. It IS signed —
             saying so plainly beats an empty box that reads as a broken image. */
          <div className="flex h-[92px] items-end">
            <p className="font-display text-2xl italic text-neutral-400">
              Accepted electronically — no signature image on file
            </p>
          </div>
        )}
        <div className="mt-1 border-t border-neutral-900" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Signed by">{signature.name || "—"}</Field>
        <Field label="Date signed">
          {signed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          {" · "}
          {signed.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </Field>
      </div>

      <p className="mt-5 border-t border-neutral-200 pt-4 text-[11px] leading-relaxed text-neutral-500">
        Signed electronically
        {signature.via === "in_person"
          ? signature.hostName
            ? ` in person, on a device provided by ${signature.hostName}.`
            : " in person, on a representative's device."
          : " from the customer's own proposal link."}{" "}
        {signature.consentAt && (
          <>
            The signer agreed to sign electronically at{" "}
            {new Date(signature.consentAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            on {new Date(signature.consentAt).toLocaleDateString()}.{" "}
          </>
        )}
        A full signing record, including timestamps and the document fingerprint, is printed with
        this proposal.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-neutral-900">{children}</p>
    </div>
  );
}
