import { prisma } from "@/server/db/client";
import type { Facet } from "@/lib/roof";

export type RoofReportDTO = {
  id: string;
  leadId: string;
  facets: Facet[];
  footprintArea: number;
  roofArea: number;
  squares: number;
  facetCount: number;
  predominantPitch: string | null;
  perimeterFt: number;
  ridgeFt: number;
  hipFt: number;
  valleyFt: number;
  eaveFt: number;
  rakeFt: number;
  wastePct: number;
  squaresToOrder: number;
  preparedBy: string | null;
  reportFileId: string | null;
  updatedAt: string;
};

export async function getRoofReport(companyId: string, leadId: string): Promise<RoofReportDTO | null> {
  const r = await prisma.roofReport.findFirst({ where: { companyId, leadId } });
  if (!r) return null;
  return {
    id: r.id,
    leadId: r.leadId,
    facets: (r.facets as unknown as Facet[]) ?? [],
    footprintArea: r.footprintArea,
    roofArea: r.roofArea,
    squares: r.squares,
    facetCount: r.facetCount,
    predominantPitch: r.predominantPitch,
    perimeterFt: r.perimeterFt,
    ridgeFt: r.ridgeFt,
    hipFt: r.hipFt,
    valleyFt: r.valleyFt,
    eaveFt: r.eaveFt,
    rakeFt: r.rakeFt,
    wastePct: r.wastePct,
    squaresToOrder: r.squaresToOrder,
    preparedBy: r.preparedBy,
    reportFileId: r.reportFileId,
    updatedAt: r.updatedAt.toISOString(),
  };
}
