import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import type { NovaTool } from "./define";
import { findDeal } from "./find-deal";
import { getDeal } from "./get-deal";
import { listDeals } from "./list-deals";
import { getPipelineSummary } from "./pipeline-summary";
import { getSalesSummary } from "./sales-summary";
import { listAppointments } from "./list-appointments";
import { listTasks } from "./list-tasks";
import { getTeamMember } from "./team-member";
import { declineRequest } from "./decline";
import { addNote } from "./write/add-note";
import { createFollowUp, createTask } from "./write/tasks";
import { createLead } from "./write/create-lead";
import { bookAppointment, setAppointmentOutcome } from "./write/appointments";

/** Order is stable on purpose: the tool list is part of the cached prompt prefix. */
export const NOVA_TOOLS: NovaTool[] = [
  findDeal,
  getDeal,
  listDeals,
  getPipelineSummary,
  getSalesSummary,
  listAppointments,
  listTasks,
  getTeamMember,
  addNote,
  createTask,
  createFollowUp,
  createLead,
  bookAppointment,
  setAppointmentOutcome,
  declineRequest,
];

export const NOVA_TOOLS_BY_NAME = new Map(NOVA_TOOLS.map((t) => [t.name, t]));

export function toolDefinitions(tools: NovaTool[] = NOVA_TOOLS): Anthropic.Beta.BetaTool[] {
  return tools.map((t) => {
    const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
    };
  });
}
