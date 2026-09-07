import { beforeEach, describe, expect, it, vi } from 'vitest'

const decryptField = vi.fn()
vi.mock('@/server/lib/crypto', () => ({
  decryptField: (...a: unknown[]) => decryptField(...a),
  encryptField: vi.fn(),
  maskTail: () => 'MASKED',
}))

const designFindFirst = vi.fn()
const financeFindFirst = vi.fn()
const proposalFindFirst = vi.fn()
const submissionCreate = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarDesign: { findFirst: (...a: unknown[]) => designFindFirst(...a) },
    solarFinance: { findFirst: (...a: unknown[]) => financeFindFirst(...a) },
    solarProposal: { findFirst: (...a: unknown[]) => proposalFindFirst(...a) },
    solarLenderSubmission: { create: (...a: unknown[]) => submissionCreate(...a) },
  },
}))

const submitToAmos = vi.fn()
const validateWithAmos = vi.fn()
vi.mock('../amos-client', async () => {
  const actual = await vi.importActual<typeof import('../amos-client')>('../amos-client')
  return {
    ...actual,
    submitToAmos: (...a: unknown[]) => submitToAmos(...a),
    validateWithAmos: (...a: unknown[]) => validateWithAmos(...a),
  }
})

const { submitDealToLender, readLenderSubmission, readLenderPayloadPreview, checkDealWithLender } =
  await import('../lender-submit')
const { AmosSubmissionError } = await import('../amos-client')

const LEAD = {
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'dana@example.com',
  phone: '5125550143',
  address: '4120 Sage Hollow Dr',
  city: 'Austin',
  state: 'TX',
  zip: '78735',
  assignedRep: { firstName: 'Marco', lastName: 'Diaz' },
}

const DESIGN = {
  id: 'design-abc',
  systemSizeKwDc: 10.66,
  year1ProductionKwh: 14200,
  annualUsageKwh: 15800,
  moduleQty: 26,
  batteryQty: 0,
  /**
   * Each item carries EVERY partner's name for it, because Prisma cannot filter
   * a nested relation on a sibling field of the parent row -- `withLenderNames`
   * picks this deal's lender out of the list. `lender-2` is here to prove it
   * picks, rather than taking the first row it finds.
   */
  module: {
    manufacturer: 'Qcells',
    model: 'Q.PEAK 410',
    lenderApprovals: [
      { lenderId: 'lender-2', lenderBrand: 'Q CELLS', lenderModel: 'SOMEBODY ELSE' },
      { lenderId: 'lender-1', lenderBrand: 'Qcells', lenderModel: 'Q.PEAK DUO BLK ML-G10+' },
    ],
  },
  inverter: {
    manufacturer: 'Enphase',
    model: 'IQ8PLUS',
    lenderApprovals: [
      { lenderId: 'lender-1', lenderBrand: 'Enphase', lenderModel: 'IQ8PLUS-72-M-US' },
    ],
  },
  battery: null,
  lender: {
    id: 'lender-1',
    name: 'Amos Capital Fund',
    apiBaseUrl: 'https://lender.test',
    apiKeyEncrypted: 'ENCRYPTED',
    apiProductSlug: 'solar-installation-financing',
    // What every lender row carries by default, and what every submission sent
    // before either was configurable.
    submissionAmountBasis: 'contract_value',
    submissionSavingBasis: 'utility_avoided',
  },
  lead: LEAD,
}

/**
 * The savings analysis a generated proposal freezes, in the snapshot's own
 * units. The lender requires all five and refuses a solar application without
 * them, so a deal that HAS no document is not a submittable deal — which is why
 * this is the default rather than the exception.
 */
const SNAPSHOT = {
  financing: { financedAmountCents: 15018000, loanTermMonths: 360 },
  system: { year1ProductionKwh: 17107 },
  energy: { annualUsageKwh: 16017 },
  assumptions: { currentRateMillsPerKwh: 233 },
  savings: {
    years: [{ year: 1, utilityCostCents: 373196, residualGridCents: 0, meterFeeCents: 12000 }],
  },
}

