import { describe, it, expect } from "vitest";
import { hexToOklch, parseHex, stageChipStyle, stageAccent } from "../chip-color";

/** OKLCH string -> sRGB, so contrast can be asserted rather than eyeballed. */
function oklchStringToRgb(s: string): [number, number, number] {
  const m = s.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/);
  if (!m) throw new Error(`not an oklch string: ${s}`);
  const [L, C, hDeg] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const ss = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * ss,
  ];
  return lin.map((v) => {
    const c = Math.max(0, Math.min(1, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  }) as [number, number, number];
}

function luminance(rgb: number[]): number {
  const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(oklchStringToRgb(a)), luminance(oklchStringToRgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Every colour the seeded Roofing and Solar pipelines actually ship with. */
const STAGE_COLORS = [
  "#A1A1AA", "#22C55E", "#16A34A", "#EF4444", "#4ADE80", "#F97316", "#FB7185",
  "#34D399", "#2DD4BF", "#67E8F9", "#818CF8", "#C084FC", "#FBBF24", "#60A5FA",
];

describe("parseHex", () => {
  it("accepts long and short form", () => {
    expect(parseHex("#ffffff")).toEqual([1, 1, 1]);
    expect(parseHex("#fff")).toEqual([1, 1, 1]);
    expect(parseHex("000000")).toEqual([0, 0, 0]);
  });

  it("rejects anything that is not a hex colour", () => {
    for (const bad of ["", "#12", "rgb(1,2,3)", "#gggggg", "not a colour"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe("hexToOklch", () => {
  it("puts pure red near hue 29 and pure blue near hue 264", () => {
    expect(hexToOklch("#ff0000")!.h).toBeCloseTo(29.2, 0);
    expect(hexToOklch("#0000ff")!.h).toBeCloseTo(264.1, 0);
  });

  it("reports greys as having essentially no chroma", () => {
    expect(hexToOklch("#808080")!.c).toBeLessThan(0.001);
  });
});

describe("stageChipStyle", () => {
  it("clears WCAG AA on every stage colour the app ships", () => {
    // This is the property the old `${color}22` chips failed: a pale green
    // stage rendered its own hex as text and came out around 1.7:1.
    for (const hex of STAGE_COLORS) {
      const s = stageChipStyle(hex);
      expect(contrast(s.color, s.backgroundColor), `chip for ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps the hue the user chose", () => {
    const green = stageChipStyle("#22C55E");
    const red = stageChipStyle("#EF4444");
    const hue = (s: string) => Number(s.match(/oklch\([\d.]+ [\d.]+ ([\d.]+)\)/)![1]);
    expect(hue(green.color)).toBeCloseTo(hexToOklch("#22C55E")!.h, 0);
    expect(hue(red.color)).toBeCloseTo(hexToOklch("#EF4444")!.h, 0);
  });

  it("gives every chip the same weight, whatever the hue", () => {
    // The point of the system: two chips differ in hue and in nothing else.
    const a = stageChipStyle("#22C55E");
    const b = stageChipStyle("#EF4444");
    const lc = (s: string) => s.match(/oklch\(([\d.]+) ([\d.]+) /)!.slice(1, 3).join(",");
    expect(lc(a.color)).toBe(lc(b.color));
    expect(lc(a.backgroundColor)).toBe(lc(b.backgroundColor));
  });

  it("leaves a deliberately grey stage grey instead of inventing a colour", () => {
    const grey = stageChipStyle("#A1A1AA");
    const chroma = Number(grey.color.match(/oklch\([\d.]+ ([\d.]+) /)![1]);
    expect(chroma).toBeLessThan(0.04);
  });

  it("falls back to a readable neutral for a missing or broken colour", () => {
    for (const bad of [null, undefined, "", "chartreuse"]) {
      const s = stageChipStyle(bad);
      expect(contrast(s.color, s.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("stageAccent", () => {
  it("returns a saturated, fixed-depth colour for dots and rails", () => {
    expect(stageAccent("#22C55E")).toMatch(/^oklch\(0\.62 0\.16 /);
    expect(stageAccent(null)).toMatch(/^oklch\(/);
  });
});
