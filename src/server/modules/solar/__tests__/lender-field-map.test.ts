import { describe, expect, it } from 'vitest'
import {
  applyFieldMap,
  FIELD_SOURCES,
  mappingProblems,
  parseLiteral,
  suppliedByMapping,
  STATED_FIELDS,
  WIRE_FIELDS,
  wireInventory,
  type FieldMapContext,
  type FieldMapEntry,
} from '../lender-field-map'
import { buildAmosPayload, type AmosApplicationPayload } from '../amos-payload'

const CTX: FieldMapContext = {
  lead: {
    firstName: 'Dana',
    lastName: 'Reyes',
    email: 'Dana@Example.com ',
    phone: '(512) 555-0143',
    address: '4120 Sage Hollow Dr',
    city: 'Austin',
    state: 'tx',
    zip: '78735',
  },
  repName: 'Marco Diaz',
  submitterName: 'Priya Shah',
  companyName: 'Anexa Homes',
  design: {
    id: 'design-abc',
    reference: 'design-abc-1',
    systemSizeKwDc: 10.66,
    moduleQty: 26,
    inverterQty: 2,
    batteryQty: 0,
  },
  productSlug: 'solar-installation-financing',
  ownerOccupied: true,
  utilityProvider: 'Oncor Electric Delivery',
  electricProvider: 'Reliant Energy',
  system: { annualProductionKwh: 14200, annualConsumptionKwh: 15800, retailRateMillsPerKwh: 233 },
  termMonths: 360,
}

/** What `buildAmosPayload` produces for that deal, before any mapping. */
const BASE: AmosApplicationPayload = {
  externalId: 'design-abc-1',
  productSlug: 'solar-installation-financing',
  applicant: { firstName: 'Dana', lastName: 'Reyes', email: 'dana@example.com', phone: '5125550143' },
  property: { line1: '4120 Sage Hollow Dr', city: 'Austin', state: 'TX', postalCode: '78735', ownerOccupied: true },
  system: {
    annualProductionKwh: 14200,
    annualConsumptionKwh: 15800,
    retailRatePerKwh: '0.233',
    estMonthlySaving: '301.00',
    estAnnualSaving: '3611.96',
  },
  equipment: [
    { kind: 'panel', brand: 'Qcells', model: 'Q.PEAK', quantity: 26 },
    { kind: 'inverter', brand: 'Enphase', model: 'IQ8PLUS', quantity: 2 },
  ],
  requestedAmount: '150180.00',
  termMonths: 360,
  salesRepName: 'Marco Diaz',
  delivery: 'in_person',
}

const map = (...entries: FieldMapEntry[]) => entries
const at = (wireField: string, sourceKey: string | null, literal: string | null = null) => ({
  wireField,
  sourceKey,
  literal,
})

describe('the mapping catalogue', () => {
  it('gives every mappable box a built-in source that exists', () => {
    // The default is what an unmapped partner sends. A field whose default
    // names a source nobody defined would be a silently empty box.
    const keys = new Set(FIELD_SOURCES.map((s) => s.key))
    for (const f of WIRE_FIELDS) expect(keys, f.field).toContain(f.defaultSource)
  })

  it('gives every box a built-in source of its own shape', () => {
    const byKey = new Map(FIELD_SOURCES.map((s) => [s.key, s]))
    for (const f of WIRE_FIELDS) expect(byKey.get(f.defaultSource)?.kind, f.field).toBe(f.kind)
  })

  it('offers NOTHING that could carry identity documents', () => {
    // The promise printed under the table — no social security number, no date
    // of birth, no consent flag — is kept by the whitelist and nothing else.
    const forbidden = /ssn|social|birth|dob|consent|password|licen[sc]e|passport/i
    for (const s of FIELD_SOURCES) expect(s.key + ' ' + s.label).not.toMatch(forbidden)
  })

  it('names every box exactly once', () => {
    const seen = new Set(WIRE_FIELDS.map((f) => f.field))
    expect(seen.size).toBe(WIRE_FIELDS.length)
  })
})