/**
 * The same document, generated before the financed amount was frozen onto it.
 * Its savings analysis still stands — that is a different block — so these
 * cases go on exercising the pricing-row fallback for the MONEY alone.
 */
const NO_FROZEN_MONEY = { ...SNAPSHOT, financing: {} }

/**
 * The same deal on a partner that carries a programme contribution. Three true
 * amounts, six figures apart:
 *   contract value      $167,120   what the partner's paper is written at
 *   customer obligation  $87,120   what the household is liable for
 *   less the credits     $83,560   contract value minus $83,560 of credits
 */
const PARTICIPATE = {
  ...SNAPSHOT,
  financing: {
    ...SNAPSHOT.financing,
    financedAmountCents: 16_712_000,
    lenderAdjustment: {
      lenderContractValueCents: 16_712_000,
      customerObligationCents: 8_712_000,
      adjustmentCents: 8_000_000,
    },
    creditLadder: {
      credits: [
        { key: 'itc', amountCents: 5_013_600 },
        { key: 'energyCommunity', amountCents: 1_671_200 },
        { key: 'domesticContent', amountCents: 1_671_200 },
      ],
    },
  },
}

beforeEach(() => {
  decryptField.mockReset().mockReturnValue('ak_live_secret')
  designFindFirst.mockReset().mockResolvedValue(DESIGN)
  financeFindFirst
    .mockReset()
    .mockResolvedValue({ contractPriceCents: 5000000, downPaymentCents: 125000, loanTermMonths: 300 })
  // A generated document by default. Both doors onto a submission live ON a
  // proposal, so a deal without one is not a state a customer can reach — and
  // the lender's savings analysis has nowhere else to come from.
  proposalFindFirst.mockReset().mockResolvedValue({ snapshot: SNAPSHOT })
  submissionCreate.mockReset().mockResolvedValue({})
  validateWithAmos.mockReset().mockResolvedValue({ valid: true, problems: [] })
  submitToAmos.mockReset().mockResolvedValue({
    applicationId: 'app-1',
    referenceNumber: 'AMS-1042',
    customerUrl: 'https://lender.test/complete/tok',
    sentTo: 'dana@example.com',
    expiresAt: '2026-09-10T00:00:00.000Z',
  })
})

