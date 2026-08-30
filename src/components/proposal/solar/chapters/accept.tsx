"use client";

import * as React from "react";
import { Plate, GlassCard } from "../primitives";
import { AcceptForm } from "../accept";
import { ExecutionBlock } from "../signature-block";
import type { ProposalCertificate } from "@/lib/proposal-signature";
import type { Doc } from "./doc";

/**
 * 08 · THE CLOSE.
 *
 * Ends on the photograph the cover opened on, so the document visibly begins
 * and ends rather than trailing off into small print. The signature sits in the
 * same glass card the cover used, which is the last thing the reader saw before
 * the argument started.
 *
 * The FAQ moved to the back matter. It used to sit directly under the signature
 * — five paragraphs of reassurance between a decided customer and the one
 * control on the page they came here to use.
 *
 * The consultant and the company are HERE rather than only in the colophon: a
 * homeowner who has just signed should not have to turn a page to find out who
 * to call.
 */
export function ChapterAccept({
  doc,
  token,
  signed,
  signature,
  superseded,
  previewMode,
  photoUrl = "/img/solar.jpg",
  onSigned,
}: {
  doc: Doc;
  token: string;
  signed: boolean;
  signature: ProposalCertificate["signature"] | null;
  superseded: boolean;
  previewMode: boolean;
  photoUrl?: string;
  onSigned: (record: ProposalCertificate) => void;
}) {
  const { s } = doc;

  return (
    <Plate
      id="accept"
      index={doc.num("accept")}
      total={doc.total}
      eyebrow="Let's get started"
      title={signed ? "Accepted." : "Ready to go ahead?"}
      lede={
        signed ? undefined : (
          <>
            Accepting books your site survey. It is not a payment and it does not commit you to
            financing — the terms in this document are what your agreement is written from.
          </>
        )
      }
      background={
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
        />
      }
      card={
        <GlassCard className="w-full px-6 py-6 sm:px-7 sm:py-7">
          {signed ? (
            <div className="space-y-4">
              {/* The signature goes ON the document. What used to be here was a
                  thank-you panel, which meant a signed proposal and an unsigned
                  one printed to identical PDFs — and the lender cannot take a
                  proposal it has no way of telling was signed. */}
              <ExecutionBlock
                signature={
                  signature ?? {
                    // Accepted before signatures were captured. The block says
                    // exactly that rather than inventing a mark for it.
                    name: s.customer.name,
                    email: null,
                    mark: null,
                    method: null,
                    signedAt: new Date().toISOString(),
                    consentAt: null,
                    via: null,
                    hostName: null,
                  }
                }
              />
              <p className="text-sm text-neutral-600 print:hidden">
                Thank you. Your consultant will be in touch to book the site survey.
              </p>
            </div>
          ) : superseded ? (
            <p className="text-neutral-600">
              This version has been replaced and can no longer be signed.
            </p>
          ) : previewMode ? (
            <div className="rounded-2xl border border-neutral-900/10 bg-neutral-900/[0.03] p-5 text-neutral-600 print:hidden">
              Signing is disabled in preview. The customer would sign here.
            </div>
          ) : (
            <>
              {/* PAPER CANNOT BE SIGNED WITH A MOUSE.
                  The signing form is a checkbox, a text field and a live
                  drawing canvas, and printing it produced an empty box with a
                  "Sign with your finger or mouse" placeholder in it — half a
                  metre of dead control that pushed the card past the fold and
                  left the consultant's details alone on a sheet of their own.
                  On paper the same commitment is a ruled line. */}
              <PrintSignatureLine />
              <div className="print:hidden">
            <AcceptForm
              token={token}
              /* The action hands back the whole signing record, so the mark AND
                 the certificate behind it are in place the moment this returns.
                 No refresh — a refresh re-runs the public read, which logs a
                 view, and the certificate of a proposal signed seconds ago then
                 carried a line claiming the customer opened it at the instant
                 they signed. */
              onSigned={onSigned}
            />
              </div>
            </>
          )}

          <div className="mt-6 space-y-4 border-t border-neutral-900/12 pt-5">
            {s.representative && (
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                  Your consultant
                </p>
                <p className="mt-1 font-medium text-neutral-900">{s.representative.name}</p>
                <ul className="mt-0.5 space-y-0.5 text-sm text-neutral-600">
                  {[s.representative.phone, s.representative.email].filter(Boolean).map((l) => (
                    <li key={l as string} className="break-words">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                Reference
              </p>
              <p className="mt-1 break-words font-medium tabular-nums text-neutral-900">
                {s.reference}
              </p>
              <p className="mt-0.5 text-sm text-neutral-600">{s.company.name}</p>
            </div>
          </div>
        </GlassCard>
      }
    />
  );
}

/**
 * The signature, on paper.
 *
 * Screen-hidden and print-only, the mirror of the live form. A homeowner
 * holding a printed proposal signs it with a pen or follows the link; either
 * way the document has to give them somewhere to do it, and a screenshot of a
 * disabled canvas is not that.
 */
function PrintSignatureLine() {
  return (
    <div className="hidden print:block">
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-x-6">
        <span>
          <span className="block h-9 border-b border-neutral-900/40" />
          <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Signature
          </span>
        </span>
        <span>
          <span className="block h-9 border-b border-neutral-900/40" />
          <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Date
          </span>
        </span>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-neutral-600">
        Signing confirms you have read this proposal and understand the figures are estimates, not
        a guarantee, and that financing is subject to credit approval. You can also accept online
        using the link your consultant sent you.
      </p>
    </div>
  );
}
