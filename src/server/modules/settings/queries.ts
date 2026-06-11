import { prisma } from "@/server/db/client";
import { parseDispositions, type Disposition } from "@/lib/dispositions";

/** The company's customizable, grouped appointment outcomes, or the defaults if unset. */
export async function getAppointmentDispositions(companyId: string): Promise<Disposition[]> {
  const settings = await prisma.companySettings.findUnique({
    where: { companyId },
    select: { appointmentDispositions: true },
  });
  return parseDispositions(settings?.appointmentDispositions);
}
