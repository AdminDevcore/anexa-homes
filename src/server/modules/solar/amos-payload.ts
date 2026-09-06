/**
 * Translating an Anexa deal into a lender's partner-API application.
 *
 * Pure functions, no I/O — the network call lives in `amos-client.ts`. Kept
 * apart so the mapping can be tested exhaustively without a lender to talk to,
 * because a wrong figure here becomes a real credit application.
 *
 * WHAT WE DELIBERATELY DO NOT SEND
 *
 * No SSN, no date of birth, no consent flag. Not because the lender's contract
 * rejects them — it does — but because the authorization to pull a consumer
 * report has to be the customer's own, captured on the lender's page under
 * their disclosures. Anexa never handles that data, and staying out of it
 * keeps this system out of scope for it.
 */

/** The subset of a Lead this mapping reads. */
export type AmosLeadInput = {
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

type EquipmentRef = {
  manufacturer: string | null
  model: string
  /**
   * Nameplate watts, where the catalogue carries it. Read for ONE thing: how
   * many of this inverter it takes to carry the array — see `inverterCount`.
   */
  ratingW?: number | null
  /**
   * What the DEAL'S LENDER calls this same item on its own approved-vendor
   * list, from `SolarEquipmentLender`. Null where nobody has mapped it.
   *
   * Resolved by the caller, not looked up here, because this module is pure —
   * and because which translation applies is a fact about the deal's lender
   * rather than about the catalogue item.
   */
  lenderBrand?: string | null
  lenderModel?: string | null
} | null

/** The subset of a SolarDesign this mapping reads. */
export type AmosDesignInput = {
  id: string
  systemSizeKwDc: number
  year1ProductionKwh: number
  annualUsageKwh: number | null
  moduleQty: number
  batteryQty: number
  module: EquipmentRef
  inverter: EquipmentRef
  battery: EquipmentRef
}

export type AmosSubmitOptions = {
  productSlug: string
  /**
   * The reference this application is filed under, and the thing the lender is
   * idempotent on. Passed in rather than read off the design so a deal whose
   * reference the LENDER has broken can be given a fresh one — see
   * `SolarDesign.lenderSubmissionAttempt`.
   */
  externalId: string
  amountCents: number
  termMonths: number
  salesRepName: string
  /** The rep's answer. Anexa does not store this, so it is asked at send time. */
  ownerOccupied: boolean
  /**
   * Whether the response ALSO carries the completion link.
   *
   * BOTH VALUES EMAIL THE CUSTOMER. The lender's invitation always emails, and
   * texts too when a phone number is on file — there is no per-channel switch
   * and no way to suppress delivery. `in_person` only adds the link to the
   * response so a rep can hand over their own device.
   *
   * This matters for testing: there is no such thing as a silent submission.
   * A smoke test reaches whoever is on the lead, so put your own email AND
   * your own phone on it first.
   */
  delivery?: 'in_person' | 'customer'
}

type EquipmentLine = {
  kind: 'panel' | 'inverter' | 'battery'
  brand: string
  model: string
  quantity: number
}

export type AmosApplicationPayload = {
  externalId: string
  productSlug: string
  applicant: { firstName: string; lastName: string; email: string; phone: string }
  property: {
    line1: string
    city: string
    state: string
    postalCode: string
    ownerOccupied: boolean
  }
  system?: { annualProductionKwh?: number; annualConsumptionKwh?: number }
  equipment?: EquipmentLine[]
  requestedAmount: string
  termMonths: number
  salesRepName: string
  delivery: 'in_person' | 'customer'
}

/**
 * Everything that would make a submission fail, listed at once.
 *
 * Reported before the rep clicks rather than after, because the alternative is
 * an error message in front of a customer. Each string is written to be shown
 * to a rep verbatim.
 */
export function preflightAmosSubmission(
  lead: AmosLeadInput,
  design: AmosDesignInput,
  /** Named in the mapping problems, which send somebody to this partner's screen. */
  lenderName = 'This lender',
): string[] {
  const problems: string[] = []

  if (!lead.email?.trim()) problems.push('The customer has no email address on file.')
  if (!lead.phone?.trim()) problems.push('The customer has no phone number on file.')
  if (!lead.address?.trim()) problems.push('The property has no street address.')
  if (!lead.city?.trim()) problems.push('The property has no city.')
  if (!lead.state?.trim()) problems.push('The property has no state.')
  if (!lead.zip?.trim()) problems.push('The property has no ZIP code.')

  if (!design.module) {
    problems.push('The design has no panel selected.')
  } else {
    if (!design.module.manufacturer?.trim()) {
      problems.push('The selected panel has no manufacturer — the lender matches on brand and model.')
    }
    if (design.moduleQty < 1) problems.push('The design has no panel quantity.')
  }

  if (!design.inverter) {
    problems.push('The design has no inverter selected.')
  } else if (!design.inverter.manufacturer?.trim()) {
    problems.push('The selected inverter has no manufacturer — the lender matches on brand and model.')
  }

  if (design.batteryQty > 0 && design.battery && !design.battery.manufacturer?.trim()) {
    problems.push('The selected battery has no manufacturer — the lender matches on brand and model.')
  }

  /**
   * THE ITEM IS ON OUR CATALOGUE AND NOT ON THEIRS, OR IS ON BOTH UNDER TWO
   * NAMES. Either way the lender answers 422 `unknown_equipment` and the deal
   * bounces — so it is caught here, before the button is offered, rather than
   * after a homeowner has pressed it.
   *
   * Only the items that will actually be SENT are checked: a design with no
   * battery on it is not blocked by a battery nobody mapped.
   */
  for (const item of equipmentToMap(design)) {
    if (!isMapped(item.ref)) {
      problems.push(
        `${lenderName} has no name on file for the ${item.what} “${describe(item.ref)}”. ` +
          `Map it to their approved-vendor list in Settings → Lenders → ${lenderName} → Equipment.`,
      )
    }
  }

  return problems
}

/** The pieces of a design that become equipment lines, where they exist. */
function equipmentToMap(design: AmosDesignInput): { what: string; ref: NonNullable<EquipmentRef> }[] {
  const out: { what: string; ref: NonNullable<EquipmentRef> }[] = []
  if (design.module?.manufacturer?.trim() && design.moduleQty > 0) {
    out.push({ what: 'panel', ref: design.module })
  }
  if (design.inverter?.manufacturer?.trim() && design.moduleQty > 0) {
    out.push({ what: 'inverter', ref: design.inverter })
  }
  if (design.battery?.manufacturer?.trim() && design.batteryQty > 0) {
    out.push({ what: 'battery', ref: design.battery })
  }
  return out
}

/** Both halves or neither — see `submittedName`. */
function isMapped(ref: NonNullable<EquipmentRef>): boolean {
  return !!ref.lenderBrand?.trim() && !!ref.lenderModel?.trim()
}

/** Our own name for an item, as it reads in a sentence to a rep. */
function describe(ref: NonNullable<EquipmentRef>): string {
  return [ref.manufacturer, ref.model].filter(Boolean).join(' ').trim() || ref.model
}

/**
 * How many of this inverter the array needs.
 *
 * Anexa stores no inverter count, and this used to send the PANEL count on the
 * reasoning that a microinverter system has one per panel and a string design
 * "is corrected by the lender's own review". It is not corrected: a real
 * submission went out claiming 29 Tesla PV Standalone Inverters — a 220 kW
 * bill of materials on a 12.76 kW roof — for a system that has one or two.
 *
 * Nameplate answers it without a new column. A 366 W microinverter cannot
 * carry a 12.76 kW array, so the arithmetic asks for 35 and the clamp brings
 * it back to the 29 panels there are; a 7.6 kW string inverter asks for 2 and
 * gets 2. The clamp is the part that makes this safe in both directions —
 * there can never be more inverters than panels on a microinverter design.
 *
 * With no wattage on the catalogue row there is nothing to reason from, so it
 * falls back to the panel count exactly as before. That is a guess, and it is
 * the guess this system has always made; filling the rated watts in on the
 * equipment item is what turns it into an answer.
 */
function inverterCount(design: AmosDesignInput): number {
  const rated = design.inverter?.ratingW
  if (!rated || rated <= 0) return design.moduleQty
  const arrayWatts = design.systemSizeKwDc * 1000
  if (arrayWatts <= 0) return 1
  return Math.min(design.moduleQty, Math.max(1, Math.ceil(arrayWatts / rated)))
}

/** Integer cents -> a decimal string. Money never crosses the wire as a float. */
function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
  return `${whole}.${String(rest).padStart(2, '0')}`
}

