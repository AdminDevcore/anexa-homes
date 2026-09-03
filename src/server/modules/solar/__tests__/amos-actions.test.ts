import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const can = vi.fn()
vi.mock('@/server/auth/session', () => ({ requireUser: () => requireUser() }))
vi.mock('@/server/rbac/guards', () => ({ can: (...a: unknown[]) => can(...a) }))

const decryptField = vi.fn()
const encryptField = vi.fn()
vi.mock('@/server/lib/crypto', () => ({
  decryptField: (...a: unknown[]) => decryptField(...a),
  encryptField: (...a: unknown[]) => encryptField(...a),
  maskTail: () => 'MASKED',
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const designFindFirst = vi.fn()
const financeFindFirst = vi.fn()
const lenderFindFirst = vi.fn()
const lenderUpdate = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarDesign: { findFirst: (...a: unknown[]) => designFindFirst(...a) },
    solarFinance: { findFirst: (...a: unknown[]) => financeFindFirst(...a) },
    solarLender: {
      findFirst: (...a: unknown[]) => lenderFindFirst(...a),
      update: (...a: unknown[]) => lenderUpdate(...a),
    },
  },
}))

const submitToAmos = vi.fn()
vi.mock('../amos-client', async () => {
  const actual = await vi.importActual<typeof import('../amos-client')>('../amos-client')
  return { ...actual, submitToAmos: (...a: unknown[]) => submitToAmos(...a) }
})

const {
  submitDealToLenderAction,
  amosSubmissionStatusAction,
  setSolarLenderApiKeyAction,
  clearSolarLenderApiKeyAction,
} = await import('../amos-actions')
const { AmosSubmissionError } = await import('../amos-client')

const USER = { id: 'u1', companyId: 'co-1', fullName: 'Sender Person' }

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
  requireUser.mockReset().mockResolvedValue(USER)
  can.mockReset().mockReturnValue(true)
  decryptField.mockReset().mockReturnValue('ak_live_secret')
  encryptField.mockReset().mockReturnValue('ENCRYPTED-BLOB')
  lenderFindFirst.mockReset().mockResolvedValue({ id: 'lender-1' })
  lenderUpdate.mockReset().mockResolvedValue({})
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

describe('submitDealToLenderAction', () => {
  const input = { leadId: 'lead-1', ownerOccupied: true, delivery: 'in_person' as const }

  it('submits and returns the handoff link', async () => {
    const r = await submitDealToLenderAction(input)
    expect(r).toMatchObject({
      ok: true,
      referenceNumber: 'AMS-1042',
      customerUrl: 'https://lender.test/complete/tok',
    })
  })

  it('denies a caller without permission', async () => {
    can.mockReturnValue(false)
    expect(await submitDealToLenderAction(input)).toMatchObject({ ok: false, kind: 'config' })
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('scopes the deal lookup to the caller company', async () => {
    await submitDealToLenderAction(input)
    expect(designFindFirst.mock.calls[0]?.[0]?.where).toEqual({
      leadId: 'lead-1',
      companyId: 'co-1',
    })
  })

  it('finances contract price LESS the down payment', async () => {
    await submitDealToLenderAction(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.requestedAmount).toBe('48750.00')
  })

  it('sends the deal rep’s name, not the sender’s', async () => {
    await submitDealToLenderAction(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.salesRepName).toBe('Marco Diaz')
  })

  it('falls back to the sender when the deal has no rep', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, assignedRep: null } })
    await submitDealToLenderAction(input)
    expect(submitToAmos.mock.calls[0]?.[1]?.salesRepName).toBe('Sender Person')
  })

  it('decrypts the key and never passes the stored blob', async () => {
    await submitDealToLenderAction(input)
    expect(decryptField).toHaveBeenCalledWith('ENCRYPTED')
    expect(submitToAmos.mock.calls[0]?.[0]?.apiKey).toBe('ak_live_secret')
  })

  it('refuses when the lender has no API details, as a config problem', async () => {
    designFindFirst.mockResolvedValue({
      ...DESIGN,
      lender: { ...DESIGN.lender, apiProductSlug: null },
    })
    const r = await submitDealToLenderAction(input)
    expect(r).toMatchObject({ ok: false, kind: 'config' })
    expect(submitToAmos).not.toHaveBeenCalled()
  })

  it('lists deal blockers instead of calling the lender', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, email: null, zip: null } })
    const r = await submitDealToLenderAction(input)
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
    expect(await submitDealToLenderAction(input)).toMatchObject({ ok: false, kind: 'deal' })
  })

  it('refuses a deal with no term', async () => {
    financeFindFirst.mockResolvedValue({
      contractPriceCents: 5000000,
      downPaymentCents: 0,
      loanTermMonths: null,
    })
    expect(await submitDealToLenderAction(input)).toMatchObject({ ok: false, kind: 'deal' })
  })

  it('classifies a revoked key as config, not something a rep can retry', async () => {
    submitToAmos.mockRejectedValue(new AmosSubmissionError('key_revoked', 'revoked', 401))
    expect(await submitDealToLenderAction(input)).toMatchObject({ ok: false, kind: 'config' })
  })

  it('classifies a network failure as transient', async () => {
    submitToAmos.mockRejectedValue(new AmosSubmissionError('network_error', 'no route'))
    expect(await submitDealToLenderAction(input)).toMatchObject({ ok: false, kind: 'transient' })
  })

  it('classifies unmatched equipment as a deal problem the rep can fix', async () => {
    submitToAmos.mockRejectedValue(
      new AmosSubmissionError('unknown_equipment', 'not on the AVL (Tesla Powerwall 3)', 422),
    )
    const r = await submitDealToLenderAction(input)
    expect(r).toMatchObject({ ok: false, kind: 'deal' })
    expect((r as { error: string }).error).toContain('Powerwall 3')
  })

  it('never surfaces an unexpected error verbatim', async () => {
    submitToAmos.mockRejectedValue(new Error('postgres://user:hunter2@db.internal'))
    const r = await submitDealToLenderAction(input)
    expect(JSON.stringify(r)).not.toContain('hunter2')
    expect(r).toMatchObject({ ok: false, kind: 'transient' })
  })
})

