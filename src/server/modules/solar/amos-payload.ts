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

  return problems
}

/** Integer cents -> a decimal string. Money never crosses the wire as a float. */
function centsToDecimalString(cents: number): string {
  const whole = Math.trunc(cents / 100)
  const rest = Math.abs(cents % 100)
  return `${whole}.${String(rest).padStart(2, '0')}`
}

function line(
  kind: EquipmentLine['kind'],
  ref: EquipmentRef,
  quantity: number,
): EquipmentLine | null {
  if (!ref || !ref.manufacturer?.trim() || quantity < 1) return null
  return { kind, brand: ref.manufacturer.trim(), model: ref.model.trim(), quantity }
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
    // Anexa does not track an inverter count separately. For a microinverter
    // system the count IS the panel count, which is the overwhelmingly common
    // case here; a string-inverter design is corrected by the lender's own
    // review. Sending 1 would understate a real microinverter bill of
    // materials, which is the worse error of the two.
    line('inverter', design.inverter, design.moduleQty),
    line('battery', design.battery, design.batteryQty),
  ].filter((l): l is EquipmentLine => l !== null)

  const system: AmosApplicationPayload['system'] = {}
  if (design.year1ProductionKwh > 0) system.annualProductionKwh = design.year1ProductionKwh
  if (design.annualUsageKwh && design.annualUsageKwh > 0) {
    system.annualConsumptionKwh = design.annualUsageKwh
  }

  return {
    // The design id. Re-sending the same design returns the same application
    // instead of creating a second one.
    externalId: design.id,
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