/**
 * The name to send for one item: the partner's own, where somebody has written
 * it down, and ours otherwise.
 *
 * Both halves move together on purpose. A row that pairs their brand with our
 * model — or the reverse — is not a name either catalogue contains, so a
 * half-filled mapping is treated as no mapping at all rather than as an
 * improvement on ours.
 */
function submittedName(ref: NonNullable<EquipmentRef>): { brand: string; model: string } {
  const brand = ref.lenderBrand?.trim()
  const model = ref.lenderModel?.trim()
  if (brand && model) return { brand, model }
  return { brand: (ref.manufacturer ?? '').trim(), model: ref.model.trim() }
}

function line(
  kind: EquipmentLine['kind'],
  ref: EquipmentRef,
  quantity: number,
): EquipmentLine | null {
  if (!ref || !ref.manufacturer?.trim() || quantity < 1) return null
  return { kind, ...submittedName(ref), quantity }
}

/**
 * Build the request body.
 *
 * Call `preflightAmosSubmission` first — this function assumes the deal is
 * complete and coerces what it is given rather than validating again.
 */
export function buildAmosPayload(
  lead: AmosLeadInput,
  design: AmosDesignInput,
  opts: AmosSubmitOptions,
): AmosApplicationPayload {
  const equipment = [
    line('panel', design.module, design.moduleQty),
    line('inverter', design.inverter, inverterCount(design)),
    line('battery', design.battery, design.batteryQty),
  ].filter((l): l is EquipmentLine => l !== null)

  const system: AmosApplicationPayload['system'] = {}
  if (design.year1ProductionKwh > 0) system.annualProductionKwh = design.year1ProductionKwh
  if (design.annualUsageKwh && design.annualUsageKwh > 0) {
    system.annualConsumptionKwh = design.annualUsageKwh
  }

  return {
    // Re-sending the same reference returns the same application instead of
    // creating a second one. Normally the design id; see `externalId`.
    externalId: opts.externalId,
    productSlug: opts.productSlug,
    applicant: {
      firstName: lead.firstName.trim(),
      lastName: lead.lastName.trim(),
      email: (lead.email ?? '').trim().toLowerCase(),
      phone: (lead.phone ?? '').replace(/[\s()\-.]/g, ''),
    },
    property: {
      line1: (lead.address ?? '').trim(),
      city: (lead.city ?? '').trim(),
      state: (lead.state ?? '').trim().toUpperCase(),
      postalCode: (lead.zip ?? '').trim(),
      ownerOccupied: opts.ownerOccupied,
    },
    // System size is deliberately absent: the lender derives DC nameplate from
    // panel wattage x count for any deal carrying a panel and ignores a
    // submitted figure. Sending ours would imply it is authoritative.
    ...(Object.keys(system).length > 0 ? { system } : {}),
    ...(equipment.length > 0 ? { equipment } : {}),
    requestedAmount: centsToDecimalString(opts.amountCents),
    termMonths: opts.termMonths,
    salesRepName: opts.salesRepName.trim(),
    delivery: opts.delivery ?? 'in_person',
  }
}
