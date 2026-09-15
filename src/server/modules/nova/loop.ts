import Anthropic from "@anthropic-ai/sdk";
import { roleLabel } from "@/lib/roles";
import { formatDay } from "./format";
import { NOVA_SYSTEM_PROMPT } from "./prompt";
import { toolDefinitions } from "./tools/registry";
import type { HistoryTurn, NovaCtx, NovaReply, ToolResult } from "./types";

export const NOVA_MODEL_ID = "claude-opus-5";

/** How many model calls one spoken request may take before Nova gives up. */
const MAX_STEPS = 6;
const HISTORY_TURNS = 12;

export type NovaModel = {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
};

/**
 * The real model. Server-side refusal fallback is on: if Claude Opus 5 declines
 * a request, the API re-runs it on Anthropic's recommended fallback model
 * inside the same call rather than handing Nova a refusal.
 */
export function anthropicModel(client: Anthropic = new Anthropic()): NovaModel {
  return {
    create: (params) =>
      client.beta.messages.create({
        ...params,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
  };
}

export type TurnOutcome = NovaReply;

export type TurnDeps = {
  model: NovaModel;
  runTool: (ctx: NovaCtx, name: string, input: unknown) => Promise<ToolResult>;
  tools?: Anthropic.Beta.BetaTool[];
};

/** Everything that changes per turn, kept out of the cached system prompt. */
export function contextBlock(ctx: NovaCtx): string {
  const lines = [
    `Today is ${formatDay(ctx.now, ctx.timeZone)}. Times are in ${ctx.timeZone}.`,
    `Signed in: ${ctx.user.fullName} (${roleLabel(ctx.user.role)}).`,
    "Workspace: Solar.",
    ctx.page
      ? `On screen: the deal for ${ctx.page.name} (deal_id ${ctx.page.leadId}).`
      : "On screen: no particular deal.",
  ];
  return `<context>\n${lines.join("\n")}\n</context>`;
}

function historyMessages(history: HistoryTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const turns = history.filter((h) => h.text.trim()).slice(-HISTORY_TURNS);
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns.map((h) => ({ role: h.role, content: h.text }));
}

function spokenText(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}

/**
 * One spoken request, answered.
 *
 * A manual loop rather than the SDK's tool runner because the moment a WRITE is
 * proposed the request has to end and wait for a person — across a second HTTP
 * call — and only reads may run inside the loop at all.
 */
export async function runTurn(
  ctx: NovaCtx,
  input: { text: string; history: HistoryTurn[] },
  deps: TurnDeps
): Promise<TurnOutcome> {
  const tools = deps.tools ?? toolDefinitions();
  const used: string[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...historyMessages(input.history),
    {
      role: "user",
      content: [
        { type: "text", text: contextBlock(ctx) },
        { type: "text", text: input.text },
      ],
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await deps.model.create({
      model: NOVA_MODEL_ID,
      max_tokens: 8000,
      system: [{ type: "text", text: NOVA_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      messages,
    });

    if (response.stop_reason === "refusal") {
      return { kind: "error", reply: "I can't help with that request.", tools: used };
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const calls = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use"
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      return {
        kind: "answer",
        reply: spokenText(response) || "I don't have an answer for that.",
        tools: used,
      };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      used.push(call.name);
      const result = await deps.runTool(ctx, call.name, call.input);
      // A write has been proposed, not done. The turn ends here: nothing else
      // runs and the model is not consulted again until the user answers.
      if (result.ok && result.proposal) {
        const { pendingActionId, summary } = result.proposal;
        return {
          kind: "confirm",
          reply: `${summary} Shall I go ahead?`,
          pending: { id: pendingActionId, summary },
          tools: used,
        };
      }
      // A declined capability gets the canned, audited sentence — the model
      // does not get a second chance to phrase (or soften) the refusal.
      if (call.name === "decline_request" && result.ok) {
        return { kind: "declined", reply: String(result.data.message), tools: used };
      }
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.message }),
        ...(result.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return {
    kind: "error",
    reply: "That took more steps than I'm allowed. Try asking something narrower.",
    tools: used,
  };
}