describe('submitDealToLender', () => {
  const input = {
    leadId: 'lead-1',
    companyId: 'co-1',
    ownerOccupied: true,
    fallbackRepName: 'Anexa Homes',
  }

  it('submits and returns the handoff link', async () => {
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({
      ok: true,
      referenceNumber: 'AMS-1042',
      customerUrl: 'https://lender.test/complete/tok',
      lenderName: 'Amos Capital Fund',
    })
  })

  it('scopes the deal lookup to the company the CALLER resolved', async () => {
    await submitDealToLender(input)
    expect(designFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      leadId: 'lead-1',
      companyId: 'co-1',
    })
  })

  it('finances contract price LESS the down payment', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: NO_FROZEN_MONEY })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('48750.00')
  })

  it('sends the deal rep’s name, not the fallback', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.salesRepName).toBe('Marco Diaz')
  })

  it('falls back only when the deal has no rep', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, assignedRep: null } })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.salesRepName).toBe('Anexa Homes')
  })

  it('sends the occupancy answer it was given, and nothing about identity', async () => {
    await submitDealToLender({ ...input, ownerOccupied: false })
    const payload = submitToAmos.mock.calls[0]?.[1]
    expect(payload.property.ownerOccupied).toBe(false)
    const wire = JSON.stringify(payload)
    expect(wire).not.toMatch(/ssn|socialSecurity|dateOfBirth|dob|consent/i)
  })

  it('uses THAT LENDER’S key, decrypted, and never the stored blob', async () => {
    await submitDealToLender(input)
    expect(decryptField).toHaveBeenCalledWith('ENCRYPTED')
    expect(submitToAmos.mock.calls[0]?.[0]?.apiKey).toBe('ak_live_secret')
  })

  it('refuses when the lender has no API details, as a config problem', async () => {
    designFindFirst.mockResolvedValue({
      ...DESIGN,
      lender: { ...DESIGN.lender, apiProductSlug: null },
    })
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'config' })
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('lists deal blockers instead of calling the lender', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, email: null, zip: null } })
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { problems: string[] }).problems).toHaveLength(2)
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('refuses a deal with no financed amount', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: NO_FROZEN_MONEY })
    financeFindFirst.mockResolvedValue({
      contractPriceCents: 0,
      downPaymentCents: 0,
      loanTermMonths: 300,
    })
    expect(await submitDealToLender(input)).toMatchObject({ ok: false, kind: 'deal' })
  })

  it('refuses a deal with no term', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: NO_FROZEN_MONEY })
    financeFindFirst.mockResolvedValue({
      contractPriceCents: 5000000,
      downPaymentCents: 0,
      loanTermMonths: null,
    })
    expect(await submitDealToLender(input)).toMatchObject({ ok: false, kind: 'deal' })
  })

  it('classifies a revoked key as config, not something to retry', async () => {
    submitToAmos.mockRejectedValue(new AmosSubmissionError('key_revoked', 'revoked', 401))
    expect(await submitDealToLender(input)).toMatchObject({ ok: false, kind: 'config' })
  })

  it('classifies a network failure as transient', async () => {
    submitToAmos.mockRejectedValue(new AmosSubmissionError('network_error', 'no route'))
    expect(await submitDealToLender(input)).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('classifies unmatched equipment as a deal problem', async () => {
    submitToAmos.mockRejectedValue(
      new AmosSubmissionError('unknown_equipment', 'not on the AVL (Tesla Powerwall 3)', 422),
    )
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { error: string }).error).toContain('Powerwall 3')
  })

  /**
   * THE TRANSLATION. Our catalogue names a SKU with its wattage; the partner's
   * approved-vendor list names a product family. Sending ours is the 422 this
   * mapping exists to stop.
   */
  it('sends the name THIS lender uses, from its own approval row', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.equipment).toEqual([
      { kind: 'panel', brand: 'Qcells', model: 'Q.PEAK DUO BLK ML-G10+', quantity: 26 },
      { kind: 'inverter', brand: 'Enphase', model: 'IQ8PLUS-72-M-US', quantity: 26 },
    ])
  })

  it('refuses to send an item this lender has no name for, and never calls them', async () => {
    designFindFirst.mockResolvedValue({
      ...DESIGN,
      module: { manufacturer: 'Silfab', model: 'SIL440-QD-DCA2', lenderApprovals: [] },
    })
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { problems?: string[] }).problems?.join(' ')).toContain('Silfab SIL440-QD-DCA2')
    expect((r as { problems?: string[] }).problems?.join(' ')).toContain('Amos Capital Fund')
    // The whole point: the lender is never asked a question it would answer 422.
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  /**
   * THE AMOUNT COMES OFF THE DOCUMENT, NOT THE PRICING ROWS.
   *
   * On a partner carrying a programme contribution those are two different
   * numbers: `SolarFinance.contractPriceCents` is the household's own price,
   * while the sheet in front of them quotes its payment from the contract value
   * the partner's paper is written at. Reading the rows asked Amos for $70,180
   * against a proposal that says $150,180.
   */
  it('asks the lender for the amount the live proposal quotes', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('150180.00')
    expect(submitToAmos.mock.calls[0]?.[1]?.termMonths).toBe(360)
  })

  it('reads only the version the customer can still open', async () => {
    await submitDealToLender(input)
    expect(proposalFindFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      leadId: 'lead-1',
      companyId: 'co-1',
      supersededAt: null,
    })
  })

  it('falls back to the pricing rows on a snapshot too old to carry the figure', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: { ...SNAPSHOT, financing: { aprPct: 0 } } })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('48750.00')
    expect(submitToAmos.mock.calls[0]?.[1]?.termMonths).toBe(300)
  })

  /**
   * THE SAVINGS ANALYSIS, ON THE WIRE, FROM THE FROZEN DOCUMENT.
   *
   * Amos's lending service required five figures on a solar deal and their
   * intake API had fields for two, so every solar submission answered 500 and
   * no payload could have succeeded. These pin the half that is ours: the
   * figures come from the document the household was shown, in the lender's
   * units, and a deal that cannot produce them never reaches the network.
   */
  it('sends the savings analysis the live proposal froze', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.system).toEqual({
      annualProductionKwh: 17107,
      annualConsumptionKwh: 16017,
      retailRatePerKwh: '0.233',
      // $3,731.96 the utility would have charged, less the $120 meter fee they
      // still bill. Nothing residual on this roof.
      estAnnualSaving: '3611.96',
      // $3,611.96 over twelve months, rounded once.
      estMonthlySaving: '301.00',
    })
  })

  it('takes production from the DOCUMENT, not from a design re-drawn since', async () => {
    // The saving is computed from the frozen figures, so production has to come
    // from the same page. A lender handed 17,514 kWh beside a saving worked out
    // on 17,107 has been handed two different deals.
    designFindFirst.mockResolvedValue({ ...DESIGN, year1ProductionKwh: 17514 })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.system.annualProductionKwh).toBe(17107)
  })

  it('reads the meter fee through the schema-safe reader, not raw', async () => {
    // A document generated before the fee was modelled has no such key. It must
    // report the figure it was priced at, not NaN.
    proposalFindFirst.mockResolvedValue({
      snapshot: {
        ...SNAPSHOT,
        savings: { years: [{ year: 1, utilityCostCents: 373196, residualGridCents: 0 }] },
      },
    })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.system.estAnnualSaving).toBe('3731.96')
  })

  it('refuses a deal with no proposal instead of inventing a saving', async () => {
    proposalFindFirst.mockResolvedValue(null)
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('Generate one first')
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('refuses a deal whose bill does not go down, before the network', async () => {
    proposalFindFirst.mockResolvedValue({
      snapshot: {
        ...SNAPSHOT,
        // The meter fee alone is more than the bill this system avoids.
        savings: { years: [{ year: 1, utilityCostCents: 9000, residualGridCents: 0, meterFeeCents: 12000 }] },
      },
    })
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('no saving')
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('never surfaces an unexpected error verbatim', async () => {
    submitToAmos.mockRejectedValue(new Error('postgres://user:hunter2@db.internal'))
    const r = await submitDealToLender(input)
    expect(JSON.stringify(r)).not.toContain('hunter2')
    expect(r).toMatchObject({ ok: false, kind: 'transient' })
  })
})

describe('readLenderSubmission', () => {
  it('reports link mode when the lender has no API details', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lender: { ...DESIGN.lender, apiBaseUrl: null } })
    expect(await readLenderSubmission('lead-1', 'co-1')).toEqual({ mode: 'link' })
  })

  it('reports link mode when the deal has no lender at all', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lender: null })
    expect(await readLenderSubmission('lead-1', 'co-1')).toEqual({ mode: 'link' })
  })

  it('reports ready with a server-built summary of what will be sent', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: NO_FROZEN_MONEY })
    const r = await readLenderSubmission('lead-1', 'co-1')
    expect(r).toMatchObject({ mode: 'api', lenderName: 'Amos Capital Fund', ready: true })
    // Built from the same rows the submission reads, so the household confirms
    // what actually goes rather than what the browser happened to hold.
    expect((r as { summary: Record<string, string> }).summary).toEqual({
      customer: 'Dana Reyes',
      property: '4120 Sage Hollow Dr, Austin, TX, 78735',
      system: '10.7 kW · 26 x Qcells Q.PEAK 410',
      financing: '$48,750 over 300 months',
    })
  })

  it('reports not-ready when the deal has no price yet', async () => {
    proposalFindFirst.mockResolvedValue({ snapshot: NO_FROZEN_MONEY })
    financeFindFirst.mockResolvedValue({
      contractPriceCents: 0,
      downPaymentCents: 0,
      loanTermMonths: 300,
    })
    const r = await readLenderSubmission('lead-1', 'co-1')
    expect(r).toMatchObject({ mode: 'api', ready: false })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('financed amount')
  })

  it('omits a battery from the summary when the deal has none', async () => {
    const r = await readLenderSubmission('lead-1', 'co-1')
    expect((r as { summary: { system: string } }).summary.system).not.toContain('Battery')
  })

  it('reports the blockers when it is not ready', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, phone: null } })
    const r = await readLenderSubmission('lead-1', 'co-1')
    expect(r).toMatchObject({ mode: 'api', ready: false })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('phone')
  })
})

