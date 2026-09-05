import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const can = vi.fn()
vi.mock('@/server/auth/session', () => ({ requireUser: () => requireUser() }))
vi.mock('@/server/rbac/guards', () => ({ can: (...a: unknown[]) => can(...a) }))

const encryptField = vi.fn()
const decryptField = vi.fn()
vi.mock('@/server/lib/crypto', () => ({
  decryptField: (...a: unknown[]) => decryptField(...a),
  encryptField: (...a: unknown[]) => encryptField(...a),
  maskTail: () => 'MASKED',
}))

const fetchAmosCatalog = vi.fn()
vi.mock('../amos-client', async () => {
  const actual = await vi.importActual<typeof import('../amos-client')>('../amos-client')
  return { ...actual, fetchAmosCatalog: (...a: unknown[]) => fetchAmosCatalog(...a) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const lenderFindFirst = vi.fn()
const lenderUpdate = vi.fn()
const approvalFindMany = vi.fn()
const approvalUpdate = vi.fn()
const transaction = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarLender: {
      findFirst: (...a: unknown[]) => lenderFindFirst(...a),
      update: (...a: unknown[]) => lenderUpdate(...a),
    },
    solarEquipmentLender: {
      findMany: (...a: unknown[]) => approvalFindMany(...a),
      update: (...a: unknown[]) => approvalUpdate(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))

const { AmosSubmissionError } = await import('../amos-client')
const {
  setSolarLenderApiKeyAction,
  clearSolarLenderApiKeyAction,
  readLenderCatalogueAction,
  setLenderEquipmentNamesAction,
} = await import('../amos-actions')

const USER = { id: 'u1', companyId: 'co-1', fullName: 'Sender Person' }

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER)
  can.mockReset().mockReturnValue(true)
  encryptField.mockReset().mockReturnValue('ENCRYPTED-BLOB')
  lenderFindFirst.mockReset().mockResolvedValue({ id: 'lender-1' })
  lenderUpdate.mockReset().mockResolvedValue({})
  decryptField.mockReset().mockReturnValue('ak_live_secret')
  fetchAmosCatalog.mockReset().mockResolvedValue({
    products: [{ slug: 'solar-30-year-cpe', name: 'Solar 30 Year CPE' }],
    equipment: [{ kind: 'panel', brand: 'Silfab', model: 'PRIME DCA2', watts: 440, capacityKwh: null }],
  })
  approvalFindMany.mockReset().mockResolvedValue([{ equipmentId: 'eq-1' }, { equipmentId: 'eq-2' }])
  approvalUpdate.mockReset().mockImplementation((args: unknown) => args)
  transaction.mockReset().mockResolvedValue([])
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

describe('readLenderCatalogueAction', () => {
  it('denies a caller without settings permission', async () => {
    can.mockReturnValue(false)
    expect(await readLenderCatalogueAction('lender-1')).toMatchObject({ ok: false })
    expect(fetchAmosCatalog).not.toHaveBeenCalled()
  })

  it('refuses a lender in another company', async () => {
    lenderFindFirst.mockResolvedValue(null)
    expect(await readLenderCatalogueAction('other-co-lender')).toMatchObject({
      ok: false,
      error: 'Lender not found.',
    })
  })

  it('says what is missing rather than calling a lender with no credentials', async () => {
    lenderFindFirst.mockResolvedValue({ name: 'Amos Capital Fund', apiBaseUrl: null, apiKeyEncrypted: null })
    decryptField.mockReturnValue(null)
    const r = await readLenderCatalogueAction('lender-1')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('Amos Capital Fund')
    expect(fetchAmosCatalog).not.toHaveBeenCalled()
  })

  it('reads with the DECRYPTED key and hands back their list', async () => {
    lenderFindFirst.mockResolvedValue({
      name: 'Amos Capital Fund',
      apiBaseUrl: 'https://lender.test',
      apiKeyEncrypted: 'ENCRYPTED',
    })
    const r = await readLenderCatalogueAction('lender-1')
    expect(fetchAmosCatalog).toHaveBeenCalledWith({
      baseUrl: 'https://lender.test',
      apiKey: 'ak_live_secret',
    })
    expect(r).toMatchObject({ ok: true })
    expect((r as { equipment: unknown[] }).equipment).toHaveLength(1)
  })

  it("passes the lender's own refusal straight through", async () => {
    lenderFindFirst.mockResolvedValue({
      name: 'Amos Capital Fund',
      apiBaseUrl: 'https://lender.test',
      apiKeyEncrypted: 'ENCRYPTED',
    })
    fetchAmosCatalog.mockRejectedValue(
      new AmosSubmissionError('unauthorized', 'This API key is not recognized.', 401),
    )
    expect(await readLenderCatalogueAction('lender-1')).toEqual({
      ok: false,
      error: 'This API key is not recognized.',
    })
  })
})

describe('setLenderEquipmentNamesAction', () => {
  const entries = [
    { equipmentId: 'eq-1', lenderBrand: 'Silfab', lenderModel: 'PRIME DCA2' },
    { equipmentId: 'eq-2', lenderBrand: null, lenderModel: null },
  ]

  it('denies a caller without settings permission', async () => {
    can.mockReturnValue(false)
    expect(await setLenderEquipmentNamesAction('lender-1', entries)).toMatchObject({ ok: false })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('writes both halves of a name, and clears both when the pair is cleared', async () => {
    await setLenderEquipmentNamesAction('lender-1', entries)
    const written = approvalUpdate.mock.calls.map((c) => c[0])
    expect(written[0]).toMatchObject({
      where: { equipmentId_lenderId: { equipmentId: 'eq-1', lenderId: 'lender-1' } },
      data: { lenderBrand: 'Silfab', lenderModel: 'PRIME DCA2' },
    })
    expect(written[1]?.data).toEqual({ lenderBrand: null, lenderModel: null })
  })

  /**
   * Their brand against our model is a name neither catalogue contains, so it
   * is stored as nothing at all and the submission falls back to ours.
   */
  it('stores half a pair as no pair', async () => {
    await setLenderEquipmentNamesAction('lender-1', [
      { equipmentId: 'eq-1', lenderBrand: 'Silfab', lenderModel: '   ' },
    ])
    expect(approvalUpdate.mock.calls[0]?.[0]?.data).toEqual({
      lenderBrand: null,
      lenderModel: null,
    })
  })

  /**
   * The join row IS the approval, so creating one to hold a name would add an
   * item to a partner's approved-vendor list as a side effect of typing.
   */
  it('never writes a name for equipment this lender does not approve', async () => {
    await setLenderEquipmentNamesAction('lender-1', [
      { equipmentId: 'eq-not-approved', lenderBrand: 'Silfab', lenderModel: 'PRIME DCA2' },
    ])
    expect(approvalUpdate).not.toHaveBeenCalled()
  })

  it('refuses a lender in another company', async () => {
    lenderFindFirst.mockResolvedValue(null)
    expect(await setLenderEquipmentNamesAction('other-co-lender', entries)).toMatchObject({
      ok: false,
      error: 'Lender not found.',
    })
  })
})
