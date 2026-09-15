import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { scriptedModel, scriptedModelAllowed } from "../model";

describe("scriptedModelAllowed", () => {
  it("is never allowed in production, whatever the flag says", () => {
    expect(scriptedModelAllowed({ NOVA_SCRIPTED_MODEL: "1", NODE_ENV: "production" })).toBe(false);
  });

  it("is never allowed on any Vercel deployment", () => {
    expect(scriptedModelAllowed({ NOVA_SCRIPTED_MODEL: "1", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
  });

  it("is off unless asked for", () => {
    expect(scriptedModelAllowed({ NODE_ENV: "development" })).toBe(false);
  });

  it("is allowed for a local test server that asks for it", () => {
    expect(scriptedModelAllowed({ NOVA_SCRIPTED_MODEL: "1", NODE_ENV: "development" })).toBe(true);
  });
});

describe("scriptedModel", () => {
  const turn = (text: string) =>
    ({
      model: "x",
      max_tokens: 1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "<context>…</context>" },
            { type: "text", text },
          ],
        },
      ],
    }) as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming;

  it("turns \"note: …\" into an add_note call for the deal on screen", async () => {
    const msg = await scriptedModel().create(turn("note: Called, left a voicemail"));
    expect(msg.stop_reason).toBe("tool_use");
    expect(msg.content).toEqual([
      expect.objectContaining({ type: "tool_use", name: "add_note", input: { text: "Called, left a voicemail" } }),
    ]);
  });

  it("answers anything else in plain text", async () => {
    const msg = await scriptedModel().create(turn("hello"));
    expect(msg.stop_reason).toBe("end_turn");
    expect(msg.content[0]).toMatchObject({ type: "text" });
  });
});
