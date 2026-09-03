import { beforeEach, describe, expect, it, vi } from 'vitest'

const decryptField = vi.fn()
vi.mock('@/server/lib/crypto', () => ({
  decryptField: (...a: unknown[]) => decryptField(...a),
  encryptField: vi.fn(),
  maskTail: () => 'MASKED',
}))

const designFindFirst = vi.fn()
const financeFindFirst = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarDesign: { findFirst: (...a: unknown[]) => designFindFirst(...a) },
    solarFinance: { findFirst: (...a: unknown[]) => financeFindFirst(...a) },
  },
}))

const submitToAmos = vi.fn()
vi.mock('../amos-client', async () => {
  const actual = await vi.importActual<typeof import('../amos-client')>('../amos-client')
  return { ...actual, submitToAmos: (...a: unknown[]) => submitToAmos(...a) }
})

const { submitDealToLender, readLenderSubmission } = await import('../lender-submit')
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
  module: { manufacturer: 'Qcells', model: 'Q.PEAK 410' },
  inverter: { manufacturer: 'Enphase', model: 'IQ8PLUS' },
  battery: null,
  lender: {
    id: 'lender-1',
    name: 'Amos Capital Fund',
    apiBaseUrl: 'https://lender.test',
    apiKeyEncrypted: 'ENCRYPTED',
    apiProductSlug: 'solar-installation-financing',
  },
  lead: LEAD,
}

beforeEach(() => {
  decryptField.mockReset().mockReturnValue('ak_live_secret')
  designFindFirst.mockReset().mockResolvedValue(DESIGN)
  financeFindFirst
    .mockReset()
    .mockResolvedValue({ contractPriceCents: 5000000, downPaymentCents: 125000, loanTermMonths: 300 })
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
    financeFindFirst.mockResolvedValue({
      contractPriceCents: 0,
      downPaymentCents: 0,
      loanTermMonths: 300,
    })
    expect(await submitDealToLender(input)).toMatchObject({ ok: false, kind: 'deal' })
  })

  it('refuses a deal with no term', async () => {
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
