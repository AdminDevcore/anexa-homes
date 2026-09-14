/**
 * Is a spoken reply to "Shall I go ahead?" a yes?
 *
 * Deliberately narrow, and deliberately not the model's call: only a reply made
 * of nothing but yes-words confirms. "Yes, but make it three" is not a yes to
 * the thing that was read out, so it comes back "unclear" — and the caller
 * treats unclear as a new request, not a confirmation. Every ambiguity resolves
 * to not writing.
 */

export type Confirmation = "yes" | "no" | "unclear";

const NO = /^(no|nope|nah|negative|cancel|stop|wait|hold on|hang on|don'?t|do not|not yet|never ?mind|forget it)\b/;

const YES_PHRASES = [
  /\bgo ahead\b/g,
  /\bgo for it\b/g,
  /\bdo it\b/g,
  /\bplease do\b/g,
  /\bsounds good\b/g,
  /\bthat'?s right\b/g,
  /\bthat is right\b/g,
];

const YES = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "confirm",
  "confirmed",
  "correct",
  "affirmative",
  "absolutely",
  "definitely",
]);

/** Words that may ride along with a yes without changing it. */
const FILLER = new Set(["please", "thanks", "thank", "you", "nova"]);

export function classifyConfirmation(text: string): Confirmation {
  const said = text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!said) return "unclear";
  if (NO.test(said)) return "no";

  let rest = said;
  for (const phrase of YES_PHRASES) rest = rest.replace(phrase, " yes ");
  const words = rest.split(" ").filter(Boolean);
  const plainYes = words.some((w) => YES.has(w)) && words.every((w) => YES.has(w) || FILLER.has(w));
  return plainYes ? "yes" : "unclear";
}
