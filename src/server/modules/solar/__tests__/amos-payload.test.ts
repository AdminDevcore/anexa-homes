import { describe, expect, it } from 'vitest'
import { buildAmosPayload, preflightAmosSubmission, savingsProblems } from '../amos-payload'

const lead = {
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'Dana.Reyes@Example.com ',
  phone: '(512) 555-0143',
  address: '4120 Sage Hollow Dr',
  city: 'Austin',
  state: 'tx',
  zip: '78735',
}

const design = {
  id: 'design-abc',
  systemSizeKwDc: 10.66,
  moduleQty: 26,
  batteryQty: 2,
  // Mapped to the partner's own approved-vendor list, which is what a
  // submittable deal looks like: ours names the SKU with its wattage, theirs
  // names the product family. See SolarEquipmentLender.lenderModel.
  module: {
    kind: 'module',
    manufacturer: 'Qcells',
    model: 'Q.PEAK DUO BLK ML-G10+ 410',
    lenderBrand: 'Qcells',
    lenderModel: 'Q.PEAK DUO BLK ML-G10+',
  },
  inverter: {
    kind: 'inverter',
    manufacturer: 'Enphase',
    model: 'IQ8PLUS-72-2-US',
    lenderBrand: 'Enphase',
    lenderModel: 'IQ8PLUS-72-M-US',
  },
  battery: {
    kind: 'battery',
    manufacturer: 'Enphase',
    model: 'IQ Battery 5P',
    lenderBrand: 'Enphase',
    lenderModel: 'IQ Battery 5P',
  },
}

/** The same design before anybody said what the partner calls its hardware. */
const unmapped = {
  ...design,
  module: { kind: 'module', manufacturer: 'Qcells', model: 'Q.PEAK DUO BLK ML-G10+ 410' },
  inverter: { kind: 'inverter', manufacturer: 'Enphase', model: 'IQ8PLUS-72-2-US' },
  battery: { kind: 'battery', manufacturer: 'Enphase', model: 'IQ Battery 5P' },
}

/**
 * The savings analysis, as a generated proposal freezes it. Every one of these
 * is required by the lender: see AmosSystemFigures.
 */
const figures = {
  annualProductionKwh: 14200,
  annualConsumptionKwh: 15800,
  /** Tenths of a cent per kWh: $0.233. */
  retailRateMillsPerKwh: 233,
  annualUtilityAvoidedCents: 361196,
}

const opts = {
  productSlug: 'solar-installation-financing',
  // Normally the design id; passed in so a deal whose reference the LENDER
  // broke can be given a fresh one. See lenderReference.
  externalId: 'design-abc',
  amountCents: 4875000,
  termMonths: 300,
  salesRepName: 'Marco Diaz',
  ownerOccupied: true,
  system: figures,
}