describe('applyFieldMap', () => {
  it('changes nothing at all when nobody has mapped anything', () => {
    expect(applyFieldMap(BASE, [], CTX)).toBe(BASE)
  })

  it('points a box at another Anexa value', () => {
    const out = applyFieldMap(BASE, map(at('applicant.firstName', 'lead.fullName')), CTX)
    expect(out.applicant.firstName).toBe('Dana Reyes')
  })

  it('sends a constant an admin typed', () => {
    const out = applyFieldMap(BASE, map(at('productSlug', null, ' dealer-direct-25 ')), CTX)
    expect(out.productSlug).toBe('dealer-direct-25')
  })

  it('prefers the constant when a row carries both', () => {
    const out = applyFieldMap(BASE, map(at('applicant.email', 'lead.email', 'apps@partner.test')), CTX)
    expect(out.applicant.email).toBe('apps@partner.test')
  })

  it('never mutates the body it was handed', () => {
    const before = JSON.parse(JSON.stringify(BASE))
    applyFieldMap(BASE, map(at('applicant.firstName', 'company.name')), CTX)
    expect(BASE).toEqual(before)
  })

  it('leaves the built-in value alone when the source is one this build lost', () => {
    // A row outlives the code that understands it. The box must keep what the
    // builder put there rather than going out empty.
    const out = applyFieldMap(BASE, map(at('applicant.email', 'lead.someFutureField')), CTX)
    expect(out.applicant.email).toBe('dana@example.com')
  })

  it('refuses a source of the wrong shape rather than coercing it', () => {
    // A number in a name box is how "26" ends up on a credit application.
    const out = applyFieldMap(BASE, map(at('applicant.lastName', 'system.panelCount')), CTX)
    expect(out.applicant.lastName).toBe('Reyes')
  })

  it('ignores a box this build no longer has', () => {
    expect(() => applyFieldMap(BASE, map(at('applicant.middleName', 'lead.firstName')), CTX)).not.toThrow()
  })

  it('leaves the built-in value alone when the mapped source is empty on THIS deal', () => {
    const out = applyFieldMap(BASE, map(at('applicant.phone', 'people.submitter')), {
      ...CTX,
      submitterName: '   ',
    })
    expect(out.applicant.phone).toBe('5125550143')
  })

  it('rounds a number rather than sending a fraction', () => {
    const out = applyFieldMap(BASE, map(at('termMonths', null, '299.6')), CTX)
    expect(out.termMonths).toBe(300)
  })

  it('reads yes and no for a flag, and nothing else', () => {
    expect(applyFieldMap(BASE, map(at('property.ownerOccupied', null, 'no')), CTX).property.ownerOccupied).toBe(false)
    // Unreadable: the answer the rep actually gave stands.
    expect(applyFieldMap(BASE, map(at('property.ownerOccupied', null, 'maybe')), CTX).property.ownerOccupied).toBe(true)
  })

  it('keeps the rate to one conversion, in dollars, three decimals', () => {
    const out = applyFieldMap(BASE, map(at('system.retailRatePerKwh', null, '$0.1875')), CTX)
    expect(out.system.retailRatePerKwh).toBe('0.188')
  })

  it('refuses a rate off by a factor of a hundred in either direction', () => {
    // "23.3" for $0.233, and "0.00233". Both are typos, and both are the shape
    // of a lender underwriting a wildly wrong bill.
    expect(applyFieldMap(BASE, map(at('system.retailRatePerKwh', null, '23.3')), CTX).system.retailRatePerKwh).toBe('0.233')
    expect(applyFieldMap(BASE, map(at('system.retailRatePerKwh', null, '0.00233')), CTX).system.retailRatePerKwh).toBe('0.233')
  })

  it('sets a quantity on a line that is actually being sent', () => {
    const out = applyFieldMap(BASE, map(at('equipment.inverter.quantity', null, '1')), CTX)
    expect(out.equipment?.find((l) => l.kind === 'inverter')?.quantity).toBe(1)
  })

  it('never invents a line for hardware the deal does not have', () => {
    // The partner matches every line against its approved-vendor list, so a
    // battery quantity with no battery on the design is a 422 waiting to happen.
    const out = applyFieldMap(BASE, map(at('equipment.battery.quantity', null, '2')), CTX)
    expect(out.equipment?.some((l) => l.kind === 'battery')).toBe(false)
  })

  it('drops a line mapped to nothing rather than sending a zero', () => {
    const out = applyFieldMap(BASE, map(at('equipment.inverter.quantity', null, '0')), CTX)
    expect(out.equipment?.some((l) => l.kind === 'inverter')).toBe(false)
    expect(out.equipment?.some((l) => l.kind === 'panel')).toBe(true)
  })

  it('applies several at once', () => {
    const out = applyFieldMap(
      BASE,
      map(
        at('applicant.firstName', 'lead.fullName'),
        at('property.line1', 'property.oneLine'),
        at('externalId', null, 'ANEXA-0042'),
      ),
      CTX,
    )
    expect(out.applicant.firstName).toBe('Dana Reyes')
    expect(out.property.line1).toBe('4120 Sage Hollow Dr, Austin, TX 78735')
    expect(out.externalId).toBe('ANEXA-0042')
  })

  it('cannot reach the loan amount or the saving, whatever it is told', () => {
    // Those are the amount-basis and saving-basis settings, which choose between
    // figures the DOCUMENT computed. A typed constant here would be a fabricated
    // credit application on every deal.
    const out = applyFieldMap(
      BASE,
      map(at('requestedAmount', null, '1.00'), at('system.estAnnualSaving', null, '99999.00')),
      CTX,
    )
    expect(out.requestedAmount).toBe('150180.00')
    expect(out.system.estAnnualSaving).toBe('3611.96')
  })
})

