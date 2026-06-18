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
export function zonedWallClockToUtc(naiveLocal: string, timeZone: string): Date {
  const asIfUtc = new Date(`${naiveLocal.replace(/Z$/, "")}Z`);
  if (Number.isNaN(asIfUtc.getTime())) return new Date(naiveLocal); // unparseable → best effort
  // Read that same instant in the target zone vs UTC; the gap is the zone offset.
  // The server's local tz cancels out because both reads parse in the same tz.
  const inZone = new Date(asIfUtc.toLocaleString("en-US", { timeZone }));
  const inUtc = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asIfUtc.getTime() + (inUtc.getTime() - inZone.getTime()));
}
