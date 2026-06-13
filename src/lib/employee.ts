/** Format a sequential employee number as <recordPrefix><5-digit>, e.g. AH-00001.
 *  Lower number = earlier hire = higher rank. Returns null when unassigned. */
export function formatEmployeeNo(recordPrefix: string, n: number | null | undefined): string | null {
  if (n == null) return null;
  return `${recordPrefix || ""}${String(n).padStart(5, "0")}`;
}