/**
 * SEEING WHAT THE LENDER IS TOLD, AND ASKING THEM BEFORE A CUSTOMER IS WATCHING.
 *
 * The integration ran for weeks with no way to read either. A refusal left a
 * one-line string on the activity log; the payload and the partner's answer
 * went to a server console nobody in the product can reach.
 */
describe('readLenderPayloadPreview', () => {
  const args = ['lead-1', 'co-1', 'Anexa Homes'] as const

  it('previews the SAME body the submission would send', async () => {
    const preview = await readLenderPayloadPreview(...args)
    await submitDealToLender({ leadId: 'lead-1', companyId: 'co-1', ownerOccupied: true, fallbackRepName: 'Anexa Homes' })
    const sent = submitToAmos.mock.calls[0]?.[1]

    expect(preview).toMatchObject({ mode: 'api', ready: true })
    // Occupancy is the one field nothing stores; the panel labels it.
    expect((preview as { payload: unknown }).payload).toEqual(sent)
  })

  it('shows the blockers instead of a body when the deal cannot be sent', async () => {
    proposalFindFirst.mockResolvedValue(null)
    const preview = await readLenderPayloadPreview(...args)
    expect(preview).toMatchObject({ mode: 'api', ready: false })
    expect((preview as { problems: string[] }).problems.join(' ')).toContain('Generate one first')
  })

  it('says nothing at all for a lender with no direct submission', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lender: { ...DESIGN.lender, apiKeyEncrypted: null } })
    expect(await readLenderPayloadPreview(...args)).toEqual({ mode: 'link' })
  })
})