describe('suppliedByMapping', () => {
  it('stops the deal being blocked over a value the partner is no longer told', () => {
    const supplied = suppliedByMapping(map(at('applicant.email', null, 'apps@partner.test')), CTX)
    expect(supplied.has('email')).toBe(true)
  })

  it('keeps the original blocker when the override resolves to nothing', () => {
    // Otherwise a mapping that silently does nothing would ALSO silently
    // disable the check that would have caught the empty box.
    const supplied = suppliedByMapping(map(at('applicant.email', 'people.submitter')), {
      ...CTX,
      submitterName: null,
    })
    expect(supplied.has('email')).toBe(false)
  })

  it('says nothing about boxes the deal never checked', () => {
    expect(suppliedByMapping(map(at('externalId', null, 'X-1')), CTX).size).toBe(0)
  })
})

describe('mappingProblems', () => {
  it('names a constant nobody can read, on a required box', () => {
    const problems = mappingProblems(map(at('termMonths', null, 'three hundred')), CTX)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('termMonths')
    expect(problems[0]).toContain('a number')
  })

  it('explains a rate in the units the box takes', () => {
    expect(mappingProblems(map(at('system.retailRatePerKwh', null, '23.3')), CTX)[0]).toContain('$0.01 and $2.00')
  })

  it('is silent about a mapping that reads fine', () => {
    expect(mappingProblems(map(at('termMonths', null, '300')), CTX)).toEqual([])
  })

  it('is silent about an empty constant, which is just "not mapped"', () => {
    expect(mappingProblems(map(at('termMonths', null, '   ')), CTX)).toEqual([])
  })
})

describe('parseLiteral', () => {
  it('reads nothing out of an empty box rather than a zero', () => {
    // Zero is a value somebody meant. A blank is not.
    expect(parseLiteral('', 'number')).toBeNull()
    expect(parseLiteral('   ', 'string')).toBeNull()
    expect(parseLiteral('0', 'number')).toBe(0)
  })

  it('strips the thousands separators a person types', () => {
    expect(parseLiteral('14,200', 'number')).toBe(14200)
  })
})

/**
 * THE SCREEN MUST NAME EVERY FIELD THE WIRE CARRIES.
 *
 * The Submission tab listed only the mappable boxes and titled itself the
 * application, so eleven fields — the panel and inverter brands, the loan
 * amount, both savings, the seller, the delivery — were invisible on it. An
 * admin reading that table could not tell "we don't send this" from "you can't
 * change it here", which is the difference the whole tab exists to publish.
 *
 * Asserted against a payload BUILT BY `buildAmosPayload`, never a fixture, so
 * adding a field to the body and forgetting the screen fails here.
 */
