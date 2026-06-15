import { prisma } from "@/server/db/client";
import { parseDispositions, type Disposition } from "@/lib/dispositions";
import {
  parseLabelList,
  DEFAULT_INSPECTION_OUTCOMES,
  DEFAULT_QC_CHECKLIST,
} from "@/lib/job-settings";

/** All lead sources (active + inactive) for the settings manager, with usage counts. */
export async function getLeadSourcesForSettings(companyId: string) {
  return prisma.leadSource.findMany({
    where: { companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, active: true, position: true, _count: { select: { leads: true } } },
  });
}

/** The company's customizable, grouped appointment outcomes, or the defaults if unset. */
export async function getAppointmentDispositions(companyId: string): Promise<Disposition[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { appointmentDispositions: true },
  });
  return parseDispositions(settings?.appointmentDispositions);
}

/** The company's customizable inspection outcomes, or the defaults if unset. */
export async function getInspectionOutcomes(companyId: string): Promise<string[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { inspectionOutcomes: true },
  });
  return parseLabelList(settings?.inspectionOutcomes, DEFAULT_INSPECTION_OUTCOMES);
}

/** The company's default production QC checklist (labels), or the defaults if unset. */
export async function getQcChecklistTemplate(companyId: string): Promise<string[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { qcChecklistTemplate: true },
  });
  return parseLabelList(settings?.qcChecklistTemplate, DEFAULT_QC_CHECKLIST);
}
