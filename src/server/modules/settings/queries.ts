import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  parseDispositions,
  DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS,
  type Disposition,
} from "@/lib/dispositions";
import {
  parseLabelList,
  DEFAULT_INSPECTION_OUTCOMES,
  DEFAULT_QC_CHECKLIST,
  DEFAULT_SOLAR_INSPECTION_OUTCOMES,
  DEFAULT_SOLAR_QC_CHECKLIST,
} from "@/lib/job-settings";
import { readVerticalConfig } from "@/lib/vertical-config";

/** All lead sources (active + inactive) for the settings manager, with usage counts. */
export async function getLeadSourcesForSettings(companyId: string) {
  return prisma.leadSource.findMany({
    where: { companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, active: true, position: true, _count: { select: { leads: true } } },
  });
}

/**
 * The company's customizable, grouped appointment outcomes for one vertical,
 * or that vertical's defaults if unset.
 */
export async function getAppointmentDispositions(
  companyId: string,
  vertical: Vertical
): Promise<Disposition[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { appointmentDispositions: true },
  });
  // Solar shares none of roofing's insurance/storm wording, so an unconfigured
  // solar company falls back to solar outcomes — never to "Hail Damage".
  return parseDispositions(
    readVerticalConfig(settings?.appointmentDispositions, vertical),
    vertical === "solar" ? DEFAULT_SOLAR_APPOINTMENT_DISPOSITIONS : undefined
  );
}

/** The company's customizable inspection outcomes for one vertical. */
export async function getInspectionOutcomes(
  companyId: string,
  vertical: Vertical
): Promise<string[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { inspectionOutcomes: true },
  });
  const fallback =
    vertical === "solar" ? DEFAULT_SOLAR_INSPECTION_OUTCOMES : DEFAULT_INSPECTION_OUTCOMES;
  return parseLabelList(readVerticalConfig(settings?.inspectionOutcomes, vertical), fallback);
}

/** The company's default production QC checklist (labels) for one vertical. */
export async function getQcChecklistTemplate(
  companyId: string,
  vertical: Vertical
): Promise<string[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { qcChecklistTemplate: true },
  });
  const fallback = vertical === "solar" ? DEFAULT_SOLAR_QC_CHECKLIST : DEFAULT_QC_CHECKLIST;
  return parseLabelList(readVerticalConfig(settings?.qcChecklistTemplate, vertical), fallback);
}