describe('checkDealWithLender', () => {
  const args = ['lead-1', 'co-1', 'Anexa Homes'] as const

  it('asks the lender and NEVER submits', async () => {
    const r = await checkDealWithLender(...args)
    expect(r).toMatchObject({ ok: true, valid: true })
    expect(validateWithAmos).toHaveBeenCalledTimes(1)
    // The whole point: no application, no credit file, nothing to the customer.
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('carries their field paths through, so a rep fixes the right number', async () => {
    validateWithAmos.mockResolvedValue({
      valid: false,
      problems: [{ code: 'invalid_request', field: 'system.estMonthlySaving', message: 'Number must be greater than or equal to 1' }],
    })
    const r = await checkDealWithLender(...args)
    expect(r).toMatchObject({ ok: true, valid: false })
    expect((r as { problems: string[] }).problems[0]).toBe(
      'system.estMonthlySaving: Number must be greater than or equal to 1',
    )
  })

  it('answers from our own preflight without troubling the lender', async () => {
    proposalFindFirst.mockResolvedValue(null)
    const r = await checkDealWithLender(...args)
    expect(r).toMatchObject({ ok: true, valid: false })
    expect(validateWithAmos).not.toHaveBeenCalled()
  })
})

describe('the submission log', () => {
  const input = { leadId: 'lead-1', companyId: 'co-1', ownerOccupied: true, fallbackRepName: 'Anexa Homes' }

  it('records the body that was sent and the reference that came back', async () => {
    await submitDealToLender(input)
    const row = submissionCreate.mock.calls[0]?.[0]?.data
    expect(row).toMatchObject({ ok: true, referenceNumber: 'AMS-1042', applicationId: 'app-1', lenderName: 'Amos Capital Fund' })
    expect(row.request).toEqual(submitToAmos.mock.calls[0]?.[1])
  })

  it('never lets the API key into the stored body', async () => {
    await submitDealToLender(input)
    const wire = JSON.stringify(submissionCreate.mock.calls[0]?.[0]?.data)
    expect(wire).not.toContain('ak_live_secret')
    expect(wire).not.toMatch(/authorization|bearer/i)
  })

  it('records a refusal with the lender’s own code and message', async () => {
    submitToAmos.mockRejectedValue(new AmosSubmissionError('internal_error', 'Something went wrong on our side.', 500))
    await submitDealToLender(input)
    expect(submissionCreate.mock.calls[0]?.[0]?.data).toMatchObject({
      ok: false, status: 500, code: 'internal_error',
    })
  })

  it('never lets the bookkeeping cost the application', async () => {
    // By the time the row is written the deal is already with the lender.
    submissionCreate.mockRejectedValue(new Error('log table is gone'))
    expect(await submitDealToLender(input)).toMatchObject({ ok: true, referenceNumber: 'AMS-1042' })
  })

  it('writes nothing when the deal never reached the network', async () => {
    proposalFindFirst.mockResolvedValue(null)
    await submitDealToLender(input)
    expect(submissionCreate).not.toHaveBeenCalled()
  })
})

/**
 * WHICH OF A DEAL'S SEVERAL TRUE AMOUNTS A PARTNER UNDERWRITES.
 *
 * They can differ by six figures. Sending the wrong one is not a rounding
 * error: reading the live rows instead of the document once asked Amos for
 * $70,180 against a proposal quoting $150,180.
 */
describe('the amount basis', () => {
  const input = { leadId: 'lead-1', companyId: 'co-1', ownerOccupied: true, fallbackRepName: 'Anexa Homes' }
  const lenderOn = (basis: string) => ({ ...DESIGN, lender: { ...DESIGN.lender, submissionAmountBasis: basis } })

  beforeEach(() => proposalFindFirst.mockResolvedValue({ snapshot: PARTICIPATE }))

  it('sends the contract value by default — what the partner’s paper is written at', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('167120.00')
  })

  it('sends the household’s own obligation when the partner is set to it', async () => {
    designFindFirst.mockResolvedValue(lenderOn('customer_obligation'))
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('87120.00')
  })

  it('subtracts the credits the DOCUMENT quotes, not a rate applied here', async () => {
    designFindFirst.mockResolvedValue(lenderOn('after_credits'))
    await submitDealToLender(input)
    // $167,120 less $50,136 + $16,712 + $16,712.
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('83560.00')
  })

  it('falls back to the contract value on a basis this build does not know', async () => {
    // A column outlives the code that understands it. An unknown value must
    // never resolve to one of the SMALLER readings.
    designFindFirst.mockResolvedValue(lenderOn('some_future_basis'))
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('167120.00')
  })

  it('reads the obligation as the contract value where no programme applies', async () => {
    designFindFirst.mockResolvedValue(lenderOn('customer_obligation'))
    proposalFindFirst.mockResolvedValue({ snapshot: SNAPSHOT })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('150180.00')
  })

  it('records which basis produced the amount, on the attempt itself', async () => {
    designFindFirst.mockResolvedValue(lenderOn('after_credits'))
    await submitDealToLender(input)
    expect(submissionCreate.mock.calls[0]?.[0]?.data?.amountBasis).toBe('after_credits')
  })
})

describe('the saving basis', () => {
  const input = { leadId: 'lead-1', companyId: 'co-1', ownerOccupied: true, fallbackRepName: 'Anexa Homes' }

  it('sends the bill avoided by default', async () => {
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.system.estAnnualSaving).toBe('3611.96')
  })

  it('blocks the deal when a partner asks for the NET figure and it is negative', async () => {
    // True, and unsendable: their amount format has no minus sign. Refused on
    // a rep's screen rather than in front of a homeowner.
    designFindFirst.mockResolvedValue({
      ...DESIGN,
      lender: { ...DESIGN.lender, submissionSavingBasis: 'net_of_payment' },
    })
    proposalFindFirst.mockResolvedValue({
      snapshot: {
        ...SNAPSHOT,
        savings: { years: [{ year: 1, utilityCostCents: 373_196, residualGridCents: 0, meterFeeCents: 12_000, solarCostCents: 529_064 }] },
      },
    })
    const r = await submitDealToLender(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('never nets on an unrecognised basis', async () => {
    designFindFirst.mockResolvedValue({
      ...DESIGN,
      lender: { ...DESIGN.lender, submissionSavingBasis: 'something_else' },
    })
    await submitDealToLender(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.system.estAnnualSaving).toBe('3611.96')
  })
})
