# Simple Cash Bid

**Date:** 2026-07-12
**Status:** Approved — build directly.

## Goal
A stripped-down, one-page **cash bid** a rep can send to a cash client with no
inspection: work + price + a 50/50 payment schedule + a place for the homeowner
to sign. No photos, no roof-condition/scope/insurance fluff. Separate from the
heavy proposal/presentation.

## Decisions
- **Standalone one-pager + inline signature** (not the presentation, not the
  e-sign document package).
- Payment terms **50% upfront / 50% on completion**, deposit % **editable** per
  bid (defaults 50).
- Work shown as a **short free-text description**.

## Data — `CashBid` (new table, scalar FKs like the storm module; no relations
added to Company/Lead/User to avoid churn)
- id, companyId, leadId, token (unique), createdById
- workDescription (text), totalCents (int), depositPercent (int, default 50)
- status: `draft | sent | signed`
- signerName?, signerIp?, signedAt?, sentAt?
- createdAt, updatedAt
- Derived: depositCents = round(total × pct/100); balanceCents = total − deposit.

## Server — `src/server/modules/cashbid/`
- `money.ts`: `bidAmounts(totalCents, depositPercent)` → { depositCents, balanceCents }.
- `queries.ts`: `getCashBidsForLead(companyId, leadId)`; `getCashBidByToken(token)`
  → bid + lead display (homeowner name, address) + resolved branding.
- `actions.ts`: `createCashBidAction`, `updateCashBidAction`, `deleteCashBidAction`
  (rep, gated by lead access + can manage Lead); `signCashBidAction(token, name)`
  (public, token-gated; sets status=signed, signerName, signedAt, signerIp).

## Pages / components
- **Public** `src/app/bid/[token]/page.tsx` (no auth) → renders the one-pager +
  `<CashBidSign>` (client): typed full name + agreement checkbox + Sign & Accept.
  After signing → "Accepted on <date>" + Print/Save-PDF. Print stylesheet.
- **Portal** `src/components/portal/cash-bid-panel.tsx` — a "Simple Cash Bid"
  button/dialog on the lead detail page (next to Build Presentation): form
  (work description, total, deposit %), then shows the copyable link + status,
  and lists existing bids for the lead.

## RBAC / security
- Create/manage: same roles that manage Leads (reps/managers/admins), scoped to
  company + lead access.
- Public bid page + sign: **token only** (unguessable UUID), unauthenticated —
  same posture as the proposal public view / review photos.

## Out of scope (the "no fluff")
Inspection photos, roof-condition/damage, scope calculator, insurance math,
multi-doc e-sign. (Drawn-signature pad and SMS/email send are easy later adds.)

## Migration
New `cash_bids` table + `CashBidStatus` enum — additive. Apply to prod manually
(session pooler).
