import { describe, it, expect } from "vitest";
import { parseCsv, numOrNull } from "../csv";

describe("csv parser", () => {
  it("parses headers + rows", () => {
    const { headers, rows } = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(headers).toEqual(["a", "b", "c"]);
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("handles quoted fields with commas + escaped quotes", () => {
    const { rows } = parseCsv('name,note\n"Smith, John","said ""hi"""\n');
    expect(rows[0]).toEqual({ name: "Smith, John", note: 'said "hi"' });
  });

  it("handles CRLF and skips blank lines", () => {
    const { rows } = parseCsv("a,b\r\n1,2\r\n\r\n3,4\r\n");
    expect(rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("numOrNull handles SPC quirks", () => {
    expect(numOrNull("100")).toBe(100);
    expect(numOrNull("61")).toBe(61);
    expect(numOrNull("UNK")).toBeNull();
    expect(numOrNull("")).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
  });
});
