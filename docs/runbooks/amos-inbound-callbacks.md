# Amos inbound callbacks — the real contract, and what we have to build

_Rewritten 7 September 2026, replacing an earlier version that specified the
wrong auth scheme and the wrong payload shape._

## Provenance — read this first

This document mixes two kinds of claim, and they carry different weight.

- **Verified here** — checked directly against this repo, the production
  database, or the Vercel environment. Cited with file and line.
- **From Amos** — taken from a corrected integration brief written against the
  Amos codebase and their `docs/partner-api.md`. **Not independently verified.**
  Confirm with Amos before building against any specific string.

Where the two disagree, this repo wins for our side and Amos wins for theirs.

## The headline

We are not being refused. **Nothing has ever been sent to us.**

> **From Amos:** Amos dispatches only to an endpoint registered against a
> company, and no endpoint has ever been registered for Anexa. Not one outbound
> request has left their side.

This matters because the obvious fix — set a secret and wait — produces exactly
the same silence, and the natural conclusion would be that the fix failed.

## What is true on our side

All three verified in this repo. All three still block a callback even after
Amos registers an endpoint.

### 1. No signing secret is configured

`LENDER_WEBHOOK_SECRET` is unset in production and in every other environment
(all 15 Vercel env vars checked). `src/app/api/webhooks/lenders/[lender]/route.ts`
rejects on its first line without it.

But see the next section: the variable is also the *wrong kind* of secret.

### 2. There is no record for a callback to match

`src/server/modules/solar/actions.ts` — `submitCreditApplicationAction` creates
the `CreditApplication` the webhook looks up, and **has no caller anywhere in
the codebase**. No button, no route, no other module. `credit_applications` is
empty across all of production, not merely undecided.

We capture Amos's application id on `SolarLenderSubmission` at submission time;
the webhook reads `CreditApplication`. The two halves were never joined.

### 3. Our receiver parses a shape Amos does not send

We expect a flat body with a top-level `status` string, and map it against
twelve credit-decision words. Amos sends an envelope with `type` and a nested
`data` object. This is not a missing vocabulary entry — the receiver needs
rewriting.

### What is already correct

**We do send an `externalId`.** `lender-submit.ts:170` sends
`lenderReference(design.id, design.lenderSubmissionAttempt)` — the solar design
id, or `<id>-<n>` after an abandoned reference. The corrected brief lists
"start sending an externalId" as an action for us; it is already done.

**But flag this with Amos.** Our `externalId` is per-*design*, and it **changes**
when the submission attempt counter increments (`design-abc` → `design-abc-1`).
Amos reportedly treats `externalId` as an idempotency key that is stable for the
life of the application. A bumped attempt would therefore create a *second*
application at Amos rather than updating the first. Confirm the intended
behaviour before relying on either reading.

## The wire contract

> Everything in this section is **from Amos** and unverified here.

### Authentication — HMAC, not a bearer token

```
X-Amos-Signature: t=<unix>,v1=<hex hmac>
```

HMAC-SHA256 over `${t}.${rawBody}`, verified against the **raw request bytes**
before any JSON parsing, within a 300-second timestamp tolerance. Stripe's
scheme. Signing secret (`whsec_…`) is issued once when the endpoint is created.

Two traps: re-serialising a parsed object changes the bytes and the signature
will not match; and the timestamp must be checked as well as the digest, since
it is signed *with* the body specifically to stop replay of a captured delivery.

### Headers

| Header | Use |
|---|---|
| `X-Amos-Event-Id` | **Deduplicate on this.** Delivery is at-least-once. |
| `X-Amos-Event-Type` | Same value as `type` in the body. |
| `X-Amos-Signature` | See above. |
| `X-Amos-Delivery-Attempt` | 1-based. |

### Envelope

```jsonc
{
  "id":        "evt_9f2c41ab7d3e05c8a61b4e2f77d90c13",
  "type":      "application.approved",
  "createdAt": "2026-09-05T21:14:02.113Z",
  "data": {
    "applicationId":  "6f1c2d3e-8a44-4c19-9f2b-11d0a7c53e88",
    "externalId":     "anexa-proposal-88213",   // match on this
    "referenceNumber":"AMS-BBWYWQUKC2",
    "status":         "conditional_approval",
    "previousStatus": "submitted",
    "stage":          "approved",
    "documentState":  "none",
    "occurredAt":     "2026-09-05T21:13:58.004Z",
    "decision": {
      "outcome":        "approved",
      "approvedAmount": "48750.00",   // decimal DOLLAR string, not cents
      "termMonths":     300
    }
  }
}
```

