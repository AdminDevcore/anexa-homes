/**
 * Interpret a timezone-naive wall-clock string (e.g. "2026-06-18T14:30" from an
 * `<input type="datetime-local">`, or "2026-06-18T14:00:00", with NO offset) as a
 * wall-clock time in `timeZone`, and return the matching absolute instant (UTC).
 *
 * Why this exists: the server runs in UTC, so `new Date("2026-06-18T14:30")`
 * wrongly treats the entered time as UTC. The appointment was meant in the
 * company's local zone (e.g. America/Chicago), so a 2 PM pick would otherwise be
 * stored as 14:00Z and shown as 9 AM Central. This shifts by the zone's offset at
 * that date (DST-aware), independent of the server's own timezone.
 */
/**
 * The inverse of `zonedWallClockToUtc`: render a stored instant as the naive
 * "YYYY-MM-DDTHH:mm" wall clock an `<input type="datetime-local">` expects,
 * read in `timeZone`.
 *
 * Needed because the pair has to round-trip. Seeding such an input from
 * `date.toISOString().slice(0, 16)` hands it the UTC wall clock, which
 * `zonedWallClockToUtc` then reads back as company-local — so merely opening an
 * editor and saving it unchanged walks the appointment by the zone's offset
 * every time. Formatting through the same zone the parser assumes makes an
 * untouched save a no-op.
 */
export function utcToZonedWallClock(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // h23, not hour12:false — the latter renders midnight as "24" in some ICU
    // builds, which an input[type=datetime-local] rejects outright.
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function zonedWallClockToUtc(naiveLocal: string, timeZone: string): Date {
  const asIfUtc = new Date(`${naiveLocal.replace(/Z$/, "")}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return new Date(naiveLocal); // unparseable → best effort
  // Read that same instant in the target zone vs UTC; the gap is the zone offset.
  // The server's local tz cancels out because both reads parse in the same tz.
  const inZone = new Date(asIfUtc.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asIfUtc.getTime() + (inUtc.getTime() - inZone.getTime()));
}
