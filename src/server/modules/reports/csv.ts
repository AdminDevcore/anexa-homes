import type { RenderableReport } from "./builders";

/** RFC-4180 cell escaping — quote anything with a comma, quote, or newline. */
function cell(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Flatten a single renderable report (metrics + tables) to CSV. Shared by the
 * per-report export routes so every report downloads the same way.
 */
export function reportToCsv(report: RenderableReport): string {
  const lines: (string | number)[][] = [];
  lines.push([report.title]);
  lines.push([`Period: ${report.periodLabel}`, `Scope: ${report.scopeLabel}`]);

  if (report.metrics.length) {
    lines.push([]);
    lines.push(["Summary"]);
    for (const m of report.metrics) lines.push([`${m.label}${m.hint ? ` (${m.hint})` : ""}`, m.value]);
  }

  for (const t of report.tables) {
    lines.push([]);
    lines.push([t.title]);
    lines.push(t.columns);
    for (const row of t.rows) lines.push(row);
  }

  return lines.map((r) => r.map(cell).join(",")).join("\n");
}
