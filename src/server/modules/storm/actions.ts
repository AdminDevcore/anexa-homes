"use server";

import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getStormConfig } from "./config";
import { importNoaaCsv } from "./import-noaa";
import { importSpcCsv, type SpcKind } from "./import-spc";
import { recomputeStormMatches } from "./matches";

function fail(error: string) {
  return { ok: false as const, error };
}

const SPC_KINDS: SpcKind[] = ["hail", "wind", "torn"];

/**
 * Import a storm-data CSV uploaded by an admin. `source` = "noaa" (Storm Events
 * details file) or "spc" (one daily report kind, with spcKind + reportDate).
 * Triggers a match recompute so scores reflect the new data immediately.
 */
export async function importStormCsvAction(formData: FormData) {
  const user = await requireUser();
  if (!can(user, "manage", "StormIntelligence")) return fail("You can't import storm data.");

  const file = formData.get("file");
  if (!(file instanceof File)) return fail("No file uploaded.");
  const text = await file.text();
  if (!text.trim()) return fail("That file is empty.");

  const source = String(formData.get("source") || "");
  const cfg = await getStormConfig(user.companyId);

  try {
    if (source === "noaa") {
      const result = await importNoaaCsv(user.companyId, text, cfg.center, cfg.radiusMiles);
      await recomputeStormMatches(user.companyId);
      return { ok: true as const, results: [result] };
    }
    if (source === "spc") {
      const kind = String(formData.get("spcKind") || "") as SpcKind;
      if (!SPC_KINDS.includes(kind)) return fail("Pick an SPC report type (hail, wind, or tornado).");
      const dateStr = String(formData.get("reportDate") || "");
      const reportDate = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
      if (Number.isNaN(reportDate.getTime())) return fail("Invalid report date.");
      const result = await importSpcCsv(user.companyId, kind, text, reportDate, cfg.center, cfg.radiusMiles);
      await recomputeStormMatches(user.companyId);
      return { ok: true as const, results: [result] };
    }
    return fail("Unknown import source.");
  } catch (e) {
    console.error("[storm:import] failed", e);
    return fail("Import failed — check the CSV format and try again.");
  }
}
