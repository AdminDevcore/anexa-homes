import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runTurn, type NovaModel } from "../loop";
import type { NovaCtx, ToolResult } from "../types";

const ctx: NovaCtx = {
  user: {
    userId: "u1",
    companyId: "c1",
    role: "sales_rep",
    permissions: {},
    fullName: "Ada Rep",
  },
  conversationId: "conv-1",
  timeZone: "America/Chicago",
  now: new Date("2026-09-15T15:00:00Z"),
  page: null,
};

type Block = Record<string, unknown>;
const message = (stop_reason: string, content: Block[]) =>
  ({ id: "m", type: "message", role: "assistant", model: "x", stop_reason, content, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;

function scripted(...responses: Anthropic.Beta.BetaMessage[]) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const model: NovaModel = {
    create: vi.fn(async (params) => {
      calls.push(structuredClone(params));
      const next = responses.shift();
      if (!next) throw new Error("model called more times than scripted");
      return next;
    }),
  };
  return { model, calls };
}

describe("runTurn", () => {
  it("runs a read tool, hands the result back, and speaks the model's answer", async () => {
    const { model, calls } = scripted(
      message("tool_use", [{ type: "tool_use", id: "t1", name: "find_deal", input: { query: "Dana" } }]),
      message("end_turn", [{ type: "text", text: "Dana Whitfield is at Contract Signed." }])
    );
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ ok: true, data: { matches: [{ customer: "Dana Whitfield" }] } }));

    const out = await runTurn(ctx, { text: "where is Dana?", history: [] }, { model, runTool });

    expect(runTool).toHaveBeenCalledWith(ctx, "find_deal", { query: "Dana" });
    expect(out).toMatchObject({ kind: "answer", reply: "Dana Whitfield is at Contract Signed." });
    const second = calls[1].messages;
    const last = second[second.length - 1];
    expect(last.role).toBe("user");
    expect(JSON.stringify(last.content)).toContain("tool_result");
    expect(JSON.stringify(last.content)).toContain("Dana Whitfield");
  });

  it("returns a refused tool to the model as an error, with the reason", async () => {
    const { model, calls } = scripted(
      message("tool_use", [{ type: "tool_use", id: "t1", name: "get_team_member", input: { name: "Bea" } }]),
      message("end_turn", [{ type: "text", text: "Your role can't look up team members." }])
    );
    const runTool = vi.fn(async (): Promise<ToolResult> => ({
      ok: false,
      reason: "refused",
      message: "Your role (Sales Rep) can't look up team members.",
    }));

    const out = await runTurn(ctx, { text: "who is Bea?", history: [] }, { model, runTool });

    expect(out.kind).toBe("answer");
    const result = JSON.stringify(calls[1].messages.at(-1)!.content);
    expect(result).toContain('"is_error":true');
    expect(result).toContain("can't look up team members");
  });

  it("answers a declined capability with the canned sentence, without asking the model again", async () => {
    const { model } = scripted(
      message("tool_use", [
        { type: "tool_use", id: "t1", name: "decline_request", input: { capability: "change_deal_stage" } },
      ])
    );
    const runTool = vi.fn(async (): Promise<ToolResult> => ({
      ok: true,
      data: { message: "I can't change a deal's stage." },
    }));

    const out = await runTurn(ctx, { text: "move it to permitting", history: [] }, { model, runTool });

    expect(out).toMatchObject({ kind: "declined", reply: "I can't change a deal's stage." });
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when the model refuses", async () => {
    const { model } = scripted(message("refusal", []));
    const out = await runTurn(ctx, { text: "…", history: [] }, { model, runTool: vi.fn() });
    expect(out.kind).toBe("error");
    expect(out.reply.length).toBeGreaterThan(0);
  });

  it("stops after a bounded number of tool rounds", async () => {
    const loopForever = Array.from({ length: 20 }, (_, i) =>
      message("tool_use", [{ type: "tool_use", id: `t${i}`, name: "find_deal", input: { query: "x" } }])
    );
    const { model } = scripted(...loopForever);
    const runTool = vi.fn(async (): Promise<ToolResult> => ({ ok: true, data: {} }));

    const out = await runTurn(ctx, { text: "x", history: [] }, { model, runTool });

    expect(out.kind).toBe("error");
    expect((model.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("puts the page and the date in the user turn, never in the cached system prompt", async () => {
    const { model, calls } = scripted(message("end_turn", [{ type: "text", text: "ok" }]));
    await runTurn(
      { ...ctx, page: { leadId: "lead-1", name: "Dana Whitfield" } },
      { text: "hello", history: [{ role: "assistant", text: "earlier" }, { role: "user", text: "prior" }] },
      { model, runTool: vi.fn() }
    );
    const params = calls[0];
    expect(JSON.stringify(params.system)).not.toContain("Dana Whitfield");
    expect(JSON.stringify(params.system)).not.toContain("2026");
    const turn = JSON.stringify(params.messages.at(-1));
    expect(turn).toContain("Dana Whitfield");
    expect(turn).toContain("lead-1");
    // A history may not start with the assistant.
    expect(params.messages[0].role).toBe("user");
  });
});