describe('preflightAmosSubmission', () => {
  it('passes on a complete lead and design', () => {
    expect(preflightAmosSubmission(lead, design)).toEqual([])
  })

  it('names every missing customer field at once', () => {
    const problems = preflightAmosSubmission(
      { ...lead, email: null, phone: null, zip: null },
      design,
    )
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toContain('email')
    expect(problems.join(' ')).toContain('phone')
    expect(problems.join(' ')).toContain('ZIP')
  })

  it('requires a panel and an inverter — the lender derives system size from them', () => {
    const problems = preflightAmosSubmission(lead, { ...design, module: null, inverter: null })
    expect(problems.join(' ')).toContain('panel')
    expect(problems.join(' ')).toContain('inverter')
  })

  it('requires a panel quantity, not just a panel', () => {
    expect(preflightAmosSubmission(lead, { ...design, moduleQty: 0 }).join(' ')).toContain(
      'panel quantity',
    )
  })

  it('requires a manufacturer — the lender matches on brand AND model', () => {
    const problems = preflightAmosSubmission(lead, {
      ...design,
      module: { ...design.module, manufacturer: null },
    })
    expect(problems.join(' ')).toContain('manufacturer')
  })

  /**
   * THE 422. Our catalogue's name is not on their approved-vendor list, so the
   * lender refuses the whole application with `unknown_equipment`. Caught here
   * means the rep is told on the deal; missed means a homeowner presses Qualify
   * and is bounced.
   */
  it('blocks an item this partner has no name for, and says which item', () => {
    const problems = preflightAmosSubmission(lead, unmapped, 'Amos Capital Fund')
    expect(problems).toHaveLength(3)
    expect(problems.join(' ')).toContain('Qcells Q.PEAK DUO BLK ML-G10+ 410')
    expect(problems.join(' ')).toContain('Amos Capital Fund')
    expect(problems.join(' ')).toContain('Settings')
  })

  it('only asks about equipment the submission will actually send', () => {
    // No battery on the deal, so the battery nobody mapped is not its problem.
    const problems = preflightAmosSubmission(
      lead,
      { ...unmapped, batteryQty: 0, module: design.module, inverter: design.inverter },
      'Amos Capital Fund',
    )
    expect(problems).toEqual([])
  })

  it('treats half a mapping as no mapping', () => {
    const problems = preflightAmosSubmission(
      lead,
      { ...design, module: { ...design.module, lenderModel: null } },
      'Amos Capital Fund',
    )
    // Their brand with our model is a name neither catalogue contains.
    expect(problems.join(' ')).toContain('Q.PEAK DUO BLK ML-G10+ 410')
  })
})

/**
 * THE FAILURE THAT SHIPPED.
 *
 * Amos's lending service required five savings figures on a solar deal. Their
 * partner intake shipped three weeks later with a strict schema containing no
 * fields for three of them, so sending them was a 422 and omitting them was a
 * 500: no payload could succeed, and no solar deal was creatable through the
 * API from the day it opened. Two homeowners sat through it.
 *
 * These pin our half — that the figures are resolved, that they are checked
 * against the lender's own floor BEFORE a customer can press anything, and that
 * a deal which cannot produce them is refused in words a rep can act on.
 */
describe('savingsProblems', () => {
  it('passes a proposal that quotes all five figures', () => {
    expect(savingsProblems(figures)).toEqual([])
  })

  it('refuses a deal with no generated proposal, and says to generate one', () => {
    const problems = savingsProblems(null)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('Generate one first')
  })

  it('names the missing production, usage and rate separately', () => {
    expect(savingsProblems({ ...figures, annualProductionKwh: 0 }).join(' ')).toContain(
      'no annual production',
    )
    expect(savingsProblems({ ...figures, annualConsumptionKwh: 0 }).join(' ')).toContain(
      'no annual usage',
    )
    expect(savingsProblems({ ...figures, retailRateMillsPerKwh: 0 }).join(' ')).toContain(
      'no utility rate',
    )
  })

  /**
   * Their schema has no minus sign in its amount pattern, so a negative saving
   * is not a rejected value — it is an unrepresentable one. Catching it here
   * turns a 422 in front of a homeowner into a sentence on a rep's screen.
   */
  it('refuses a deal whose bill does not go down', () => {
    expect(savingsProblems({ ...figures, annualUtilityAvoidedCents: -1 })).toHaveLength(1)
    expect(savingsProblems({ ...figures, annualUtilityAvoidedCents: 0 })).toHaveLength(1)
  })

  it('refuses a year that clears a dollar but whose months do not', () => {
    // $11.88 a year is 99c a month, and the lender's floor is a dollar on both.
    expect(savingsProblems({ ...figures, annualUtilityAvoidedCents: 1188 })).toHaveLength(1)
    expect(savingsProblems({ ...figures, annualUtilityAvoidedCents: 1200 })).toEqual([])
  })
})

