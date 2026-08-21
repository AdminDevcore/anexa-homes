/**
 * Turning a pipeline stage's colour into a chip you can actually read.
 *
 * Stages carry a raw hex chosen in Settings. Rendering that hex directly as the
 * chip's TEXT over a 13%-alpha tint of itself — which is what the portal did —
 * leaves legibility to chance: "Inspection Passed" is #4ADE80, a pale green,
 * which lands around 1.7:1 on its own tint and is effectively invisible, while
 * a dark navy stage renders almost black. Same component, wildly different
 * chips, none of them chosen.
 *
 * So: keep the HUE the user picked, and pin lightness and chroma to values that
 * always read. Every chip then carries its stage's identity and every chip has
 * the same weight and the same contrast — which is the whole difference between
 * a palette and a pile of hexes.
 */

const CHIP = {
  /** Soft, consistent tint. Never a wash, never a slab. */
  bgL: 0.962,
  bgC: 0.032,
  /** Text. Dark enough to clear 4.5:1 on the tint above at every hue. */
  fgL: 0.44,
  fgC: 0.105,
  /** A hairline that keeps the chip from floating on a light row. */
  borderL: 0.9,
  borderC: 0.045,
} as const;

/** Neutral fallback hue when a stage has no colour, or an unparseable one. */
const NEUTRAL_HUE = 264;
/** Greys carry no meaningful hue; tinting them invents information. */
const GREY_CHROMA = 0.02;

export type ChipStyle = { backgroundColor: string; color: string; borderColor: string };

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Parse #rgb / #rrggbb. Returns null on anything else — callers fall back. */
export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** sRGB hex → OKLCH. Only the hue and chroma survive into a chip. */
export function hexToOklch(hex: string): { l: number; c: number; h: number } | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

/**
 * The chip for a stage colour: its hue, our lightness and chroma.
 *
 * A stage the user left grey stays grey — pushing chroma into an intentional
 * neutral would claim a meaning the colour was never given.
 */
export function stageChipStyle(hex: string | null | undefined): ChipStyle {
  const parsed = hex ? hexToOklch(hex) : null;
  const hue = parsed ? parsed.h : NEUTRAL_HUE;
  const neutral = !parsed || parsed.c < GREY_CHROMA;
  const k = neutral ? 0.28 : 1;
  return {
    backgroundColor: `oklch(${CHIP.bgL} ${(CHIP.bgC * k).toFixed(4)} ${hue.toFixed(1)})`,
    color: `oklch(${CHIP.fgL} ${(CHIP.fgC * k).toFixed(4)} ${hue.toFixed(1)})`,
    borderColor: `oklch(${CHIP.borderL} ${(CHIP.borderC * k).toFixed(4)} ${hue.toFixed(1)})`,
  };
}

/** The dot/rail form: full-strength hue at a fixed, readable depth. */
export function stageAccent(hex: string | null | undefined): string {
  const parsed = hex ? hexToOklch(hex) : null;
  if (!parsed) return `oklch(0.55 0.03 ${NEUTRAL_HUE})`;
  const neutral = parsed.c < GREY_CHROMA;
  return `oklch(0.62 ${neutral ? 0.02 : 0.16} ${parsed.h.toFixed(1)})`;
}

/**
 * Semantic status chips — one recipe per meaning, one weight for all of them.
 *
 * The portal grew seven different recipes for amber alone: bg-50/text-900,
 * bg-100/text-700, bg-100/text-800, bg-50/text-800, bg-50/text-700 and two
 * more. Every one of them is legible on its own — Tailwind's ramps are well
 * built, and all twelve pairings in use clear WCAG AA. The problem is that they
 * clear it at wildly different volumes: 4.54:1 up to 8.77:1. Chips shouting at
 * seven different levels for no reason is what makes a screen look assembled
 * rather than designed.
 *
 * These share the exact lightness and chroma the stage chips use, so a status
 * chip and a stage chip sitting in the same row finally weigh the same.
 */
export type StatusKind = "good" | "warning" | "danger" | "info" | "neutral";

/** Hue per meaning. Only the hue differs; L and C are fixed above. */
const STATUS_HUE: Record<StatusKind, number> = {
  good: 155,     // green
  warning: 75,   // amber
  danger: 27,    // red
  info: 240,     // blue
  neutral: 264,  // the same blue the app's greys carry
};

export function statusChipStyle(kind: StatusKind): ChipStyle {
  const hue = STATUS_HUE[kind];
  const k = kind === "neutral" ? 0.28 : 1;
  return {
    backgroundColor: `oklch(${CHIP.bgL} ${(CHIP.bgC * k).toFixed(4)} ${hue})`,
    color: `oklch(${CHIP.fgL} ${(CHIP.fgC * k).toFixed(4)} ${hue})`,
    borderColor: `oklch(${CHIP.borderL} ${(CHIP.borderC * k).toFixed(4)} ${hue})`,
  };
}

/** The full chip, shape and colour, for a `style` + `className` pair. */
export const STATUS_CHIP_CLASS =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium";
