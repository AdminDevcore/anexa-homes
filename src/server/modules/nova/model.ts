import Anthropic from "@anthropic-ai/sdk";
import { anthropicModel, type NovaModel } from "./loop";

type Env = Record<string, string | undefined>;

/**
 * Whether the scripted stand-in may answer instead of Claude.
 *
 * Only for a local test server that asks for it with NOVA_SCRIPTED_MODEL=1.
 * Refused in production and on every Vercel deployment, whatever the flag says.
 */
export function scriptedModelAllowed(env: Env = process.env): boolean {
  if (env.NODE_ENV === "production" || env.VERCEL_ENV) return false;
  return env.NOVA_SCRIPTED_MODEL === "1";
}

/** The model a request talks to. */
export function novaModel(): NovaModel {
  if (scriptedModelAllowed()) return scriptedModel();
  return anthropicModel(new Anthropic({ timeout: 50_000, maxRetries: 1 }));
}

const reply = (content: unknown[], stop_reason: "tool_use" | "end_turn") =>
  ({
    id: "msg_scripted",
    type: "message",
    role: "assistant",
    model: "scripted",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }) as unknown as Anthropic.Beta.BetaMessage;

/**
 * A stand-in for Claude driven by fixed phrases, so the browser tests exercise
 * the real routes, tools, permissions, audit and confirmation without a model
 * key or a model's judgement:
 *
 *   "note: <text>"   → add_note on the deal on screen
 *   "find <query>"   → find_deal, then a plain answer quoting the result
 *   anything else    → a plain answer
 */
export function scriptedModel(): NovaModel {
  return {
    async create(params) {
      const last = params.messages[params.messages.length - 1];
      const blocks: Anthropic.Beta.BetaContentBlockParam[] =
        typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;

      const results = blocks.filter((b): b is Anthropic.Beta.BetaToolResultBlockParam => b.type === "tool_result");
      if (results.length > 0) {
        const seen = results.map((r) => (typeof r.content === "string" ? r.content : JSON.stringify(r.content))).join(" ");
        return reply([{ type: "text", text: `Scripted answer from: ${seen.slice(0, 300)}` }], "end_turn");
      }

      const texts = blocks.filter((b): b is Anthropic.Beta.BetaTextBlockParam => b.type === "text");
      const said = texts[texts.length - 1]?.text.trim() ?? "";
      const note = /^note:\s*([\s\S]+)$/i.exec(said);
      if (note) {
        return reply([{ type: "tool_use", id: "toolu_scripted_note", name: "add_note", input: { text: note[1] } }], "tool_use");
      }
      const find = /^find\s+(.+)$/i.exec(said);
      if (find) {
        return reply([{ type: "tool_use", id: "toolu_scripted_find", name: "find_deal", input: { query: find[1] } }], "tool_use");
      }
      return reply([{ type: "text", text: "This is the scripted test model." }], "end_turn");
    },
  };
}