`decision` appears only on `application.approved` and `application.declined`.
A decline carries `{ "outcome": "declined", "reason": "credit" | "income" | "other" }`
— no reason codes, no score, because the adverse-action notice is Amos's to
deliver to the consumer.

### The eleven events

```
application.submitted        application.approved
application.declined         application.stipulations_needed
application.on_hold          application.withdrawn
documents.sent               documents.signed
application.ntp_approved     application.installed
application.funded
```

Two that matter to us specifically:

- **`documents.signed`** — the question that started this. Means **every** party
  has signed. A partial signature on a joint application deliberately collapses
  to `documents.sent`, so a half-signed file never reaches us as signed. The
  companion `data.status` reads `loan_signed`.
- **`application.funded`** — funds released, well after signing. **Our installer
  commission is gated on this**, so it is the transition that carries money.

### Fields we expect that never arrive

| We expect | Reality |
|---|---|
| `amountCents` | `decision.approvedAmount`, a decimal dollar **string**, approvals only |
| `aprPct` | never sent |
| `dealerFeePct` | never sent — deliberately outside their outbound allowlist, same refusal that keeps SSN and credit score off the wire. A column for it stays null forever. |
| `stipulations` | not carried; `application.stipulations_needed` says a document is needed, the list stays in Amos |
| `expiresAt` | never sent |
| `status` (top level) | exists but nested at `data.status`, using their ~20-value operational enum (`conditional_approval`, `loan_signed`, `funds_released`) — none of our twelve words appear in it |

### Delivery

Eight attempts over ~24 hours: immediate, +30s, +2m, +10m, +1h, +3h, +6h, +12h.

- **4xx is retried too** — a deploy that 404s briefly should not cost a decision.
- Five consecutively abandoned deliveries disables the endpoint and alerts Amos;
  any success resets it.
- Redirects are **not** followed — a 301 is a failed delivery.
- Return 2xx **quickly**, then do the work. A slow 200 looks like a dead host.
- **No replay for our downtime.** Missed events are gone; reconcile with
  `GET /api/v1/partner/applications?externalId=…` or `/applications/{id}`.
- **No stable egress IPs** — allow-listing is not available; the signature is the
  authentication.

## What we have to build

1. **Verify the HMAC**, not a bearer token — over raw bytes, checking timestamp
   and digest. Replaces the `LENDER_WEBHOOK_SECRET` check entirely.
2. **Parse the envelope.** Branch on `type`; everything else is under `data`.
3. **Create the credit record at submission time**, carrying Amos's ids, so an
   inbound callback has something to match. (Fault 2 above — independent of
   anything Amos does, and worth doing first.)
4. **Match on `data.externalId`** — resolving design id → deal, since that is
   what we send.
5. **Deduplicate on `X-Amos-Event-Id`**, return 2xx before doing work.
6. **Decide what `documents.signed` and `application.funded` change** on the
   deal. Funding is the commission gate, so that one needs a decision, not just
   a column.

## Sequencing

Registering an endpoint before our receiver can verify a signature just fills
Amos's retry queue with 401s for 24 hours. Order:

1. We build and deploy the receiver (items 1–5).
2. Amos registers the endpoint and issues the `whsec_…` secret.
3. Amos fires a **test event**; we confirm the signature verifies.
4. Only then does real traffic mean anything.

Amos also has their own fix in flight (their PR #566) covering deals created
before their tracking table existed — which reportedly includes ours,
`AMS-BBWYWQUKC2`. Until that ships, that deal reports nothing regardless of what
we build.

## The lesson worth keeping

Both sides built against an assumption instead of the other's contract. We wrote
a receiver for a payload Amos has never sent; they shipped an endpoint scope
their own docs promised and nothing implemented. Neither was caught, because
with one deal and no registered endpoint the whole path is indistinguishable
from one that simply has no traffic yet.

A single test event against a registered endpoint would have exposed all of it.
Do that step before the next partner integration, not after it.
