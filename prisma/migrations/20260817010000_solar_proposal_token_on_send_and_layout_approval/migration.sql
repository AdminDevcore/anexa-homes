-- Public access is minted on SEND, not on generate; plus layout approval state.
--
-- Solar tables only (solar_proposals, solar_designs). Roofing's own proposal
-- table (`proposals`) and its public /present/[token] route are untouched.

-- ── 1. publicToken becomes nullable ────────────────────────────────────────
-- Generating a proposal is internal. It used to mint a live public URL as a
-- side effect, so every draft anyone had ever generated was already reachable
-- on the open internet. NULL now means "no public surface exists".
--
-- The UNIQUE index is kept as-is: Postgres treats NULLs as DISTINCT, so any
-- number of unsent proposals coexist at NULL while every real token stays 1:1.
ALTER TABLE "solar_proposals" ALTER COLUMN "publicToken" DROP NOT NULL;

-- ── 2. Retire tokens that were minted but never sent ───────────────────────
-- These were created by the old generate-mints-a-token behaviour and were never
-- shared with anybody: sentAt is NULL, so no customer has ever been given the
-- link. Clearing them removes a live public URL that should never have existed.
--
-- Deliberately scoped to sentAt IS NULL: a proposal that HAS been sent keeps its
-- token, because a customer may be holding that link right now and revoking it
-- would break a live document.
--
-- Reversible in the sense that matters: sending mints a fresh token. There is
-- nothing to restore, because nothing was ever distributed.
UPDATE "solar_proposals"
   SET "publicToken" = NULL
 WHERE "sentAt" IS NULL
   AND "signedAt" IS NULL
   AND "viewedAt" IS NULL
   AND "status" IN ('draft', 'generated');

-- ── 3. Layout approval ─────────────────────────────────────────────────────
-- A layout is PRELIMINARY until somebody accountable marks it final. Defaulting
-- to false means every existing design keeps the caveat on the proposal, which
-- is the safe direction: the failure mode of a wrong default here is telling a
-- customer a drawing is final when it is not.
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "layoutApproved"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "layoutApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "layoutApprovedAt"   TIMESTAMP(3);
