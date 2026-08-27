# Approve one proposal version as the final, and file its PDF

Date: 2026-08-26
Status: approved

## Problem

A solar deal accumulates versions — ten on the deal that prompted this. The
list says which one is newest and which have been superseded, and neither of
those is the question anybody actually asks of it. The question is **which one
did we sell**, and today nothing on the deal can answer it.

The consequence is downstream. `SOLAR_FOLDERS` has carried a **Proposal**
folder since the folder grid shipped — "the proposal as presented — the copy of
what was sold" — and nothing in the app has ever written to it. The 2026-08-19
auto-filing spec looked at it and deliberately left it manual: *"Proposal and
PTO — stay manual, no PDF generation."* This work reverses that for Proposal,
because the decision it was waiting on now exists.

## Decisions

| Question | Decision |
|---|---|
| How many versions may be approved? | Exactly one per deal, enforced in Postgres |
| Reversible? | Yes — unapprove, then approve another |
| What happens on approve | A PDF of that version is filed into the deal's **Proposal** folder |
| What happens on unapprove | The filed PDF is deleted; the folder holds the approved copy or nothing |
| How is the PDF produced | Headless Chrome against the real proposal page |
| Does approval change the customer's view | No. Purely internal |
| Who may approve | `update Settings` — admin and super admin |
| A newer version is generated | The approval stays where it is |

Rejected:

- **A download button instead of filing.** A copy that only exists if somebody
  remembers to save it is the state we are already in.
- **pdf-lib, hand-drawn.** A second document that drifts from the web proposal
  the moment either changes. The point of the copy is that it is what was sold.
- **Approval makes a version the live customer link.** Confuses an internal
  record with a published document, and touches the public route to do it.

## Design

### 1 · The mark

Three nullable columns on `SolarProposal`:

```
approvedAt     DateTime?
approvedById   String?
approvedFileId String?   -- the filed PDF, so unapprove knows what to remove
```

Plus a **partial unique index**, hand-written in the migration because Prisma's
schema language cannot express one:

```sql
CREATE UNIQUE INDEX solar_proposals_one_approved_per_lead
  ON solar_proposals (lead_id) WHERE approved_at IS NOT NULL;
```

"Only one" is then a property of the database, not a promise made by whichever
code path happens to run. Two admins approving different versions in the same
second is a lost race, not two approved versions.

### 2 · The signed print URL

The PDF is produced by pointing a headless browser at the proposal page. Two
existing renders of that page are both unreachable to it: the portal preview
needs a session, and `/proposal/[token]` needs a share token — which an
approved-but-unsent version does not have, because tokens are minted on send.

So a third door, shaped exactly like the second:

```
/proposal/print/[sig]
/proposal/print/[sig]/layout-image
/proposal/print/[sig]/site-image
```

`sig` is base64url of `proposalId.expiry.hmac`, signed with `AUTH_SECRET`,
valid five minutes. It is the same contract the share token has: it unlocks one
proposal's own frozen snapshot and nothing reachable from it. Not a file id,
not a lead id, not a lat/lng — either of those turns a valid signature into a
general-purpose proxy.

The static-map and layout-image bodies are extracted into
`server/modules/solar/proposal-images.ts` and called by both route families, so
the print copies cannot drift from the customer-facing ones.

### 3 · The render

`renderProposalPdf()` — `puppeteer-core` + `@sparticuz/chromium`,
`emulateMediaType("print")`, `page.pdf({ preferCSSPageSize: true,
printBackground: true })`.

No new print CSS. `globals.css` already carries `@page { size: 8.5in 11in;
margin: 0 }` and the `print-color-adjust` rules that were hard-won on this exact
document; `preferCSSPageSize` is what makes the render honour them instead of
overriding the page box — see the note in `browser-print-to-pdf-gotchas`. The
filed PDF is therefore the same artifact a rep gets from Cmd+P, which is the
only definition of "the copy of what was sold" that stays true as the document
changes.

Filed as `FileAsset { kind: "document", category: "proposal", leadId }`, named
`Proposal v7 — <customer>.pdf`.

### 4 · Approving and filing are two calls, not one

A Server Action approves. A separate `POST
/api/solar/proposals/[id]/file-copy` renders and files. The UI makes both back
to back; the row's **Retry** makes the second one again.

Two reasons, both load-bearing:

**Reliability.** Chromium cold-starting inside a serverless function is the
least reliable part of this, and it must not be able to prevent an approval. A
failed render leaves the version approved with `approvedFileId` null and the row
reading `Copy not filed — Retry`. The inverse — refusing to approve because a
browser binary did not launch — makes a business decision hostage to an
infrastructure one.

**Bundle size.** `@sparticuz/chromium` is a 66MB browser, and Next traces it
into every function whose import graph reaches it. Called from a Server Action
it landed in *both* pages that host the approve button — measured at 220 traced
browser files in each of `/portal/leads/[id]` and
`/portal/leads/[id]/solar-proposal`. With the render behind its own route those
two pages trace **0** and the route traces 220. `maxDuration = 60` then sits on
the segment that actually renders, rather than on two pages that do not.

This is also why `fileApprovedCopy` lives in its own module
(`proposal-file-copy.ts`) rather than beside `approveProposalVersion`: the
import graph is the deployment boundary, so it has to be kept narrow
deliberately.

### 5 · The control

In `ProposalVersionList`, which is already shared by the builder's step 5 and
the deal page's Proposal card, so both surfaces gain it at once.

```
v10  generated    8/26/2026            Preview · Mark sent by hand   [ Approve ]
v9   superseded   8/26/2026            Preview                       [ Approve ]
v7   APPROVED · Mustafa · 8/26/2026    Preview · PDF in Proposal     [ Unapprove ]
```

Approving while another version is approved confirms first — it moves the filed
copy, which is not obvious from the button.

Users without `update Settings` see the approved badge and no buttons. The
badge is the useful half and it is not privileged information.

## Testing

- Unit: signature mint/verify — round trip, expiry, tampered payload, wrong id.
- Integration: approve → single approved row; approve a second → the first
  clears; unapprove → the FileAsset is gone; the partial index rejects a
  hand-written second approval.
- Live verification against the dev app with the real renderer, real print
  route and real storage: approve a superseded version → 1.6MB PDF filed and
  readable with a valid header; swap → folder holds exactly one; unapprove →
  folder empty.
- PDF fidelity checked by rasterising the output: 16 pages all 612×792pt (the
  `@page` box survived), no date/URL furniture, and the dark chapters measured
  dark — `print-color-adjust` is honoured through the render path.

**Known gap — no e2e.** The seeded solar lead has a design and a finance row but
no drawn panel layout, and the module count (hence the price) comes from the
layout, so the seed cannot generate a solar proposal at all;
`e2e/solar-proposal-print.spec.ts` already skips for this reason. An approval
e2e would skip with it and assert nothing. Writing a permanently-skipped test
would read as coverage that does not exist, so the gap is recorded here
instead. Fixing it means giving the seed a layout, which is its own piece of
work.

## Out of scope

- Roofing proposals. Different model, different folder set.
- Re-filing the PDF when a superseded version's approval is inherited — there is
  no such inheritance.
- PTO, which the auto-filing spec also left manual and which nothing here
  changes.
