import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { canSeeFinancials } from "@/server/modules/dashboard/queries";
import { formatMoney } from "../format";
import { CONTRACT_VALUE_RULE, reportedPrices } from "../sales";
import { defineTool, z } from "./define";

export const getPipelineSummary = defineTool({
  name: "get_pipeline_summary",
  kind: "read",
  description:
    "How many Solar deals sit in each pipeline stage and what they are worth by contract price. Includes the definition of the value to say out loud.",
  input: z.object({}),
  async run(ctx) {
    // VALUE = CONTRACT PRICE FROM SOURCE, not Lead.value (the after-credit
    // figure) and not any dashboard total — see the note at the top of sales.ts.
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId: ctx.user.companyId, vertical: "solar" },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" } } },
    });
    if (!pipeline) return { ok: true, data: { stages: [], note: "There is no Solar pipeline yet." } };

    const scope = listScope(ctx.user, "Lead") as Prisma.LeadWhereInput;
    const leads = await prisma.lead.findMany({
      where: { AND: [scope, { vertical: "solar", pipelineId: pipeline.id }] },
      select: { id: true, stageId: true },
    });
    // Money follows the dashboard's own gate for company figures.
    const seeMoney = canSeeFinancials(ctx.user);
    const prices = seeMoney ? await reportedPrices(ctx.user.companyId, leads.map((l) => l.id)) : new Map();

    const stages = pipeline.stages.map((s) => {
      const here = leads.filter((l) => l.stageId === s.id);
      const priced = here
        .map((l) => prices.get(l.id)?.contractPriceCents)
        .filter((c): c is number => c != null);
      return {
        stage: s.name,
        deals: here.length,
        ...(seeMoney
          ? {
              contract_value: formatMoney(priced.reduce((a, b) => a + b, 0)),
              deals_without_contract_price: here.length - priced.length,
            }
          : {}),
        ...(s.isLost ? { lost_stage: true } : {}),
      };
    });

    return {
      ok: true,
      data: {
        pipeline: pipeline.name,
        stages,
        ...(seeMoney
          ? { value_definition: `Stage value is ${CONTRACT_VALUE_RULE}.` }
          : { note: "Your role doesn't see dollar figures, so this is counts only." }),
      },
    };
  },
});
