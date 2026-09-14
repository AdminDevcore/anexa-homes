import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, NOVA_VOICE, speakable, transcriptionHint } from "../voice";

describe("transcriptionHint", () => {
  it("biases the transcriber toward the words a solar team says", () => {
    const hint = transcriptionHint(null);
    expect(hint).toMatch(/offset/);
    expect(hint).toMatch(/interconnection/);
    expect(hint).toMatch(/PTO/);
  });

  it("names the customer on screen, so their name is heard right", () => {
    expect(transcriptionHint({ leadId: "lead-1", name: "Dana Whitfield" })).toContain("Dana Whitfield");
  });
});

describe("speakable", () => {
  it("leaves plain speech alone", () => {
    expect(speakable("Dana Whitfield is at Contract Signed.")).toBe("Dana Whitfield is at Contract Signed.");
  });

  it("drops markdown a speech engine would read out", () => {
    expect(speakable("**$50,800** in `contracts`\n\n# signed")).toBe("$50,800 in contracts signed");
  });

  it("keeps a long answer to whole sentences within the limit", () => {
    const long = Array.from({ length: 80 }, (_, i) => `Deal number ${i} is waiting on permitting.`).join(" ");
    const out = speakable(long);
    expect(out.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("Nova's voice", () => {
  it("is one of OpenAI's stock voices — not a custom voice, and not a clone of anyone", () => {
    expect(["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"]).toContain(NOVA_VOICE);
  });
});