describe('amosSubmissionStatusAction', () => {
  it('reports link mode when the lender has no API details', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lender: { ...DESIGN.lender, apiBaseUrl: null } })
    expect(await amosSubmissionStatusAction('lead-1')).toEqual({ mode: 'link' })
  })

  it('reports link mode when the deal has no lender at all', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lender: null })
    expect(await amosSubmissionStatusAction('lead-1')).toEqual({ mode: 'link' })
  })

  it('reports ready with a server-built summary of what will be sent', async () => {
    const r = await amosSubmissionStatusAction('lead-1')
    expect(r).toMatchObject({ mode: 'api', lenderName: 'Amos Capital Fund', ready: true })
    // Built from the same rows the submission reads, so the rep confirms what
    // actually goes rather than what the browser happened to hold.
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
    const r = await amosSubmissionStatusAction('lead-1')
    expect(r).toMatchObject({ mode: 'api', ready: false })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('financed amount')
  })

  it('omits a battery from the summary when the deal has none', async () => {
    const r = await amosSubmissionStatusAction('lead-1')
    expect((r as { summary: { system: string } }).summary.system).not.toContain('Battery')
  })

  it('reports the blockers when it is not', async () => {
    designFindFirst.mockResolvedValue({ ...DESIGN, lead: { ...LEAD, phone: null } })
    const r = await amosSubmissionStatusAction('lead-1')
    expect(r).toMatchObject({ mode: 'api', ready: false })
    expect((r as { problems: string[] }).problems.join(' ')).toContain('phone')
  })
})

describe('setSolarLenderApiKeyAction', () => {
  it('denies a caller without settings permission', async () => {
    can.mockReturnValue(false)
    expect(await setSolarLenderApiKeyAction('lender-1', 'ak_live_x')).toMatchObject({ ok: false })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty key rather than storing a blank credential', async () => {
    expect(await setSolarLenderApiKeyAction('lender-1', '   ')).toMatchObject({ ok: false })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('encrypts before storing and never writes the plaintext', async () => {
    const r = await setSolarLenderApiKeyAction('lender-1', 'ak_live_secret')
    expect(r).toMatchObject({ ok: true })
    expect(encryptField).toHaveBeenCalledWith('ak_live_secret')
    const written = JSON.stringify(lenderUpdate.mock.calls[0]?.[0]?.data)
    expect(written).not.toContain('ak_live_secret')
    expect(written).toContain('ENCRYPTED-BLOB')
  })

  it('returns only the last four so the paster can confirm it', async () => {
    const r = await setSolarLenderApiKeyAction('lender-1', 'ak_live_secret')
    expect((r as { masked: string }).masked).toBe('MASKED')
  })

  it('refuses a lender outside the caller company', async () => {
    lenderFindFirst.mockResolvedValue(null)
    expect(await setSolarLenderApiKeyAction('other-co-lender', 'ak_live_x')).toMatchObject({
      ok: false,
    })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('refuses a key carrying a shell prompt glyph, naming the character', async () => {
    // The real incident: "❯" (U+276F) copied from a terminal prompt made the
    // Authorization header impossible to encode, so fetch threw before sending
    // and it looked exactly like the network being down.
    const r = await setSolarLenderApiKeyAction('lender-1', '❯ak_live_secret')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('❯')
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('refuses a key with an embedded line break', async () => {
    expect(await setSolarLenderApiKeyAction('lender-1', 'ak_live\nsecret')).toMatchObject({
      ok: false,
    })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('refuses a key with a non-breaking space from a rich-text paste', async () => {
    expect(await setSolarLenderApiKeyAction('lender-1', 'ak_live\u00a0secret')).toMatchObject({
      ok: false,
    })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })

  it('still accepts every character a real key uses', async () => {
    // base64url plus the underscore-separated prefix.
    expect(
      await setSolarLenderApiKeyAction('lender-1', 'ak_live_aZ09-_abcDEF1234567890'),
    ).toMatchObject({ ok: true })
  })
})

describe('clearSolarLenderApiKeyAction', () => {
  it('nulls the stored key', async () => {
    expect(await clearSolarLenderApiKeyAction('lender-1')).toMatchObject({ ok: true })
    expect(lenderUpdate.mock.calls[0]?.[0]?.data).toEqual({ apiKeyEncrypted: null })
  })

  it('denies a caller without settings permission', async () => {
    can.mockReturnValue(false)
    expect(await clearSolarLenderApiKeyAction('lender-1')).toMatchObject({ ok: false })
    expect(lenderUpdate).not.toHaveBeenCalled()
  })
})