describe('wireInventory', () => {
  // MAXIMAL on purpose. Every optional field is populated, because the point of
  // the assertion is that the screen names the fullest body we can produce —
  // a fixture that omits them would let an unlisted optional field pass.
  const LEAD = {
    firstName: 'Dana',
    lastName: 'Reyes',
    email: 'dana@example.com',
    phone: '5125550143',
    address: '4120 Sage Hollow Dr',
    city: 'Austin',
    state: 'TX',
    zip: '78735',
    preferredLanguage: 'Spanish',
  }

  // Every equipment kind present, so all three brand/model pairs reach the wire.
  const DESIGN = {
    id: 'design-abc',
    systemSizeKwDc: 10.66,
    moduleQty: 26,
    batteryQty: 2,
    module: { manufacturer: 'Qcells', model: 'Q.PEAK' },
    inverter: { manufacturer: 'Enphase', model: 'IQ8PLUS', ratingW: 7600 },
    battery: { manufacturer: 'Tesla', model: 'Powerwall 3' },
  }

  const OPTS = {
    productSlug: 'solar-installation-financing',
    externalId: 'design-abc-1',
    amountCents: 15018000,
    termMonths: 360,
    salesRepName: 'Marco Diaz',
    ownerOccupied: true,
    utilityProvider: 'Oncor Electric Delivery',
    system: {
      annualProductionKwh: 14200,
      annualConsumptionKwh: 15800,
      retailRateMillsPerKwh: 233,
      annualUtilityAvoidedCents: 361196,
      utilityEscalationPct: 3.5,
    },
  }

  /**
   * Leaf paths of a payload, spelled the way the screen spells them.
   *
   * `equipment` is an array on the wire and three named rows on the screen, so
   * each line is read back through its own `kind`. That `kind` is the line's
   * label rather than a value anybody sets, and is the one leaf with no row.
   */
  function wirePaths(value: unknown, prefix = ''): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => {
        const kind = (item as { kind?: string }).kind ?? 'unknown'
        return wirePaths(item, `${prefix}.${kind}`)
      })
    }
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) =>
        wirePaths(v, prefix ? `${prefix}.${k}` : k),
      )
    }
    return [prefix]
  }

  it('names every field a real submission puts on the wire', () => {
    const payload = buildAmosPayload(LEAD, DESIGN, OPTS)
    const named = new Set(wireInventory().map((r) => r.field))

    const unnamed = wirePaths(payload)
      .filter((p) => !p.endsWith('.kind'))
      .filter((p) => !named.has(p))

    expect(unnamed).toEqual([])
  })

  it('lists every field exactly once, box or no box', () => {
    const rows = wireInventory()
    const seen = rows.map((r) => r.field)

    expect(new Set(seen).size).toBe(seen.length)
    for (const f of WIRE_FIELDS) expect(seen).toContain(f.field)
    for (const f of STATED_FIELDS) expect(seen).toContain(f.field)
    expect(rows).toHaveLength(WIRE_FIELDS.length + STATED_FIELDS.length)
  })

  it('gives a box to the mappable rows and none to the stated ones', () => {
    for (const row of wireInventory()) {
      // Exactly one side, so the table can never render a picker for a figure
      // the settings above decide — nor drop a row for want of one.
      expect(!!row.mapped).toBe(!row.stated)
    }
  })

  it('lets the amount choose its own basis, on the row that names it', () => {
    // It had a panel of its own at the top of the tab and answered "SET ABOVE"
    // here, which is a direction rather than an answer. The chooser is in the
    // row now — and it is still NOT a mapping, because a typed constant on a
    // credit application's amount is a fabricated one on every deal.
    const row = wireInventory().find((r) => r.field === 'requestedAmount')

    expect(row?.mapped).toBeUndefined()
    expect(row?.stated?.control).toBe('amount-basis')
  })

  it('never badges a row as “set above” when the row itself decides it', () => {
    // The badge points at a panel by name. A row carrying both would send a
    // reader up the tab looking for a heading that is not there any more.
    for (const f of STATED_FIELDS) {
      if (f.control) expect(f.setting).toBeUndefined()
    }
  })
})
