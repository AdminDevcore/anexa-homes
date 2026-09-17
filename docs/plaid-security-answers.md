# Plaid security questionnaire — our answers

_Written 16 September 2026, against the bank-feed implementation on
`feat/books`._

## How to use this document

Plaid asks for a security review before granting production access. Most of the
questions have answers that are **facts about this codebase**, and those are
stated below with the file that makes them true, so a reviewer can check rather
than take our word for it.

A few are **business facts only the owner can answer** — insurance, named
security contact, breach notification commitments. Those are marked
**OWNER TO CONFIRM** and must not be guessed at on a form that is, in effect, a
representation to a regulated partner.

---

## What we store, and what we do not

| Data | Stored? | Where |
|---|---|---|
| Plaid `access_token` | Yes, **encrypted** | `bank_connections.accessTokenEnc` |
| Plaid `item_id` | Yes, plaintext | `bank_connections.providerItemId` |
| Institution name / id | Yes, plaintext | `bank_connections` |
| Account mask (last 4) | Yes | `bank_accounts.mask` |
| **Full account number** | **No** | never requested, never received |
| **Routing number** | **No** | never requested, never received |
| **Online banking credentials** | **No** | entered in Plaid Link, never transit our servers |
| Transaction id, date, amount, description, merchant | Yes | `bank_feed_transactions` |
| Account balances | Not persisted | read at connect time for display only |

The credential the user types goes to Plaid, not to us. We receive a
`public_token` from Link and exchange it server-side for an `access_token`. That
exchange is the only moment the token exists in plaintext in our process, and it
is encrypted before it reaches the database
(`src/server/modules/bank-feeds/sync.ts`).

## Encryption

**At rest.** `access_token` is sealed with AES-256-GCM before insert, using a
dedicated `FINANCE_ENC_KEY`. Blobs are versioned — `v1.<keyId>:iv:tag:ct` — so a
key can be added and rotated to without orphaning anything sealed under a
previous one (`src/server/lib/crypto.ts`). The key lives in the environment,
never in the repository, and is not readable from the application database.

The database itself is hosted Postgres with encryption at rest provided by the
platform.

**In transit.** TLS to Plaid, TLS to the database, HTTPS-only to the browser.

**Never logged.** The token, the encrypted blob, and the encryption key are
excluded from every log path. When a credential fails to decrypt, the recorded
error says so without including the blob — asserted by test
(`sync.itest.ts`, "marks the connection when its stored credential cannot be
read").

## Access control

Bank data is reachable only by the `super_admin` and `accounting` roles. This is
enforced at the **endpoint**, not merely in the navigation: every server action
re-establishes the caller and checks the verb before doing anything
(`src/server/modules/books/actions.ts`, `gate()`), because a `"use server"`
export is a public RPC route rather than a function only its page can call.

A read-only accountant role is being added in Phase 3; its export surface is not
yet settled.

**OWNER TO CONFIRM:** how many people will hold `super_admin` or `accounting` in
production, and whether MFA is mandatory for them. Phase 5 adds TOTP MFA and
makes it a requirement for the finance roles; until that ships, the honest
answer is "password plus Google SSO, MFA per the Google account."

## Webhook verification

Plaid signs webhooks with an ES256 JWT in the `plaid-verification` header. Our
receiver (`src/app/api/webhooks/bank-feeds/[provider]/route.ts`) performs four
checks, none of which is sufficient alone:

1. the algorithm is ES256 — the key is fetched by `kid` and imported as EC, so
   an algorithm substitution fails at verification;
2. the signature verifies against Plaid's published key for that `kid`;
3. `iat` is within five minutes, so a captured delivery cannot be replayed;
4. `request_body_sha256` equals a SHA-256 of the **raw request bytes**, compared
   with a timing-safe equal.

The body is read with `req.text()` before any parsing, because re-serialising a
parsed object changes the bytes and would break the comparison.

Plaid does not send an event id and delivers at least once, so the deduplication
key is derived from the body hash that verification has already proven
authentic, and is stored under a unique `(provider, eventId)` constraint. A
replayed delivery is a no-op that returns 200 — telling Plaid otherwise would
earn a retry for something already handled.

The receiver records and returns immediately; it does not sync inline. A slow
200 reads as a dead host.

## Data retention and deletion

Feed rows are retained indefinitely by design: a bank transaction is the
evidence for the journal entry made from it, and accounting records must be
reconstructable. Disconnecting a bank calls `itemRemove` at Plaid (best effort),
stops the feed, and leaves the historical rows in place.

**OWNER TO CONFIRM:** the retention period you want to commit to, and whether
disconnecting should offer to purge raw feed rows that were never posted.

## Environment separation

`PLAID_ENV` selects sandbox or production and defaults to **sandbox**; an
unrecognised value falls back to sandbox rather than production. Missing
`PLAID_CLIENT_ID` or `PLAID_SECRET` causes the provider to throw on
construction rather than silently falling back to a different provider
(`src/server/modules/bank-feeds/providers/plaid.ts`).

Production and development use separate databases and separate credentials.

## Testing without live data

Every test runs against a fixture provider selected by `BANK_FEED_PROVIDER` and
reaches no network. No test has ever held a real Plaid credential.

## Vulnerability management

Dependencies are managed with pnpm and a committed lockfile.

**OWNER TO CONFIRM:** patch cadence, whether you want automated dependency
alerts enabled on the repository, and who receives them.

---

## Still open before signup

- **OWNER TO CONFIRM** the items marked above: MFA policy, retention commitment,
  named security contact, insurance, patch cadence.
- `PLAID_WEBHOOK_URL` must be a public HTTPS URL. Local testing needs a tunnel;
  a webhook is optional — the cron sweep syncs regardless.
- Plaid's production access review typically asks for screenshots of the connect
  flow. The Link UI is Phase 2's remaining work.
