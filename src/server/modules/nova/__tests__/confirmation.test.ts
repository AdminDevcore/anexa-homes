import { describe, expect, it } from "vitest";
import { classifyConfirmation } from "../confirmation";

describe("classifyConfirmation", () => {
  it.each([
    "yes",
    "Yes.",
    "yeah",
    "yep",
    "sure",
    "ok",
    "Okay, do it.",
    "go ahead",
    "yes please",
    "Confirm",
    "do it",
    "that's right",
    "That’s right",
    "Yes, go ahead Nova.",
  ])("%j is a yes", (text) => {
    expect(classifyConfirmation(text)).toBe("yes");
  });

  it.each([
    "no",
    "No.",
    "nope",
    "cancel",
    "Cancel that",
    "don't",
    "do not",
    "stop",
    "wait",
    "hold on",
    "never mind",
    "nevermind",
    "not yet",
    "No, make it 3pm",
  ])("%j is a no", (text) => {
    expect(classifyConfirmation(text)).toBe("no");
  });

  it.each([
    "",
    "   ",
    "please",
    "thanks",
    "yes but make it 3pm",
    "what time was that?",
    "okay what about Omar",
    "sure, and add a note too",
    "yes no",
  ])("%j is neither — anything but a plain yes never confirms", (text) => {
    expect(classifyConfirmation(text)).toBe("unclear");
  });
});