describe('buildAmosPayload', () => {
  it('maps a complete deal onto the partner contract', () => {
    const p = buildAmosPayload(lead, design, opts)
    expect(p.externalId).toBe('design-abc')
    expect(p.productSlug).toBe('solar-installation-financing')
    expect(p.applicant).toEqual({
      firstName: 'Dana',
      lastName: 'Reyes',
      email: 'dana.reyes@example.com',
      phone: '5125550143',
    })
    expect(p.property).toEqual({
      line1: '4120 Sage Hollow Dr',
      city: 'Austin',
      state: 'TX',
      postalCode: '78735',
      ownerOccupied: true,
    })
    expect(p.termMonths).toBe(300)
    expect(p.salesRepName).toBe('Marco Diaz')
  })

  it('sends money as a decimal STRING, never a float', () => {
    const p = buildAmosPayload(lead, design, opts)
    expect(p.requestedAmount).toBe('48750.00')
    expect(typeof p.requestedAmount).toBe('string')
  })

  it('renders a whole-dollar amount with two decimals', () => {
    expect(buildAmosPayload(lead, design, { ...opts, amountCents: 5000000 }).requestedAmount).toBe(
      '50000.00',
    )
  })

  it('renders cents that would round badly as a float', () => {
    expect(buildAmosPayload(lead, design, { ...opts, amountCents: 4875005 }).requestedAmount).toBe(
      '48750.05',
    )
  })

  it('sends one equipment line per slot with its quantity, in the PARTNER\'s words', () => {
    const p = buildAmosPayload(lead, design, opts)
    expect(p.equipment).toEqual([
      // Their name for the family, not our SKU with its wattage on the end.
      { kind: 'panel', brand: 'Qcells', model: 'Q.PEAK DUO BLK ML-G10+', quantity: 26 },
      { kind: 'inverter', brand: 'Enphase', model: 'IQ8PLUS-72-M-US', quantity: 26 },
      { kind: 'battery', brand: 'Enphase', model: 'IQ Battery 5P', quantity: 2 },
    ])
  })

  /**
   * The fallback that makes the migration safe: a partner nobody has mapped
   * anything for submits exactly what it submitted before the column existed.
   * Whether that is ACCEPTED is the preflight's business, not this function's.
   */
  it('falls back to our own catalogue name where the partner has none', () => {
    const p = buildAmosPayload(lead, unmapped, opts)
    expect(p.equipment?.[0]).toEqual({
      kind: 'panel',
      brand: 'Qcells',
      model: 'Q.PEAK DUO BLK ML-G10+ 410',
      quantity: 26,
    })
  })

  it('does not mix their brand with our model when only half is mapped', () => {
    const p = buildAmosPayload(
      lead,
      { ...design, module: { ...design.module, lenderModel: null } },
      opts,
    )
    expect(p.equipment?.[0]).toEqual({
      kind: 'panel',
      brand: 'Qcells',
      model: 'Q.PEAK DUO BLK ML-G10+ 410',
      quantity: 26,
    })
  })

  /**
   * THE BILL OF MATERIALS HAS TO BE PHYSICAL.
   *
   * A real submission went out claiming 29 Tesla PV Standalone Inverters — a
   * 220 kW bill of materials on a 12.76 kW roof — because the panel count was
   * sent for the inverter too.
   */
  it('sends one string inverter per slice of the array it can carry', () => {
    const p = buildAmosPayload(
      lead,
      {
        ...design,
        systemSizeKwDc: 12.76,
        moduleQty: 29,
        inverter: { ...design.inverter, ratingW: 7600 },
      },
      opts,
    )
    // 12,760 W over a 7.6 kW inverter is two of them, not twenty-nine.
    expect(p.equipment?.find((e) => e.kind === 'inverter')?.quantity).toBe(2)
  })

  it('still sends one microinverter per panel, never more', () => {
    const p = buildAmosPayload(
      lead,
      {
        ...design,
        systemSizeKwDc: 12.76,
        moduleQty: 29,
        inverter: { ...design.inverter, ratingW: 366 },
      },
      opts,
    )
    // The arithmetic asks for 35; there are only 29 panels to put them on.
    expect(p.equipment?.find((e) => e.kind === 'inverter')?.quantity).toBe(29)
  })

  it('falls back to the panel count when the catalogue carries no wattage', () => {
    const p = buildAmosPayload(
      lead,
      { ...design, systemSizeKwDc: 12.76, moduleQty: 29, inverter: { ...design.inverter, ratingW: null } },
      opts,
    )
    expect(p.equipment?.find((e) => e.kind === 'inverter')?.quantity).toBe(29)
  })

  it('omits a battery line when the design has none', () => {
    const p = buildAmosPayload(lead, design, { ...opts, ...{} })
    const noBattery = buildAmosPayload(lead, { ...design, battery: null, batteryQty: 0 }, opts)
    expect(p.equipment).toHaveLength(3)
    expect(noBattery.equipment).toHaveLength(2)
  })

  it('omits a battery line when the quantity is zero even if one is selected', () => {
    const p = buildAmosPayload(lead, { ...design, batteryQty: 0 }, opts)
    expect(p.equipment?.some((e) => e.kind === 'battery')).toBe(false)
  })

  it('carries the whole savings analysis but NOT system size', () => {
    // The lender derives DC nameplate from panel wattage x count and ignores a
    // submitted sizeKw for any deal with a panel. Sending ours would imply it
    // is authoritative when it is not.
    //
    // The other five it demands, and refuses the application by name without.
    const p = buildAmosPayload(lead, design, opts)
    expect(p.system).toEqual({
      annualProductionKwh: 14200,
      annualConsumptionKwh: 15800,
      retailRatePerKwh: '0.233',
      estMonthlySaving: '301.00',
      estAnnualSaving: '3611.96',
    })
    expect(p).not.toHaveProperty('sizeKw')
  })

  it('sends the rate in DOLLARS per kWh, from a figure stored in tenths of a cent', () => {
    // 233 mills is $0.233. A rate that crossed the wire as "23.3" would be a
    // hundredfold overstatement of what the household pays for power.
    expect(buildAmosPayload(lead, design, opts).system.retailRatePerKwh).toBe('0.233')
    expect(
      buildAmosPayload(lead, design, {
        ...opts,
        system: { ...figures, retailRateMillsPerKwh: 148 },
      }).system.retailRatePerKwh,
    ).toBe('0.148')
  })

  it('sends both savings figures as decimal STRINGS, never floats', () => {
    const sys = buildAmosPayload(lead, design, opts).system
    expect(typeof sys.estMonthlySaving).toBe('string')
    expect(typeof sys.estAnnualSaving).toBe('string')
  })

  it('divides the month out of the year exactly once', () => {
    // Both amounts are the same fact told twice. Rounding them independently
    // would put a year on the wire that its own months do not add up to.
    const sys = buildAmosPayload(lead, design, {
      ...opts,
      system: { ...figures, annualUtilityAvoidedCents: 100_000 },
    }).system
    expect(sys.estAnnualSaving).toBe('1000.00')
    expect(sys.estMonthlySaving).toBe('83.33')
  })

  it('NEVER includes identity or consent, whatever it is handed', () => {
    const p = buildAmosPayload({ ...lead, ssn: '123456789', dateOfBirth: '1985-04-02' } as never, design, opts)
    const serialized = JSON.stringify(p)
    expect(serialized).not.toContain('ssn')
    expect(serialized).not.toContain('dateOfBirth')
    expect(serialized).not.toContain('123456789')
    expect(serialized).not.toContain('consent')
  })

  it('passes ownerOccupied through from the rep’s answer', () => {
    expect(buildAmosPayload(lead, design, { ...opts, ownerOccupied: false }).property.ownerOccupied).toBe(
      false,
    )
  })

  it('asks for the in-person handoff so the rep gets a link back', () => {
    expect(buildAmosPayload(lead, design, opts).delivery).toBe('in_person')
  })

  it('can send to the customer instead when the rep is not present', () => {
    expect(buildAmosPayload(lead, design, { ...opts, delivery: 'customer' }).delivery).toBe(
      'customer',
    )
  })
})
