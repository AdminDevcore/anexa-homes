import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireUser = vi.fn()
const can = vi.fn()
vi.mock('@/server/auth/session', () => ({ requireUser: () => requireUser() }))
vi.mock('@/server/rbac/guards', () => ({ can: (...a: unknown[]) => can(...a) }))

const encryptField = vi.fn()
vi.mock('@/server/lib/crypto', () => ({
  decryptField: vi.fn(),
  encryptField: (...a: unknown[]) => encryptField(...a),
  maskTail: () => 'MASKED',
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const lenderFindFirst = vi.fn()
const lenderUpdate = vi.fn()
vi.mock('@/server/db/client', () => ({
  prisma: {
    solarLender: {
      findFirst: (...a: unknown[]) => lenderFindFirst(...a),
      update: (...a: unknown[]) => lenderUpdate(...a),
    },
  },
}))

const { setSolarLenderApiKeyAction, clearSolarLenderApiKeyAction } = await import('../amos-actions')

const USER = { id: 'u1', companyId: 'co-1', fullName: 'Sender Person' }

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue(USER)
  can.mockReset().mockReturnValue(true)
  encryptField.mockReset().mockReturnValue('ENCRYPTED-BLOB')
  lenderFindFirst.mockReset().mockResolvedValue({ id: 'lender-1' })
  lenderUpdate.mockReset().mockResolvedValue({})
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
