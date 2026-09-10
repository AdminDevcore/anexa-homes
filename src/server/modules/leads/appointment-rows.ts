import type { ServiceType } from "@prisma/client";
import { serviceTypeLabel } from "@/lib/service-types";
import { addressSearchText } from "@/lib/address";
import type { AppointmentRow } from "@/components/portal/appointments-list";

/**
 * Shapes leads into the rows the Appointments list renders.
 *
 * Money and dates are formatted HERE, on the server, so they honour the
 * company's locale and timezone rather than whatever the browser happens to be
 * set to. The client component then owns only search + outcome filtering.
 *
 * This is a plain per-request function, not a component: reading the clock once
 * per request is the intended behaviour, and keeping it out of a render body
 * keeps the page component pure.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "in 4 days" / "2 wks ago" — coarse on purpose; the exact time sits above it. */
export function relativeLabel(date: Date, now: number, locale = "en"): string {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / (7 * DAY)), "week");
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), "month");
  return rtf.format(Math.round(diff / (365 * DAY)), "year");
}

type LeadForRow = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  serviceType: ServiceType;
  value: number;
  appointmentAt: Date | null;
  appointmentDisposition: string | null;
  stage: { name: string; color: string; isLost: boolean } | null;
  source: { name: string } | null;
  assignedRep: { firstName: string; lastName: string } | null;
};

type Formatters = {
  money: (cents: number, opts?: { compact?: boolean }) => string;
  dateTime: (d: Date | string | null | undefined) => string;
};

export function buildAppointmentRows(
  leads: LeadForRow[],
  fmt: Formatters,
  now: number = Date.now()
): AppointmentRow[] {
  return leads.map((l) => ({
    id: l.id,
    name: `${l.firstName} ${l.lastName}`.trim(),
    phone: l.phone,
    email: l.email,
    // Searchable only — the list has no address column, but reps look deals up
    // by house ("the one on Oak", "75024") as often as by name.
    address: addressSearchText(l) || null,
    typeLabel: serviceTypeLabel(l.serviceType),
    sourceName: l.source?.name ?? null,
    stage: l.stage ? { name: l.stage.name, color: l.stage.color } : null,
    // The deal is dead. Carried as its own field rather than re-read from the
    // stage name, which is per-company free text ("Cancelled", "Dead", "Lost").
    isCancelled: l.stage?.isLost ?? false,
    repName: l.assignedRep ? `${l.assignedRep.firstName} ${l.assignedRep.lastName}` : null,
    value: fmt.money(l.value, { compact: true }),
    hasValue: l.value > 0,
    when: l.appointmentAt ? fmt.dateTime(l.appointmentAt) : null,
    relative: l.appointmentAt ? relativeLabel(l.appointmentAt, now) : null,
    isPast: l.appointmentAt ? l.appointmentAt.getTime() < now : false,
    outcome: l.appointmentDisposition,
  }));
}
