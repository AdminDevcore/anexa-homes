// Minimal dependency-free CSV parser (the project has no papaparse). Handles
// quoted fields, escaped quotes (""), embedded commas/newlines, and CRLF.

export type CsvRow = Record<string, string>;

function parseRecords(text: string): string[][] {
  const out: string[][] = [];
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** Parse CSV text into header-keyed row objects. */
export function parseCsv(text: string): { headers: string[]; rows: CsvRow[] } {
  const records = parseRecords(text);
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec.length === 1 && rec[0].trim() === "") continue; // skip blank lines
    const row: CsvRow = {};
    headers.forEach((h, j) => {
      row[h] = (rec[j] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

/** Parse a numeric cell; "" / non-numeric / "UNK" => null. */
export function numOrNull(v?: string): number | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "" || /^unk/i.test(t)) return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
