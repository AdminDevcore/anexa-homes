# Send docs from the proposal

**Date:** 2026-08-07
**Status:** approved

## The problem

A rep finishes a proposal on `/portal/leads/<id>/presentation`, step 5 (Preview & Share),
and the customer is ready to sign. Today the only way to send them a contract is to leave
the deal, go to `/portal/documents`, click "Send for Signature", and re-find the customer
in a dropdown of the 100 most recent leads — one template at a time. Three documents means
three round trips through a lead picker for a lead the app already knows.

## What we're building

A **Send docs** button on step 5, beside Preview / Download PDF / Re-generate. It opens a
dialog that lists the workspace's contract templates as checkboxes, with the signer already
filled in from the deal, and sends every checked document in one action.

Nothing about the e-sign engine changes. `sendForSignature()` already snapshots the
template, auto-fills from the deal, creates a `DocumentPackage`, and emails each signer a
private `/sign/<token>` link. This is a better front door to it.

## Components

### 1. Server props — `src/app/portal/leads/[id]/presentation/page.tsx`

The page already loads the proposal. It additionally loads, for the dialog:

- **Templates** — `documentTemplate` where `companyId + vertical + active`, ordered by name,
  selecting `id, name, type`. Same query the Documents page runs; the active vertical comes
  from `getActiveVertical(user)` so a roofing rep never sees solar paperwork.
- **Signer defaults** — the lead's `firstName`, `lastName`, `email`, `coOwnerName`, plus the
  logged-in user's `fullName` and `email` for the company-rep row.
- **canSendDocs** — `can(user, "create", "Document")`.

These are passed to `PresentationBuilder` as one `docs` prop so the builder's existing
`data` shape is untouched.

### 2. Dialog — `src/components/esign/send-docs-dialog.tsx`

New client component. Deliberately *not* a refactor of `send-document-dialog.tsx`: that one
exists to pick a lead, this one exists because the lead is already known. They share signer
semantics, not markup.

Layout:

- **Template checkboxes** — one row per template, name plus its type as a subtitle. Nothing
  checked by default; the rep chooses.
- **Signer block** — customer name and email prefilled from the lead and editable. Optional
  "Add co-borrower" (prefilled from `coOwnerName` when the deal has one) and "Add company
  rep" (prefilled with the logged-in user). One signer set applies to every checked document.
- **Send button** — labelled with the count: "Send 2 documents".

Signing order matches the existing dialog: customer and co-borrower both at order 1 (either
may sign first), company rep at order 2 so they counter-sign after the customers.

**Empty state.** Zero templates in this workspace renders a short explanation and a link to
`/portal/documents`, rather than a button that opens onto nothing.

### 3. Action — `sendDocumentsAction` in `src/server/modules/esign/actions.ts`

```ts
sendDocumentsAction({ leadId, templateIds, signers }) => {
  sent:   { templateId, title, packageId, links: { name, url }[] }[]
  failed: { templateId, error: string }[]
}
```

Validates shape with zod (uuid arrays, at least one template, at least one signer), then
loops `sendForSignature()` once per template **inside a try/catch per template** so one
broken template — a missing source PDF, say — doesn't discard the sends that worked. Order
of `templateIds` is preserved in the result.

Revalidates `/portal/documents` and `/portal/leads/<leadId>` so the deal's Contract folder
shows the new packages immediately.

No new authorization: `sendForSignature` already calls `requireCan(user, "create",
"Document")` and resolves the lead through `listScope(user, "Lead")`, so a rep cannot send
against a deal outside their scope even by posting a foreign `leadId`.

### 4. Results view

After sending, the dialog replaces its form with one block per document:

- The document title, and each signer's link with a copy button.
- A **Sign in person** button per document, calling the existing
  `openInPersonSigningAction(packageId)` — it already picks the next unsigned signer,
  rotates their token, and returns an `?inperson=1` URL for the rep's own device.
- Failures listed inline with their reason, so a partial batch is legible rather than silent.

## Data flow

```
presentation/page.tsx  ──(templates, signer defaults)──►  PresentationBuilder
                                                              │ step 5
                                                              ▼
                                                        SendDocsDialog
                                                              │ sendDocumentsAction
                                                              ▼
                                              for each templateId: sendForSignature()
                                                              │
                                          DocumentPackage + signers + emailed links
                                                              │
                                                    results view (links, in-person)
```

## Error handling

| Case | Behaviour |
|---|---|
| No template checked | Send button disabled |
| Customer name blank | Toast: choose a signer; nothing sent |
| Co-borrower / rep row open but unnamed | Toast; nothing sent (matches existing dialog) |
| One template fails | Others still send; failure shown inline with its reason |
| All templates fail | Form stays open, errors listed |
| Signing-link email fails | Already best-effort inside the service — the link still renders |

## Testing

`e2e/send-docs.spec.ts`, following `e2e/esign.spec.ts` and `e2e/build-presentation.spec.ts`:

1. Seed two templates in the roofing workspace.
2. Open a deal's proposal builder, go to step 5.
3. Click **Send docs**, check both templates, send.
4. Assert both documents appear in the results with signing links.
5. Assert both packages appear in the deal's Contract folder.

## Out of scope

- Merging several templates into a single combined envelope (needs PDF and field-offset
  merging; each document stays its own package).
- Any change to template authoring, field mapping, or the signing experience.
- A send entry point on the deal page itself — the proposal is where the ask happens.
