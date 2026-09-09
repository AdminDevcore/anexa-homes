-- Drop the storage rebate catalogue and the per-deal rows it produced.
--
-- A rebate was somebody else's money passed through to the customer: priced
-- once in Settings, applied per deal, subtracted from GROSS before the lender's
-- cut. The company runs no incentive programme, so the catalogue was never
-- filled -- `solar_rebates` is empty and `solar_deal_rebates` has never held a
-- row -- and with an empty catalogue the panel on the Financing step never
-- rendered at all. This drops storage, not data, and no deal reprices.
--
-- It also closes a live disagreement. The builder subtracted a rebate on ANY
-- deal carrying a battery, while `proposal-generate` read the total only on a
-- storage-only deal. The first rebate anybody added would have quoted a
-- solar-plus-battery household one price on the screen and printed another on
-- their agreement.
--
-- Order matters: the deal rows reference the catalogue with onDelete Restrict.
DROP TABLE IF EXISTS "solar_deal_rebates";
DROP TABLE IF EXISTS "solar_rebates";
